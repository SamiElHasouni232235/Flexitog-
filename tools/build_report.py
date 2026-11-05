"""Write the HTML report for the current workspace.

Uses sales history as the batch when it exists, otherwise a synthetic batch.
Run:  python tools/build_report.py [output.html] [--method customer_first]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flexitog import batch as B  # noqa: E402
from flexitog.engine import Data, evaluate  # noqa: E402
from flexitog.report import build_html  # noqa: E402
from flexitog.schema import PLACEHOLDER, SOURCE_COL  # noqa: E402
from flexitog.store import Workspace  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", nargs="?", default="reports/flexitog_route_report.html")
    ap.add_argument("--method", default="customer_first", choices=list(B.HASSLE_METHODS))
    args = ap.parse_args()

    ws = Workspace()
    data = Data.from_workspace(ws)
    orders, lines, extra, _ = B.history_batch(data)
    source = "sales history"
    if orders.empty:
        orders, lines, _ = B.synthetic_batch(data, per_region=15)
        source = "synthetic test batch"
    if len(extra):
        from dataclasses import replace
        import pandas as pd
        data = replace(data, customers=pd.concat([data.customers, extra], ignore_index=True), _history=None)
    results = B.run_batch(orders, lines, data)

    tests, tlines = ws.load("orders"), ws.load("order_lines")
    sample, customer = None, {}
    if len(tests):
        first = tests.iloc[0].to_dict()
        sample = evaluate(first, tlines[tlines["order_id"] == first["order_id"]], data)
        match = data.customers[data.customers["customer_id"] == first["customer_id"]]
        customer = match.iloc[0].to_dict() if len(match) else {}

    all_placeholder = all((ws.load(k)[SOURCE_COL] == PLACEHOLDER).all() for k in ("customers", "products"))
    html = build_html(results, args.method, source, sample, customer, demo=all_placeholder)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(out)


if __name__ == "__main__":
    main()
