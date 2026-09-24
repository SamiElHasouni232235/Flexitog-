"""CSV/Excel import: read a file, guess a column mapping, coerce types, validate."""
from __future__ import annotations

import difflib
import io
from dataclasses import dataclass, field

import pandas as pd

from .schema import (
    Entity, Field, IMPORTED_PREFIX, SOURCE_COL, normalise, region_for, to_iso2,
)

IGNORE = "(ignore)"
KEEP = "(keep as extra column)"


# ---------------------------------------------------------------- reading

def list_sheets(data: bytes, filename: str) -> list[str]:
    if not filename.lower().endswith((".xlsx", ".xlsm", ".xls")):
        return []
    return pd.ExcelFile(io.BytesIO(data)).sheet_names


def read_table(data: bytes, filename: str, sheet: str | None = None, header_row: int = 0) -> pd.DataFrame:
    """Read CSV or Excel into a DataFrame of strings. header_row is 0-based."""
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm", ".xls")):
        df = pd.read_excel(io.BytesIO(data), sheet_name=sheet or 0, header=header_row, dtype=str)
    else:
        text = _decode(data)
        # sep=None lets pandas sniff , ; or tab. European exports often use ;
        df = pd.read_csv(io.StringIO(text), sep=None, engine="python", header=header_row, dtype=str)
    df = df.dropna(how="all")
    df.columns = [str(c).strip() for c in df.columns]
    df = df.loc[:, [c for c in df.columns if not c.lower().startswith("unnamed")]]
    return df.reset_index(drop=True)


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- mapping

def guess_mapping(columns: list[str], entity: Entity) -> dict[str, str]:
    """Return {source column: target field | KEEP}. Each target is used once."""
    candidates: dict[str, str] = {}
    for f in entity.fields:
        candidates[normalise(f.name)] = f.name
        for alias in f.aliases:
            candidates.setdefault(normalise(alias), f.name)

    mapping: dict[str, str] = {}
    used: set[str] = set()

    # Pass 1: exact matches on name or alias.
    for col in columns:
        target = candidates.get(normalise(col))
        if target and target not in used:
            mapping[col] = target
            used.add(target)

    # Pass 2: fuzzy match for the rest.
    for col in columns:
        if col in mapping:
            continue
        key = normalise(col)
        close = difflib.get_close_matches(key, list(candidates), n=3, cutoff=0.82)
        target = next((candidates[c] for c in close if candidates[c] not in used), None)
        if target:
            mapping[col] = target
            used.add(target)
        else:
            mapping[col] = KEEP
    return mapping


def extra_column_name(col: str) -> str:
    """Safe snake_case name for a column kept outside the schema."""
    out = "".join(ch if ch.isalnum() else "_" for ch in str(col).strip().lower())
    while "__" in out:
        out = out.replace("__", "_")
    return out.strip("_") or "extra"


# ---------------------------------------------------------------- coercion

def _clean_number(v) -> str | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().replace(" ", "").replace(" ", "")
    for token in ("€", "EUR", "eur", "$", "USD", "%"):
        s = s.replace(token, "")
    if not s or s.lower() in ("nan", "none", "-", "n/a", "na", "<na>"):
        return None
    return s


def detect_decimal(series: pd.Series) -> str:
    """Return ',' or '.' as the decimal separator a column most likely uses.

    '1.234,5' or '2,1' point to a decimal comma. '1,234.5' or '2.1' point to a
    decimal dot. Values like '1.250' or '1,250' are ambiguous and ignored.
    Falls back to '.' when nothing decides it.
    """
    comma = dot = 0
    for v in series.dropna():
        s = _clean_number(v)
        if not s:
            continue
        if "," in s and "." in s:
            comma += s.rfind(",") > s.rfind(".")
            dot += s.rfind(".") > s.rfind(",")
        elif "," in s:
            tail = s.rpartition(",")[2]
            comma += len(tail) != 3
        elif "." in s:
            tail = s.rpartition(".")[2]
            dot += len(tail) != 3
    return "," if comma > dot else "."


def _to_float(series: pd.Series, decimal: str = "auto") -> pd.Series:
    """Parse numbers written as 1.234,56 / 1,234.56 / 12,5 / '€ 40' / '15%'."""
    dec = detect_decimal(series) if decimal == "auto" else decimal
    thousands = "." if dec == "," else ","

    def parse(v):
        if isinstance(v, (int, float)) and not pd.isna(v):
            return float(v)
        s = _clean_number(v)
        if s is None:
            return None
        s = s.replace(thousands, "").replace(dec, ".")
        try:
            return float(s)
        except ValueError:
            return float("nan")  # marks a value that was present but unreadable
    return series.map(parse).astype("float64")


def _to_bool(series: pd.Series) -> pd.Series:
    truthy = {"1", "true", "yes", "y", "ja", "j", "x", "required"}
    falsy = {"0", "false", "no", "n", "nee", "", "nan", "none"}

    def parse(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        s = str(v).strip().lower()
        if s in truthy:
            return True
        if s in falsy:
            return False
        return None
    return series.map(parse).astype("boolean")


def _to_list(series: pd.Series) -> pd.Series:
    def parse(v):
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return ""
        parts = [p.strip() for p in str(v).replace(",", ";").replace("|", ";").split(";")]
        return ";".join(p for p in parts if p)
    return series.map(parse)


def coerce_frame(df: pd.DataFrame, entity: Entity, decimal: str = "auto") -> tuple[pd.DataFrame, list[str]]:
    """Coerce schema columns to their dtype. Returns (frame, list of warnings).

    decimal: 'auto' detects per column, or force ',' / '.'.
    """
    out = df.copy()
    warnings: list[str] = []
    for f in entity.fields:
        if f.name not in out.columns:
            continue
        raw = out[f.name]
        present = raw.notna() & (raw.astype(str).str.strip() != "")
        if f.dtype in ("float", "int"):
            parsed = _to_float(raw, decimal)
            bad = present & parsed.isna()
            if bad.any():
                warnings.append(f"{f.name}: {int(bad.sum())} value(s) not numeric, left blank "
                                f"(e.g. '{raw[bad].iloc[0]}')")
            parsed[bad] = None
            out[f.name] = parsed.round().astype("Int64") if f.dtype == "int" else parsed
        elif f.dtype == "date":
            parsed = pd.to_datetime(raw, errors="coerce", dayfirst=True)
            bad = present & parsed.isna()
            if bad.any():
                warnings.append(f"{f.name}: {int(bad.sum())} value(s) not a date, left blank "
                                f"(e.g. '{raw[bad].iloc[0]}')")
            out[f.name] = parsed.dt.date
        elif f.dtype == "bool":
            out[f.name] = _to_bool(raw)
        elif f.dtype == "list":
            out[f.name] = _to_list(raw)
        else:
            out[f.name] = raw.map(lambda v: None if v is None or (isinstance(v, float) and pd.isna(v))
                                  else str(v).strip() or None).astype(object)
    return out, warnings


def enrich(df: pd.DataFrame, entity: Entity) -> pd.DataFrame:
    """Normalise country codes and derive region where the schema has both."""
    out = df.copy()
    names = entity.field_names()
    for col in ("country", "country_of_origin"):
        if col in out.columns:
            out[col] = out[col].map(to_iso2)
    if "serves_countries" in out.columns:
        out["serves_countries"] = out["serves_countries"].map(
            lambda v: ";".join(filter(None, (to_iso2(p) for p in str(v or "").split(";")))))
    if "sku_ids" in out.columns:
        out["sku_ids"] = out["sku_ids"].fillna("")
    if "region" in names and "country" in out.columns:
        if "region" not in out.columns:
            out["region"] = None
        missing = out["region"].isna() | (out["region"].astype(str).str.strip() == "")
        out.loc[missing, "region"] = out.loc[missing, "country"].map(region_for)
    return out


# ---------------------------------------------------------------- validation

@dataclass
class ImportResult:
    frame: pd.DataFrame
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    row_issues: pd.DataFrame | None = None  # one row per problem: row, field, issue

    @property
    def ok(self) -> bool:
        return not self.errors


def validate(df: pd.DataFrame, entity: Entity) -> tuple[list[str], pd.DataFrame]:
    """Schema-level errors plus a table of row-level issues."""
    errors: list[str] = []
    issues: list[dict] = []
    for name in entity.required_fields():
        if name not in df.columns:
            errors.append(f"Required field '{name}' is not mapped to any column.")
    for f in entity.fields:
        if f.name not in df.columns:
            continue
        col = df[f.name]
        blank = col.isna() | (col.astype(str).str.strip().isin(["", "nan", "None", "<NA>"]))
        if f.required:
            for idx in df.index[blank]:
                issues.append({"row": int(idx) + 1, "field": f.name, "issue": "required value missing"})
        if f.allowed:
            bad = ~blank & ~col.astype(str).isin(f.allowed)
            for idx in df.index[bad]:
                issues.append({"row": int(idx) + 1, "field": f.name,
                               "issue": f"'{col[idx]}' not in {f.allowed}"})
    pk = [k for k in entity.primary_key if k in df.columns]
    if pk:
        dup = df.duplicated(subset=pk, keep=False) & df[pk].notna().all(axis=1)
        for idx in df.index[dup]:
            issues.append({"row": int(idx) + 1, "field": "+".join(pk), "issue": "duplicate key"})
    return errors, pd.DataFrame(issues, columns=["row", "field", "issue"])


def apply_mapping(raw: pd.DataFrame, mapping: dict[str, str], entity: Entity, filename: str,
                  decimal: str = "auto") -> ImportResult:
    """Rename, coerce, enrich and validate. The result carries provenance."""
    rename: dict[str, str] = {}
    targets_seen: set[str] = set()
    errors: list[str] = []
    schema_names = set(entity.field_names())
    for col, target in mapping.items():
        if target == IGNORE or col not in raw.columns:
            continue
        name = extra_column_name(col) if target == KEEP else target
        if target == KEEP and name in schema_names:
            name = f"extra_{name}"
        if name in targets_seen:
            errors.append(f"Field '{name}' is mapped from more than one column.")
            continue
        targets_seen.add(name)
        rename[col] = name

    df = raw[list(rename)].rename(columns=rename)
    df, warnings = coerce_frame(df, entity, decimal)
    df = enrich(df, entity)
    schema_errors, issues = validate(df, entity)
    errors.extend(schema_errors)
    df[SOURCE_COL] = f"{IMPORTED_PREFIX}{filename}"
    return ImportResult(frame=df, errors=errors, warnings=warnings, row_issues=issues)


def merge_into(existing: pd.DataFrame, incoming: pd.DataFrame, entity: Entity, mode: str) -> pd.DataFrame:
    """mode: 'replace' drops existing rows, 'upsert' overwrites matching keys, 'append' adds rows."""
    if mode == "replace" or existing is None or existing.empty:
        return incoming.reset_index(drop=True)
    combined = pd.concat([existing, incoming], ignore_index=True)
    if mode == "upsert":
        pk = [k for k in entity.primary_key if k in combined.columns]
        if pk:
            combined = combined.drop_duplicates(subset=pk, keep="last")
    return combined.reset_index(drop=True)


def template_frame(entity: Entity) -> pd.DataFrame:
    return pd.DataFrame(columns=entity.field_names())


def schema_table(entity: Entity) -> pd.DataFrame:
    rows = []
    for f in entity.fields:
        rows.append({
            "field": f.name,
            "type": f.dtype,
            "required": f.required,
            "allowed values": ", ".join(f.allowed) if f.allowed else "",
            "description": f.description,
            "recognised headers": ", ".join(f.aliases[:8]),
            "custom": f.custom,
        })
    return pd.DataFrame(rows)


def new_custom_field(name: str, dtype: str, description: str, required: bool = False) -> Field:
    return Field(name=extra_column_name(name), dtype=dtype, description=description,
                 required=required, custom=True)
