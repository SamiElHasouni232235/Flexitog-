"""Interactive HTML dashboard: the whole simulator in one self-contained page.

The page embeds the current workspace (master data, parameters, batch orders), the JavaScript
port of the engine (assets/engine.js), a projected basemap and the regional issues. Every
parameter change in the page reruns the batch in the browser. No server, no external requests
except Google Fonts.
"""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import date
from pathlib import Path

import pandas as pd

from . import batch as B
from . import parameters as P
from .datarequest import DATASETS
from .engine import Data
from .geo import CITIES, PORT_ROUTES, lane_path, locate
from .issues import ISSUES
from .schema import COUNTRY_NAMES, COUNTRY_REGION, DC_TYPE_LABELS, EU27, PLACEHOLDER, SOURCE_COL

ASSETS = Path(__file__).parent / "assets"


def _records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records", date_format="iso")) if len(df) else []


def build_payload(ws, per_region_synthetic: int = 15) -> dict:
    data = Data.from_workspace(ws)
    orders, lines, extra, notes = B.history_batch(data)
    source = "sales history"
    if orders.empty:
        orders, lines, notes = B.synthetic_batch(data, per_region=per_region_synthetic)
        source = "synthetic test batch"
    customers = data.customers
    if len(extra):
        customers = pd.concat([customers, extra], ignore_index=True)
        data = replace(data, customers=customers, _history=None)
    via, direct = data.history_counts()

    locs = {}
    for c in _records(customers):
        p = locate(c.get("city"), c.get("country"), c.get("latitude"), c.get("longitude"))
        if p:
            locs["cust:" + str(c["customer_id"])] = p
    for d in _records(data.dcs):
        p = locate(d.get("city"), d.get("country"), d.get("latitude"), d.get("longitude"))
        if p:
            locs["dc:" + str(d["dc_id"])] = p
    lanes = {k: lane_path(k) for k in PORT_ROUTES}

    tests = ws.load("orders")
    tlines = ws.load("order_lines")
    demo = all((ws.load(k)[SOURCE_COL] == PLACEHOLDER).all() for k in ("customers", "products"))
    return {
        "meta": {"generated": date.today().strftime("%d %b %Y"), "source": source, "demo": demo, "notes": notes},
        "data": {
            "products": _records(data.products), "customers": _records(customers),
            "suppliers": _records(data.suppliers), "dcs": _records(data.dcs), "lanes": _records(data.lanes),
            "history": {"via": {str(k): int(v) for k, v in via.items()},
                        "direct": {str(k): int(v) for k, v in direct.items()}},
            "params": {name: _records(ws.load_params(name)) for name in P.DEFAULT_TABLES},
            "country_region": COUNTRY_REGION, "eu27": sorted(EU27),
        },
        "batch": {"orders": _records(orders), "lines": _records(lines)},
        "tests": {"orders": _records(tests), "lines": _records(tlines[["order_id", "sku", "quantity"]])},
        "geo": {"basemap": json.loads((ASSETS / "basemap.json").read_text(encoding="utf-8")),
                "cities": CITIES, "locations": locs, "lanes": lanes},
        "issues": ISSUES,
        "names": {"countries": COUNTRY_NAMES, "dc_types": DC_TYPE_LABELS},
        "datasets": [{"sheet": d[0], "priority": d[3], "why": d[4], "where": d[5], "target": d[6]} for d in DATASETS],
    }


def apply_changes(ws, text: str) -> list[str]:
    """Apply the JSON the dashboard's 'Copy changes' button produces. Returns a log of what changed.

    Row numbers refer to table order when the dashboard was built, so apply to the same workspace.
    """
    spec = json.loads(text)
    log: list[str] = []
    entity_tables = {"dcs": "distribution_centers", "products": "products"}
    frames: dict[str, pd.DataFrame] = {}
    for ch in spec.get("changes", []):
        table, row, field, value = ch["table"], int(ch["row"]), ch["field"], ch["to"]
        key = entity_tables.get(table, table)
        if key not in frames:
            frames[key] = ws.load(key) if table in entity_tables else ws.load_params(key)
        df = frames[key]
        if row >= len(df) or field not in df.columns:
            log.append(f"skipped {table} row {row} {field}: not in this workspace")
            continue
        df.at[df.index[row], field] = value
        if table in entity_tables:
            df.at[df.index[row], SOURCE_COL] = "manual"
        elif "source" in df.columns:
            df.at[df.index[row], "source"] = P.REAL
            if "source_note" in df.columns:
                df.at[df.index[row], "source_note"] = f"set in dashboard ({spec.get('generated', '')})"
        log.append(f"{table} row {row}: {field} {ch.get('from')} -> {value}")
    for key, df in frames.items():
        (ws.save if key in entity_tables.values() else ws.save_params)(key, df)
    if spec.get("whatIf", {}).get("euAll") or spec.get("whatIf", {}).get("redSea"):
        log.append("What-if switches (Red Sea, all SKUs EU-made) stay in the dashboard. They are not saved as data.")
    if spec.get("excluded_nodes"):
        log.append(f"Excluded nodes are not deleted: {', '.join(spec['excluded_nodes'])}. Remove them on Master data.")
    return log


def build_html(ws) -> str:
    payload = json.dumps(build_payload(ws), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    template = (ASSETS / "dashboard.html").read_text(encoding="utf-8")
    engine = (ASSETS / "engine.js").read_text(encoding="utf-8")
    return template.replace("/*ENGINE*/", engine).replace("/*PAYLOAD*/null", payload)
