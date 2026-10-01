"""The browser engine (assets/engine.js) must match the Python engine."""
import json
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pandas as pd
import pytest

from flexitog import batch as B
from flexitog.dashboard import ASSETS, build_html, build_payload
from flexitog.engine import Data, evaluate
from flexitog.store import Workspace

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node not installed")

RUNNER = """
const E = require(process.argv[2]);
const p = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const data = E.makeData(p.data);
const rows = E.runBatch(p.batch.orders, p.batch.lines, data);
const sc = E.scorecard(rows, 'customer_first');
const byOrder = {}; p.tests.lines.forEach(l => (byOrder[l.order_id] = byOrder[l.order_id] || []).push(l));
const tests = p.tests.orders.map(o => {
  const ev = E.evaluate(o, byOrder[o.order_id] || [], data);
  return {order_id: o.order_id, recommended: ev.recommended ? E.M.key(ev.recommended) : null,
          routes: ev.routes.map(r => ({key: E.M.key(r), cost: E.M.cost(r), lead: E.M.lead(r), score: E.M.score(r),
                                       customer: E.M.paid(r, E.CUSTOMER), vat: r.vat_eur}))};
});
console.log(JSON.stringify({sc, tests, rows: rows.length}));
"""


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path / "ws")


def run_js(payload, tmp_path):
    (tmp_path / "p.json").write_text(json.dumps(payload))
    (tmp_path / "run.js").write_text(RUNNER)
    out = subprocess.run([NODE, str(tmp_path / "run.js"), str(ASSETS / "engine.js"), str(tmp_path / "p.json")],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def python_side(ws, payload):
    data = Data.from_workspace(ws)
    extra = pd.DataFrame(payload["data"]["customers"])
    data = replace(data, customers=extra, _history=None)
    orders = pd.DataFrame(payload["batch"]["orders"])
    lines = pd.DataFrame(payload["batch"]["lines"])
    return data, B.scorecard(B.run_batch(orders, lines, data), "customer_first")


def test_batch_scorecard_matches_python(ws, tmp_path):
    payload = build_payload(ws)
    js = run_js(payload, tmp_path)
    data, sc = python_side(ws, payload)
    jsc = {(r["group"], r["scenario"]): r for r in js["sc"]}
    assert len(jsc) == len(sc)
    for r in sc.to_dict("records"):
        j = jsc[(r["region"], r["scenario"])]
        for k in ("coverage", "cost_per_unit_eur", "customer_cost_per_unit_eur", "lead_time_days", "hassle",
                  "flexitog_paperwork", "proven_lane_share", "placeholder_cost_share"):
            if pd.isna(r[k]):
                assert j[k] is None, (r["region"], r["scenario"], k)
            else:
                assert j[k] == pytest.approx(r[k], rel=1e-9, abs=1e-9), (r["region"], r["scenario"], k)


def test_single_orders_match_python(ws, tmp_path):
    payload = build_payload(ws)
    js = run_js(payload, tmp_path)
    data = Data.from_workspace(ws)
    orders, lines = ws.load("orders"), ws.load("order_lines")
    for t in js["tests"]:
        o = orders[orders["order_id"] == t["order_id"]].iloc[0].to_dict()
        ev = evaluate(o, lines[lines["order_id"] == t["order_id"]], data)
        assert (ev.recommended.key if ev.recommended else None) == t["recommended"]
        py = {r.key: r for r in ev.routes}
        for jr in t["routes"]:
            r = py[jr["key"]]
            assert jr["cost"] == pytest.approx(r.cost_to_serve)
            assert jr["lead"] == pytest.approx(r.lead_time_days)
            assert jr["score"] == pytest.approx(r.score)
            assert jr["customer"] == pytest.approx(r.paid("customer"))
            assert jr["vat"] == pytest.approx(r.vat_eur)


def test_parity_holds_with_partner_overrides_and_eu_origin(ws, tmp_path):
    dcs = ws.load("distribution_centers")
    dcs.loc[dcs["dc_id"] == "3PL-JAFZ", ["storage_eur_per_pallet_month", "data_source"]] = [22, "manual"]
    dcs.loc[dcs["dc_id"] == "DIST-TR", "margin_pct"] = 12
    ws.save("distribution_centers", dcs)
    prod = ws.load("products")
    prod.loc[prod["sku"].isin(["RW-BOT-100", "FT-JKT-100"]), "country_of_origin"] = "PT"
    ws.save("products", prod)
    payload = build_payload(ws)
    js = run_js(payload, tmp_path)
    _, sc = python_side(ws, payload)
    jsc = {(r["group"], r["scenario"]): r for r in js["sc"]}
    for r in sc.to_dict("records"):
        if pd.notna(r["cost_per_unit_eur"]):
            assert jsc[(r["region"], r["scenario"])]["cost_per_unit_eur"] == pytest.approx(r["cost_per_unit_eur"])


def test_dashboard_html_is_self_contained(ws):
    page = build_html(ws)
    assert page.startswith('<meta charset="utf-8">\n<title>')
    assert "/*PAYLOAD*/" not in page and "/*ENGINE*/" not in page
    assert "FlexEngine" in page
    for host in ("cdnjs", "jsdelivr", "unpkg"):
        assert host not in page
    assert "/*XLSX*/" not in page and "/*WORKSPACE*/" not in page
    assert "\ufffd" not in page
    assert 'id="menuBtn"' in page and 'id="viewMD"' in page and 'id="viewReport"' in page
    assert "SheetJS" in page and "function renderMD" in page
    assert len(page.encode()) < 3_000_000


def test_apply_dashboard_changes(ws):
    from flexitog.dashboard import apply_changes

    spec = {"generated": "x", "whatIf": {"redSea": True}, "excluded_nodes": ["OWN-TR"], "changes": [
        {"table": "scenarios", "row": 1, "field": "margin_pct", "from": 25, "to": 12},
        {"table": "dcs", "row": 1, "field": "status", "from": "potential", "to": "existing"},
        {"table": "freight", "row": 999, "field": "eur_per_pallet", "from": 1, "to": 2},
    ]}
    log = apply_changes(ws, json.dumps(spec))
    sc = ws.load_params("scenarios").set_index("scenario")
    assert sc.loc["distributor", "margin_pct"] == 12 and sc.loc["distributor", "source"] == "real"
    dcs = ws.load("distribution_centers")
    assert dcs.iloc[1]["status"] == "existing" and dcs.iloc[1]["data_source"] == "manual"
    assert any("skipped" in l for l in log) and any("Red Sea" in l for l in log)


HISTORY_RUNNER = """
const E = require(process.argv[2]);
const p = JSON.parse(require('fs').readFileSync(process.argv[3], 'utf8'));
const regionFor = c => p.data.country_region[c] || 'Other';
const hb = E.historyBatch(p.data.sales_history, p.data.customers, p.data.products, regionFor);
const raw = Object.assign({}, p.data, {customers: p.data.customers.concat(hb.customers), history: E.historyCounts(p.data.sales_history)});
const rows = E.runBatch(hb.orders, hb.lines, E.makeData(raw));
console.log(JSON.stringify({hb, sc: E.scorecard(rows, 'customer_first'), history: raw.history}));
"""


def run_history_js(payload, tmp_path):
    (tmp_path / "p.json").write_text(json.dumps(payload))
    (tmp_path / "h.js").write_text(HISTORY_RUNNER)
    out = subprocess.run([NODE, str(tmp_path / "h.js"), str(ASSETS / "engine.js"), str(tmp_path / "p.json")],
                         capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_history_batch_matches_python(ws, tmp_path):
    """The dashboard rebuilds the batch from uploaded sales history in the browser."""
    sh = ws.load("sales_history")
    extra = pd.DataFrame([
        {"order_id": "SO-NEW-1", "order_date": "2026-03-01", "customer_id": "C-NEW", "sku": "RW-GLV-100",
         "quantity": 2500, "country": "OM", "data_source": "manual"},
        {"order_id": "SO-NEW-1", "order_date": "2026-03-01", "customer_id": "C-NEW", "sku": "RW-GLV-100",
         "quantity": 100, "country": "OM", "data_source": "manual"},
        {"order_id": "SO-NEW-2", "order_date": "2026-03-02", "customer_id": "C-NEW2", "sku": "NOT-A-SKU",
         "quantity": 5, "country": "QA", "data_source": "manual"},
    ])
    ws.save("sales_history", pd.concat([sh, extra], ignore_index=True))
    payload = build_payload(ws)
    js = run_history_js(payload, tmp_path)
    data = Data.from_workspace(ws)
    orders, lines, new_cust, notes = B.history_batch(data)
    assert [o["order_id"] for o in js["hb"]["orders"]] == list(orders["order_id"])
    assert [o["pallet_count"] for o in js["hb"]["orders"]] == pytest.approx(list(orders["pallet_count"].astype(float)))
    assert [o["customer_id"] for o in js["hb"]["orders"]] == list(orders["customer_id"])
    jl = [(l["order_id"], l["sku"], l["quantity"]) for l in js["hb"]["lines"]]
    assert jl == [(r.order_id, r.sku, pytest.approx(r.quantity)) for r in lines.itertuples()]
    assert sorted(c["customer_id"] for c in js["hb"]["customers"]) == sorted(new_cust["customer_id"])
    assert js["hb"]["notes"] == notes
    new = next(o for o in js["hb"]["orders"] if o["order_id"] == "SO-NEW-1")
    assert new["pallet_count"] == 3  # 2600 gloves at 1200 per pallet

    # same scorecard as Python on the rebuilt batch
    data = replace(data, customers=pd.concat([data.customers, new_cust], ignore_index=True), _history=None)
    via, _ = data.history_counts()
    assert js["history"]["via"] == {str(k): int(v) for k, v in via.items()}
    sc = B.scorecard(B.run_batch(orders, lines, data), "customer_first")
    jsc = {(r["group"], r["scenario"]): r for r in js["sc"]}
    for r in sc.to_dict("records"):
        j = jsc[(r["region"], r["scenario"])]
        for k in ("cost_per_unit_eur", "lead_time_days", "hassle", "coverage"):
            if pd.isna(r[k]):
                assert j[k] is None
            else:
                assert j[k] == pytest.approx(r[k], rel=1e-9, abs=1e-9), (r["region"], r["scenario"], k)
