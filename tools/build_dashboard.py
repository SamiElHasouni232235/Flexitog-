"""Write the interactive HTML dashboard for the current workspace.

Run:  python tools/build_dashboard.py [output.html] [--sales path/to/Odoo_sales_order_lines.xlsx]

Without --sales the Forecast view embeds the anonymized sample (flexitog/assets/data/). Pass the real
export (kept in workspace/, which git ignores) only for a local copy: it holds real customer names.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flexitog.dashboard import build_html  # noqa: E402
from flexitog.store import Workspace  # noqa: E402

if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("out", nargs="?", default="reports/flexitog_dashboard.html")
    ap.add_argument("--sales", default=None, help="Odoo sales order lines export (.xlsx, Sheet1)")
    a = ap.parse_args()
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_html(Workspace(), sales_orders=a.sales), encoding="utf-8")
    print(out)
