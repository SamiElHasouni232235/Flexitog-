import io

import pandas as pd
import pytest

from flexitog import importer as imp
from flexitog import parameters as P
from flexitog.orders import order_values, summarise
from flexitog.schema import ENTITIES, PLACEHOLDER, SOURCE_COL, to_iso2
from flexitog.store import Workspace


@pytest.fixture
def ws(tmp_path):
    return Workspace(tmp_path)


MESSY_CUSTOMERS = (
    "Debiteurnummer;Naam;Land;Plaats;Postcode;Incoterms;Account manager\n"
    "D1001;Cold Store A;Saudi Arabia;Riyadh;11564;CIF;Anna\n"
    "D1002;Frozen B;Turkey;Istanbul;34555;CIF;Bas\n"
    "D1003;Fish C;Maroc;Agadir;80000;EXW;Anna\n"
    "D1004;;UAE;Dubai;;CIF;Bas\n"
).encode("cp1252")


def test_guess_mapping_dutch_headers():
    raw = imp.read_table(MESSY_CUSTOMERS, "customers.csv")
    mapping = imp.guess_mapping(list(raw.columns), ENTITIES["customers"])
    assert mapping["Debiteurnummer"] == "customer_id"
    assert mapping["Naam"] == "name"
    assert mapping["Land"] == "country"
    assert mapping["Plaats"] == "city"
    assert mapping["Postcode"] == "postal_code"
    assert mapping["Incoterms"] == "current_incoterm"
    assert mapping["Account manager"] == imp.KEEP


def test_apply_mapping_normalises_country_and_region():
    raw = imp.read_table(MESSY_CUSTOMERS, "customers.csv")
    entity = ENTITIES["customers"]
    res = imp.apply_mapping(raw, imp.guess_mapping(list(raw.columns), entity), entity, "customers.csv")
    assert res.ok
    assert res.frame["country"].tolist() == ["SA", "TR", "MA", "AE"]
    assert res.frame["region"].tolist() == ["Gulf/GCC", "Türkiye", "North Africa", "Gulf/GCC"]
    assert "account_manager" in res.frame.columns
    assert (res.frame[SOURCE_COL] == "imported:customers.csv").all()
    # Row 4 misses the required name.
    assert ((res.row_issues["row"] == 4) & (res.row_issues["field"] == "name")).any()


def test_european_numbers_and_excel_roundtrip():
    df = pd.DataFrame({
        "Item No": ["A1", "A2", "A3"],
        "Omschrijving": ["Jacket", "Glove", "Boot"],
        "Gewicht": ["2,1", "0,25", "bad"],
        "Prijs": ["€ 1.234,50", "24", "129,00"],
        "SASO": ["ja", "nee", ""],
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False, sheet_name="SKUs")
    data = buf.getvalue()
    assert imp.list_sheets(data, "p.xlsx") == ["SKUs"]
    raw = imp.read_table(data, "p.xlsx", sheet="SKUs")
    entity = ENTITIES["products"]
    mapping = imp.guess_mapping(list(raw.columns), entity)
    assert mapping == {"Item No": "sku", "Omschrijving": "description", "Gewicht": "unit_weight_kg",
                       "Prijs": "unit_price_eur", "SASO": "requires_conformity_cert"}
    res = imp.apply_mapping(raw, mapping, entity, "p.xlsx")
    assert res.frame["unit_price_eur"].tolist() == [1234.5, 24.0, 129.0]
    assert res.frame["unit_weight_kg"].iloc[:2].tolist() == [2.1, 0.25]
    assert pd.isna(res.frame["unit_weight_kg"].iloc[2])
    assert any("unit_weight_kg" in w for w in res.warnings)
    assert res.frame["requires_conformity_cert"].iloc[:2].tolist() == [True, False]


def test_missing_required_mapping_is_an_error():
    raw = pd.DataFrame({"x": ["1"]})
    entity = ENTITIES["sales_history"]
    res = imp.apply_mapping(raw, {"x": imp.KEEP}, entity, "s.csv")
    assert not res.ok
    assert any("order_date" in e for e in res.errors)


def test_dates_and_duplicate_keys():
    raw = pd.DataFrame({"Order No": ["1", "1"], "Date": ["31-01-2026", "01-02-2026"],
                        "Customer": ["C1", "C1"], "Item": ["A", "A"], "Qty": ["5", "7"]})
    entity = ENTITIES["sales_history"]
    res = imp.apply_mapping(raw, imp.guess_mapping(list(raw.columns), entity), entity, "s.csv")
    assert str(res.frame["order_date"].iloc[0]) == "2026-01-31"
    assert (res.row_issues["issue"] == "duplicate key").sum() == 2


def test_merge_modes():
    entity = ENTITIES["customers"]
    a = pd.DataFrame({"customer_id": ["1", "2"], "name": ["a", "b"]})
    b = pd.DataFrame({"customer_id": ["2", "3"], "name": ["B", "c"]})
    assert len(imp.merge_into(a, b, entity, "append")) == 4
    up = imp.merge_into(a, b, entity, "upsert")
    assert up.set_index("customer_id")["name"].to_dict() == {"1": "a", "2": "B", "3": "c"}
    assert len(imp.merge_into(a, b, entity, "replace")) == 2


def test_workspace_seeds_and_roundtrips(ws):
    for key in ENTITIES:
        df = ws.load(key)
        ws.save(key, df)
        again = ws.load(key)
        assert list(again.columns) == list(df.columns), key
        assert len(again) == len(df), key
    assert (ws.load("customers")[SOURCE_COL] == PLACEHOLDER).all()
    dcs = ws.load("distribution_centers")
    assert set(dcs["dc_type"]) == {"helmond_hub", "distributor", "3pl", "owned_warehouse"}


def test_custom_field_extends_schema(ws):
    ws.add_custom_field("customers", imp.new_custom_field("Credit limit EUR", "float", "Max exposure"))
    entity = ws.entity("customers")
    assert "credit_limit_eur" in entity.field_names()
    raw = pd.DataFrame({"customer_id": ["1"], "name": ["x"], "country": ["KSA"], "city": ["Riyadh"],
                        "credit limit eur": ["10.000"]})
    mapping = imp.guess_mapping(list(raw.columns), entity)
    # "10.000" alone is ambiguous: auto falls back to decimal dot, forcing "," reads thousands.
    assert imp.apply_mapping(raw, mapping, entity, "c.csv").frame["credit_limit_eur"].iloc[0] == 10.0
    res = imp.apply_mapping(raw, mapping, entity, "c.csv", decimal=",")
    assert res.frame["credit_limit_eur"].iloc[0] == 10000.0


@pytest.mark.parametrize("values,dec", [(["2,1", "1.250"], ","), (["1.234,5"], ","), (["1,234.5"], "."),
                                        (["2.5", "1,250"], "."), (["1,250"], ".")])
def test_detect_decimal(values, dec):
    assert imp.detect_decimal(pd.Series(values)) == dec


def test_parameters_flagged_placeholder(ws):
    for name in P.DEFAULT_TABLES:
        df = ws.load_params(name)
        assert (df["source"] == P.PLACEHOLDER).all(), name
    prov = ws.provenance()
    assert (prov["real share"] == 0).all()


def test_order_summary(ws):
    products, customers = ws.load("products"), ws.load("customers")
    lines = pd.DataFrame({"sku": ["FT-JKT-100", "FT-GLV-100"], "quantity": [120, 300]})
    s = summarise({"order_id": "x", "customer_id": "C-SA-01", "pallet_count": 1}, lines, products, customers)
    assert s.order_value_eur == 120 * 139 + 300 * 24
    assert s.suggested_pallets == 2
    assert not s.errors
    assert any("below" in w for w in s.warnings)

    bad = summarise({"order_id": "y", "customer_id": "nope", "pallet_count": None},
                    pd.DataFrame({"sku": ["ZZZ"], "quantity": [1]}), products, customers)
    assert len(bad.errors) == 3


def test_order_values_table(ws):
    view = order_values(ws.load("orders"), ws.load("order_lines"), ws.load("products"))
    assert view.set_index("order_id").loc["T-SA-001", "order_value_eur"] == 120 * 139 + 300 * 24


@pytest.mark.parametrize("value,code", [("Türkiye", "TR"), ("KSA", "SA"), ("u.a.e.", "AE"),
                                        ("Egypt", "EG"), ("nl", "NL"), ("", None)])
def test_to_iso2(value, code):
    assert to_iso2(value) == code
