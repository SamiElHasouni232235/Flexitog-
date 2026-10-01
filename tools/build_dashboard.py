"""Write the interactive HTML dashboard for the current workspace.

Run:  python tools/build_dashboard.py [output.html]
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from flexitog.dashboard import build_html  # noqa: E402
from flexitog.store import Workspace  # noqa: E402

if __name__ == "__main__":
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("reports/flexitog_dashboard.html")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build_html(Workspace()), encoding="utf-8")
    print(out)
