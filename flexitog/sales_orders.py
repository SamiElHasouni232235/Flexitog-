"""Odoo sales order lines for the sales forecast (Forecast view in the dashboard).

The export has one row per order line on sheet "Sheet1", headers prefixed "Order Lines/". This module
only reads the columns the forecast uses and hands them to the browser as a table; the cleaning rules
live once, in assets/forecast_core.js, so a file uploaded in the browser and the embedded file are
treated the same way.

Default source: the anonymized sample in assets/data/. Put the real export at
workspace/Official_Sales_Orders_MENA_Turkey.xlsx (git ignores workspace/) and build with
`python tools/build_dashboard.py --sales workspace/Official_Sales_Orders_MENA_Turkey.xlsx` to embed it locally.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ASSETS = Path(__file__).parent / "assets"
SAMPLE = ASSETS / "data" / "Sample_Sales_Orders_MENA_Turkey_ANONYMIZED.xlsx"
REAL = Path("workspace") / "Official_Sales_Orders_MENA_Turkey.xlsx"
SHEET = "Sheet1"
PREFIX = "Order Lines/"
# Columns the forecast reads (without the prefix). Others in the export are dropped.
FIELDS = ["Created on", "Company", "Customer/Company Name Entity", "Customer", "Customer/Country", "Customer/City",
          "Order Reference", "Product/Name", "Product Template/Category", "Quantity", "Unit of Measure", "Total Tax",
          "Total", "Currency"]


def _cell(v):
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NaT:
        return None
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, date):
        return v.isoformat()
    if hasattr(v, "item"):
        v = v.item()
    return v


def sales_orders_table(path: str | Path | None = None) -> dict:
    """{source, anonymized, headers, rows} for the dashboard payload."""
    path = Path(path) if path else SAMPLE
    df = pd.read_excel(path, sheet_name=SHEET)
    df.columns = [str(c).replace(PREFIX, "").strip() for c in df.columns]
    missing = [f for f in FIELDS if f not in df.columns]
    if missing:
        raise ValueError(f"{path.name} misses columns: {', '.join(missing)}")
    df = df[FIELDS]
    return {"source": path.name, "anonymized": path.resolve() == SAMPLE.resolve(), "headers": FIELDS,
            "rows": [[_cell(v) for v in row] for row in df.itertuples(index=False, name=None)]}
