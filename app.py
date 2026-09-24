"""FlexiTog EU supply chain route simulator. Phase 1: data model and import.

Run with:  streamlit run app.py
"""
from __future__ import annotations

import io

import pandas as pd
import streamlit as st

from flexitog import importer as imp
from flexitog import parameters as P
from flexitog.orders import order_values, summarise
from flexitog.schema import (
    DC_TYPE_LABELS, DTYPES, ENTITIES, IMPORTED_PREFIX, MANUAL, PLACEHOLDER, PRIMARY_IMPORTS, SOURCE_COL,
)
from flexitog.store import Workspace

st.set_page_config(page_title="FlexiTog Route Simulator", layout="wide")


@st.cache_resource
def workspace() -> Workspace:
    return Workspace()


ws = workspace()


def source_badge(src: str) -> str:
    if src == PLACEHOLDER:
        return "🟡 placeholder"
    if str(src).startswith(IMPORTED_PREFIX):
        return "🟢 imported"
    if src in (MANUAL, P.REAL):
        return "🟢 real"
    return str(src)


def column_config(entity) -> dict:
    cfg = {}
    for f in entity.fields:
        help_text = f.description or None
        label = f.name + (" *" if f.required else "")
        if f.allowed:
            cfg[f.name] = st.column_config.SelectboxColumn(label, options=f.allowed, help=help_text)
        elif f.dtype in ("float", "int"):
            cfg[f.name] = st.column_config.NumberColumn(label, help=help_text,
                                                        step=1 if f.dtype == "int" else None)
        elif f.dtype == "date":
            cfg[f.name] = st.column_config.DateColumn(label, help=help_text)
        elif f.dtype == "bool":
            cfg[f.name] = st.column_config.CheckboxColumn(label, help=help_text)
        else:
            cfg[f.name] = st.column_config.TextColumn(label, help=help_text)
    cfg[SOURCE_COL] = st.column_config.TextColumn("data source", disabled=True)
    return cfg


def mark_manual_edits(before: pd.DataFrame, after: pd.DataFrame) -> pd.DataFrame:
    """Rows that are new or changed in the editor become data_source=manual."""
    out = after.copy()
    cols = [c for c in after.columns if c != SOURCE_COL]
    for idx in out.index:
        if idx not in before.index:
            out.at[idx, SOURCE_COL] = MANUAL
            continue
        a = out.loc[idx, cols].astype(str).tolist()
        b = before.loc[idx, cols].astype(str).tolist() if set(cols) <= set(before.columns) else None
        if a != b:
            out.at[idx, SOURCE_COL] = MANUAL
    out[SOURCE_COL] = out[SOURCE_COL].fillna(MANUAL)
    return out


# ====================================================================== pages

def page_overview():
    st.title("FlexiTog EU route simulator")
    st.caption("Origin: Helmond EU hub. Outbound to Türkiye, North Africa and Gulf/GCC. "
               "US and UK operations are out of scope. DAP direct is out of scope.")

    st.subheader("Build status")
    c1, c2, c3 = st.columns(3)
    c1.success("Phase 1: data model + import (this build)")
    c2.info("Phase 2: single-order engine (next)")
    c3.info("Phase 3: batch mode + scorecard")

    st.subheader("Data health: placeholder vs real")
    prov = ws.provenance()
    st.dataframe(
        prov, hide_index=True, width="stretch",
        column_config={"real share": st.column_config.ProgressColumn("real share", min_value=0, max_value=1,
                                                                      format="percent")},
    )
    st.caption("🟡 placeholder = generic default shipped with the tool. 🟢 real = imported from a file, "
               "entered by hand, or a parameter you marked as real.")

    st.subheader("Scenarios the engine will compare")
    st.markdown(
        "- **Baseline: CIF to port.** FlexiTog pays freight and insurance Helmond to destination port. "
        "Customer clears customs, pays duty, moves goods inland.\n"
        "- **Distributor-held stock.** Distributor imports and holds stock, sells on locally.\n"
        "- **3PL presence.** FlexiTog-owned stock at a regional 3PL.\n"
        "- **Owned non-EU warehouse.** FlexiTog-run warehouse in the region."
    )


def page_import():
    st.title("Import data")
    st.caption("CSV (comma, semicolon or tab) or Excel. Column names are matched automatically. "
               "Check and override the mapping before you commit.")

    keys = PRIMARY_IMPORTS + [k for k in ENTITIES if k not in PRIMARY_IMPORTS]
    key = st.selectbox("What are you importing?", keys, format_func=lambda k: ENTITIES[k].label)
    entity = ws.entity(key)
    st.caption(entity.description)

    with st.expander("Schema, templates and custom fields"):
        st.dataframe(imp.schema_table(entity), hide_index=True, width="stretch")
        t1, t2 = st.columns(2)
        t1.download_button("Download CSV template", imp.template_frame(entity).to_csv(index=False).encode(),
                           file_name=f"{key}_template.csv", mime="text/csv")
        buf = io.BytesIO()
        imp.template_frame(entity).to_excel(buf, index=False, sheet_name=key[:31])
        t2.download_button("Download Excel template", buf.getvalue(), file_name=f"{key}_template.xlsx")

        st.markdown("**Add a custom field** (for data that has no slot yet)")
        cf1, cf2, cf3, cf4 = st.columns([2, 1, 3, 1])
        cname = cf1.text_input("Field name", key=f"cf_name_{key}")
        ctype = cf2.selectbox("Type", DTYPES, key=f"cf_type_{key}")
        cdesc = cf3.text_input("Description", key=f"cf_desc_{key}")
        if cf4.button("Add", key=f"cf_add_{key}") and cname.strip():
            ws.add_custom_field(key, imp.new_custom_field(cname, ctype, cdesc))
            st.rerun()
        customs = [f.name for f in entity.fields if f.custom]
        if customs:
            rm = st.selectbox("Remove custom field", ["-"] + customs, key=f"cf_rm_{key}")
            if rm != "-" and st.button("Remove", key=f"cf_rm_btn_{key}"):
                ws.remove_custom_field(key, rm)
                st.rerun()

    up = st.file_uploader("File", type=["csv", "txt", "xlsx", "xlsm", "xls"], key=f"upload_{key}")
    if not up:
        return
    data = up.getvalue()
    sheets = imp.list_sheets(data, up.name)
    s1, s2, s3 = st.columns(3)
    sheet = s1.selectbox("Sheet", sheets) if sheets else None
    header_row = s2.number_input("Header row (1 = first row)", min_value=1, value=1, step=1) - 1
    decimal = s3.selectbox("Decimal separator", ["auto", ",", "."],
                           help="auto detects per column. Force ',' for Dutch exports like 10.000 = ten thousand")
    try:
        raw = imp.read_table(data, up.name, sheet=sheet, header_row=int(header_row))
    except Exception as exc:  # noqa: BLE001 - surface any parser error to the user
        st.error(f"Could not read file: {exc}")
        return
    st.write(f"{len(raw)} rows, {len(raw.columns)} columns")
    st.dataframe(raw.head(10), width="stretch")

    st.subheader("Column mapping")
    guessed = imp.guess_mapping(list(raw.columns), entity)
    options = [imp.IGNORE, imp.KEEP] + entity.field_names()
    map_df = pd.DataFrame({
        "source column": list(guessed),
        "sample": [str(raw[c].dropna().iloc[0]) if raw[c].notna().any() else "" for c in guessed],
        "maps to": list(guessed.values()),
    })
    edited = st.data_editor(
        map_df, hide_index=True, width="stretch", key=f"map_{key}_{up.name}",
        column_config={
            "source column": st.column_config.TextColumn(disabled=True),
            "sample": st.column_config.TextColumn(disabled=True),
            "maps to": st.column_config.SelectboxColumn(options=options, required=True),
        },
    )
    mapping = dict(zip(edited["source column"], edited["maps to"]))
    missing = [f for f in entity.required_fields() if f not in mapping.values()]
    if missing:
        st.warning(f"Required fields not mapped: {', '.join(missing)}")

    result = imp.apply_mapping(raw, mapping, entity, up.name, decimal=decimal)
    for e in result.errors:
        st.error(e)
    for w in result.warnings:
        st.warning(w)
    issues = result.row_issues
    if issues is not None and len(issues):
        st.warning(f"{issues['row'].nunique()} row(s) with issues")
        st.dataframe(issues, hide_index=True, width="stretch", height=200)

    st.subheader("Preview after mapping")
    st.dataframe(result.frame.head(50), width="stretch")

    existing = ws.load(key)
    only_placeholders = len(existing) > 0 and (existing[SOURCE_COL] == PLACEHOLDER).all()
    if only_placeholders:
        st.info(f"{entity.label} holds only placeholder rows. 'replace' removes them, "
                "'upsert' keeps them next to your data.")
    c1, c2 = st.columns(2)
    modes = ["upsert", "append", "replace"]
    mode = c1.radio("Commit mode", modes, horizontal=True, index=2 if only_placeholders else 0,
                    help="upsert: overwrite rows with the same key. append: add all rows. "
                         "replace: drop everything that is there now, including placeholders.")
    drop_bad = c2.checkbox("Skip rows with issues", value=False)
    if st.button("Commit import", type="primary", disabled=bool(result.errors)):
        frame = result.frame
        if drop_bad and issues is not None and len(issues):
            frame = frame.drop(index=[r - 1 for r in issues["row"].unique()])
        merged = imp.merge_into(existing, frame, entity, mode)
        ws.save(key, merged)
        st.success(f"Saved {len(frame)} row(s) to {entity.label}. Table now has {len(merged)} rows.")


def page_data():
    st.title("Master data")
    key = st.selectbox("Table", list(ENTITIES), format_func=lambda k: ENTITIES[k].label)
    entity = ws.entity(key)
    st.caption(entity.description)
    df = ws.load(key)
    if key == "distribution_centers":
        st.caption("Types: " + ", ".join(f"{k} = {v}" for k, v in DC_TYPE_LABELS.items()))

    src = df[SOURCE_COL].astype(str) if len(df) else pd.Series(dtype=str)
    st.write(f"{len(df)} rows. 🟡 {int((src == PLACEHOLDER).sum())} placeholder, "
             f"🟢 {int((src != PLACEHOLDER).sum())} real")

    edited = st.data_editor(df, num_rows="dynamic", width="stretch",
                            column_config=column_config(entity), key=f"edit_{key}")
    c1, c2, _ = st.columns([1, 1, 4])
    if c1.button("Save changes", type="primary"):
        out = mark_manual_edits(df, edited)
        ws.save(key, out)
        st.success("Saved. Edited and new rows are marked as manual (real).")
        st.rerun()
    if c2.button("Reset to placeholders"):
        ws.reset(key)
        st.rerun()
    st.download_button("Download CSV", df.to_csv(index=False).encode(), file_name=f"{key}.csv")


def page_parameters():
    st.title("Parameters")
    st.caption("Every value carries a source flag. 🟡 placeholder = default from general supply-chain "
               "knowledge. 🟢 real = confirmed by a FlexiTog quote, invoice or broker. "
               "The engine (phase 2) reads these tables.")
    name = st.selectbox("Table", list(P.DEFAULT_TABLES), format_func=lambda n: P.DEFAULT_TABLES[n][0])
    df = ws.load_params(name)
    n_ph = int((df["source"] == P.PLACEHOLDER).sum())
    st.write(f"{len(df)} rows. 🟡 {n_ph} placeholder, 🟢 {len(df) - n_ph} real")

    cfg = {"source": st.column_config.SelectboxColumn("source", options=P.PARAM_SOURCES, required=True)}
    edited = st.data_editor(df, num_rows="dynamic", width="stretch", column_config=cfg,
                            key=f"param_{name}")
    auto_real = st.checkbox("Mark rows I change as real", value=True)
    c1, c2, _ = st.columns([1, 1, 4])
    if c1.button("Save parameters", type="primary"):
        out = edited.copy()
        if auto_real:
            value_cols = [c for c in out.columns if c not in ("source", "source_note")]
            for idx in out.index:
                if idx not in df.index:
                    out.at[idx, "source"] = P.REAL
                elif out.loc[idx, value_cols].astype(str).tolist() != df.loc[idx, value_cols].astype(str).tolist():
                    out.at[idx, "source"] = P.REAL
        out["source"] = out["source"].fillna(P.PLACEHOLDER)
        ws.save_params(name, out)
        st.success("Saved.")
        st.rerun()
    if c2.button("Reset table to defaults"):
        ws.reset_params(name)
        st.rerun()

    up = st.file_uploader("Replace this table from CSV/Excel (same columns)", type=["csv", "xlsx"],
                          key=f"param_up_{name}")
    if up and st.button("Load file into table"):
        new = imp.read_table(up.getvalue(), up.name)
        missing = [c for c in df.columns if c not in new.columns and c not in ("source", "source_note")]
        if missing:
            st.error(f"Missing columns: {', '.join(missing)}")
        else:
            for c in new.columns:
                if c in df.columns and pd.api.types.is_numeric_dtype(df[c]):
                    new[c] = pd.to_numeric(new[c], errors="coerce")
            new["source"] = new["source"].fillna(P.REAL) if "source" in new.columns else P.REAL
            new["source_note"] = new.get("source_note", f"from {up.name}")
            ws.save_params(name, new)
            st.success(f"Loaded {len(new)} rows, marked real.")
            st.rerun()


def page_orders():
    st.title("Test orders")
    products = ws.load("products")
    customers = ws.load("customers")
    suppliers = ws.load("suppliers")
    dcs = ws.load("distribution_centers")
    orders = ws.load("orders")
    lines = ws.load("order_lines")
    general = ws.load_params("general").set_index("parameter")["value"]
    pallet_m3 = float(general.get("pallet_volume_m3", 1.73))
    pallet_kg = float(general.get("pallet_max_weight_kg", 500))

    st.subheader("Existing test orders")
    view = order_values(orders, lines, products)
    st.dataframe(view, hide_index=True, width="stretch")
    orphan_cust = sorted(set(orders["customer_id"].dropna().astype(str)) - set(customers["customer_id"].astype(str)))
    orphan_sku = sorted(set(lines["sku"].dropna().astype(str)) - set(products["sku"].astype(str)))
    if orphan_cust:
        st.warning(f"Test orders point at customers not in the customer table: {', '.join(orphan_cust)}")
    if orphan_sku:
        st.warning(f"Test order lines point at SKUs not in the product table: {', '.join(orphan_sku)}")

    st.subheader("New test order")
    c1, c2, c3 = st.columns(3)
    cust_labels = {r.customer_id: f"{r.customer_id} | {r.name} | {r.city}, {r.country}"
                   for r in customers.itertuples()}
    customer_id = c1.selectbox("Customer", list(cust_labels), format_func=cust_labels.get)
    supplier_id = c2.selectbox("Supplier (optional)", [""] + suppliers["supplier_id"].tolist(),
                               format_func=lambda s: "Stock in Helmond" if not s else s)
    dc_opts = [""] + dcs["dc_id"].tolist()
    dc_override = c3.selectbox("Distribution center", dc_opts,
                               format_func=lambda d: "Auto (engine recommends)" if not d else d)

    st.markdown("**SKU lines**")
    sku_opts = products["sku"].dropna().astype(str).tolist()
    blank = pd.DataFrame({"sku": pd.Series([], dtype=object), "quantity": pd.Series([], dtype=float)})
    line_df = st.data_editor(
        blank, num_rows="dynamic", width="stretch", key="new_lines",
        column_config={"sku": st.column_config.SelectboxColumn("sku", options=sku_opts, required=True),
                       "quantity": st.column_config.NumberColumn("quantity", min_value=0, step=1, required=True)},
    )
    line_df = line_df.dropna(subset=["sku"])

    preview = summarise({"order_id": "preview", "customer_id": customer_id, "pallet_count": 1},
                        line_df, products, customers, pallet_m3, pallet_kg)
    d1, d2, d3, d4 = st.columns(4)
    d1.metric("Order value", f"€ {preview.order_value_eur:,.0f}")
    d2.metric("Weight", f"{preview.total_weight_kg:,.0f} kg")
    d3.metric("Volume", f"{preview.total_volume_m3:,.2f} m³")
    d4.metric("Suggested pallets", preview.suggested_pallets)

    e1, e2, e3 = st.columns(3)
    order_id = e1.text_input("Order id", value=f"T-{len(orders) + 1:03d}")
    pallet_count = e2.number_input("Pallet count (required)", min_value=0.0, step=1.0,
                                   value=float(preview.suggested_pallets or 0))
    pallet_type = e3.selectbox("Pallet type", ["EUR", "industrial", "custom"])
    batch = st.text_input("Batch label (e.g. GCC test set)", value="")

    if st.button("Save test order", type="primary"):
        order = {"order_id": order_id, "customer_id": customer_id, "supplier_id": supplier_id or None,
                 "dc_override": dc_override or None, "pallet_count": pallet_count or None,
                 "pallet_type": pallet_type, "order_date": pd.Timestamp.today().date(),
                 "batch": batch or None, SOURCE_COL: MANUAL}
        check = summarise(order, line_df, products, customers, pallet_m3, pallet_kg)
        if order_id in set(orders["order_id"].astype(str)):
            check.errors.append(f"Order id {order_id} exists already.")
        if check.errors:
            for e in check.errors:
                st.error(e)
        else:
            for w in check.warnings:
                st.warning(w)
            new_lines = line_df.assign(order_id=order_id, **{SOURCE_COL: MANUAL})[["order_id", "sku", "quantity",
                                                                                    SOURCE_COL]]
            ws.save("orders", pd.concat([orders, pd.DataFrame([order])], ignore_index=True))
            ws.save("order_lines", pd.concat([lines, new_lines], ignore_index=True))
            st.success(f"Saved {order_id}: € {check.order_value_eur:,.0f}, {pallet_count:g} pallet(s).")

    if len(orders):
        st.subheader("Delete a test order")
        del_id = st.selectbox("Order", [""] + orders["order_id"].astype(str).tolist())
        if del_id and st.button("Delete"):
            ws.save("orders", orders[orders["order_id"].astype(str) != del_id])
            ws.save("order_lines", lines[lines["order_id"].astype(str) != del_id])
            st.rerun()


PAGES = {
    "Overview": page_overview,
    "Import data": page_import,
    "Master data": page_data,
    "Parameters": page_parameters,
    "Test orders": page_orders,
}

with st.sidebar:
    st.header("FlexiTog")
    choice = st.radio("Page", list(PAGES), label_visibility="collapsed")
    st.caption(f"Workspace: {ws.root}")

PAGES[choice]()
