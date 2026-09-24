"""File-based workspace. Entity tables and parameter tables live as CSV files.

Layout:
    workspace/data/<entity>.csv
    workspace/params/<table>.csv
    workspace/schema_extensions.json   custom fields per entity
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd

from . import parameters as P
from .importer import coerce_frame
from .schema import ENTITIES, Entity, Field, SOURCE_COL, PLACEHOLDER, IMPORTED_PREFIX
from .seed import seed_frame

DEFAULT_ROOT = Path(os.environ.get("FLEXITOG_WORKSPACE", Path(__file__).resolve().parent.parent / "workspace"))


class Workspace:
    def __init__(self, root: Path | str = DEFAULT_ROOT):
        self.root = Path(root)
        (self.root / "data").mkdir(parents=True, exist_ok=True)
        (self.root / "params").mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------ schema
    @property
    def _ext_path(self) -> Path:
        return self.root / "schema_extensions.json"

    def _extensions(self) -> dict[str, list[dict]]:
        if self._ext_path.exists():
            return json.loads(self._ext_path.read_text(encoding="utf-8"))
        return {}

    def entity(self, key: str) -> Entity:
        """Base schema plus the user's custom fields."""
        base = ENTITIES[key]
        extra = [Field(**d) for d in self._extensions().get(key, [])]
        known = set(base.field_names())
        return Entity(key=base.key, label=base.label, primary_key=base.primary_key,
                      description=base.description, importable=base.importable,
                      fields=base.fields + [f for f in extra if f.name not in known])

    def add_custom_field(self, key: str, f: Field) -> None:
        ext = self._extensions()
        items = [d for d in ext.get(key, []) if d["name"] != f.name]
        f.custom = True
        items.append(f.to_dict())
        ext[key] = items
        self._ext_path.write_text(json.dumps(ext, indent=2, ensure_ascii=False), encoding="utf-8")

    def remove_custom_field(self, key: str, name: str) -> None:
        ext = self._extensions()
        ext[key] = [d for d in ext.get(key, []) if d["name"] != name]
        self._ext_path.write_text(json.dumps(ext, indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------ entities
    def _data_path(self, key: str) -> Path:
        return self.root / "data" / f"{key}.csv"

    def load(self, key: str) -> pd.DataFrame:
        path = self._data_path(key)
        if not path.exists():
            df = seed_frame(key)
            self.save(key, df)
            return df
        raw = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])
        df, _ = coerce_frame(raw, self.entity(key), decimal=".")
        if SOURCE_COL not in df.columns:
            df[SOURCE_COL] = PLACEHOLDER
        return df

    def save(self, key: str, df: pd.DataFrame) -> None:
        entity = self.entity(key)
        out = df.copy()
        if SOURCE_COL not in out.columns:
            out[SOURCE_COL] = PLACEHOLDER
        for name in entity.field_names():
            if name not in out.columns:
                out[name] = None
        ordered = entity.field_names()
        rest = [c for c in out.columns if c not in ordered and c != SOURCE_COL]
        out = out[ordered + rest + [SOURCE_COL]]
        out.to_csv(self._data_path(key), index=False)

    def reset(self, key: str) -> None:
        self.save(key, seed_frame(key))

    def reset_all(self) -> None:
        """Every table and parameter back to the shipped demo data."""
        for key in ENTITIES:
            self.reset(key)
        for name in P.DEFAULT_TABLES:
            self.reset_params(name)

    # ------------------------------------------------------------ parameters
    def _param_path(self, name: str) -> Path:
        return self.root / "params" / f"{name}.csv"

    def load_params(self, name: str) -> pd.DataFrame:
        path = self._param_path(name)
        if not path.exists():
            df = P.default_table(name)
            self.save_params(name, df)
            return df
        df = pd.read_csv(path, keep_default_na=False, na_values=[""])
        df = self._merge_new_defaults(name, df)
        if "source_note" in df.columns:
            df["source_note"] = df["source_note"].fillna("")
        return df

    @staticmethod
    def _merge_new_defaults(name: str, df: pd.DataFrame) -> pd.DataFrame:
        """Add parameters and columns introduced after the file was saved, as placeholders."""
        default = P.default_table(name)
        key = P.TABLE_KEYS.get(name)
        if key and key in df.columns:
            new_rows = default[~default[key].isin(df[key])]
            missing_cols = [c for c in default.columns if c not in df.columns]
            if missing_cols:
                df = df.merge(default[[key] + missing_cols], on=key, how="left")
            if len(new_rows):
                df = pd.concat([df, new_rows], ignore_index=True)
        else:
            for c in default.columns:
                if c not in df.columns:
                    df[c] = None
        return df

    def save_params(self, name: str, df: pd.DataFrame) -> None:
        df.to_csv(self._param_path(name), index=False)

    def reset_params(self, name: str) -> None:
        self.save_params(name, P.default_table(name))

    # ------------------------------------------------------------ provenance summary
    def provenance(self) -> pd.DataFrame:
        rows = []
        for key, entity in ENTITIES.items():
            df = self.load(key)
            src = df[SOURCE_COL].fillna(PLACEHOLDER).astype(str) if len(df) else pd.Series(dtype=str)
            rows.append({
                "table": entity.label,
                "kind": "master data",
                "rows": len(df),
                "placeholder": int((src == PLACEHOLDER).sum()),
                "real": int(src.str.startswith(IMPORTED_PREFIX).sum() + (src == "manual").sum()),
            })
        for name, (label, _) in P.DEFAULT_TABLES.items():
            df = self.load_params(name)
            src = df["source"].astype(str) if "source" in df.columns else pd.Series([PLACEHOLDER] * len(df))
            rows.append({
                "table": label,
                "kind": "parameter",
                "rows": len(df),
                "placeholder": int((src == P.PLACEHOLDER).sum()),
                "real": int((src == P.REAL).sum()),
            })
        out = pd.DataFrame(rows)
        out["real share"] = (out["real"] / out["rows"].where(out["rows"] > 0)).fillna(0.0)
        return out
