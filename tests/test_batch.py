import pandas as pd
import pytest

from flexitog import batch as B
from flexitog.engine import Data
from flexitog.store import Workspace


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path)


@pytest.fixture
def data(ws):
    return Data.from_workspace(ws)


def test_synthetic_batch_is_reproducible_and_covers_regions(data):
    o1, l1, notes = B.synthetic_batch(data, per_region=5, seed=7)
    o2, l2, _ = B.synthetic_batch(data, per_region=5, seed=7)
    assert not notes
    assert len(o1) == 15
    pd.testing.assert_frame_equal(o1, o2)
    pd.testing.assert_frame_equal(l1, l2)
    assert (o1["pallet_count"] >= 1).all()
    assert set(l1["order_id"]) == set(o1["order_id"])


def test_run_batch_one_row_per_order_and_scenario(data):
    o, l, _ = B.synthetic_batch(data, per_region=3)
    res = B.run_batch(o, l, data)
    assert len(res) == len(o) * 4
    assert set(res["scenario"]) == {"cif_baseline", "distributor", "3pl", "owned_warehouse"}
    avail = res[res["available"]]
    assert (avail["cost_to_serve_eur"] > 0).all()


def test_scorecard_customer_first_and_customer_cost(data):
    o, l, _ = B.synthetic_batch(data, per_region=6)
    sc = B.scorecard(B.run_batch(o, l, data), "customer_first").set_index(["region", "scenario"])
    for region in B.STUDY_REGIONS:
        base = sc.loc[(region, "cif_baseline")]
        assert base["hassle"] > 0 and base["customer_paperwork_steps"] > 0
        for s in ("3pl", "owned_warehouse"):
            row = sc.loc[(region, s)]
            # FlexiTog covers the paperwork: none left with the customer, more on FlexiTog's side.
            assert row["hassle"] == 0
            assert row["customer_cost_per_unit_eur"] == 0
            assert row["flexitog_paperwork"] > base["flexitog_paperwork"]
            assert row["lead_time_days"] < base["lead_time_days"]


def test_winners_report_ties(data):
    o, l, _ = B.synthetic_batch(data, per_region=4)
    w = B.winners(B.scorecard(B.run_batch(o, l, data)))
    assert set(w["region"]) == set(B.STUDY_REGIONS)
    # 3PL and owned warehouse both leave the customer at EUR 0.
    assert w["Customer cost per unit (EUR)"].str.contains(" = ").all()


def test_method_check_flags_non_separating_methods(data):
    o, l, _ = B.synthetic_batch(data, per_region=4)
    mc = B.method_check(B.run_batch(o, l, data))
    cf = mc[mc["method"].str.startswith("Customer-first")]
    assert cf["separates from baseline"].all()
    assert not cf["separates in-scope scenarios"].any()


def test_history_batch_estimates_pallets_and_adds_unknown_customers(ws):
    sh = pd.DataFrame([
        {"order_id": "H1", "order_date": "2026-03-01", "customer_id": "C-SA-01", "sku": "FT-JKT-100",
         "quantity": 240},
        {"order_id": "H1", "order_date": "2026-03-01", "customer_id": "C-SA-01", "sku": "FT-GLV-100",
         "quantity": 600},
        {"order_id": "H2", "order_date": "2026-04-01", "customer_id": "NEW-EG", "sku": "FT-BAL-100",
         "quantity": 100, "country": "EG"},
        {"order_id": "H3", "order_date": "2026-04-01", "customer_id": "NEW-XX", "sku": "FT-BAL-100",
         "quantity": 100},
    ])
    sh["data_source"] = "manual"
    ws.save("sales_history", sh)
    data = Data.from_workspace(ws)
    o, l, cust, notes = B.history_batch(data)
    assert set(o["order_id"]) == {"H1", "H2"}
    assert o.set_index("order_id").loc["H1", "pallet_count"] == 3  # 240/120 + 600/1200 = 2.5
    assert list(cust["customer_id"]) == ["NEW-EG"]
    assert any("skipped" in n for n in notes)


def test_profile_compares_sources(data):
    o, l, _ = B.synthetic_batch(data, per_region=4)
    p = B.profile(o, l, data, "test batch")
    assert set(p["region"]) == set(B.STUDY_REGIONS)
    assert (p["avg_order_value_eur"] > 0).all()
