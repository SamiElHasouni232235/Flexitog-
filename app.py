"""FlexiTog EU supply chain route simulator. Phase 1: data model and import.

Run with:  streamlit run app.py
"""
from __future__ import annotations

import io

import altair as alt
import pandas as pd
import streamlit as st

from flexitog import importer as imp
from flexitog import batch as B
from flexitog import parameters as P
from flexitog.engine import Data, compare_to_baseline, evaluate
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
    c1.success("Phase 1: data model + import (done)")
    c2.success("Phase 2: single-order engine (done)")
    c3.success("Phase 3: batch mode + scorecard (done)")

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

    import_flow(key)


def import_flow(key: str, prefix: str = "") -> None:
    """Upload, map, validate and commit one file into an entity table."""
    entity = ws.entity(key)
    up = st.file_uploader("File", type=["csv", "txt", "xlsx", "xlsm", "xls"], key=f"{prefix}upload_{key}")
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
        map_df, hide_index=True, width="stretch", key=f"{prefix}map_{key}_{up.name}",
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


PAYER_COLORS = {"FlexiTog": "#2a78d6", "partner": "#eb6834", "customer": "#1baf7a"}  # fixed order
BAR_BLUE = "#2a78d6"


def surface_color() -> str:
    """Background colour, used for the 2px gap between stacked segments."""
    try:
        return "#0e1117" if st.context.theme.type == "dark" else "#ffffff"
    except Exception:  # noqa: BLE001 - older Streamlit or no browser context
        return "#ffffff"


def payer_chart(ev) -> alt.Chart:
    rows = []
    for r in ev.routes:
        if not r.feasible:
            continue
        for payer in PAYER_COLORS:
            rows.append({"route": ("★ " if r is ev.recommended else "") + r.label, "payer": payer,
                         "eur": round(r.paid(payer), 0), "order": list(PAYER_COLORS).index(payer)})
    df = pd.DataFrame(rows)
    return (
        alt.Chart(df).mark_bar(cornerRadiusEnd=4, stroke=surface_color(), strokeWidth=2, height=18)
        .encode(
            y=alt.Y("route:N", title=None, sort=None, axis=alt.Axis(labelLimit=320)),
            x=alt.X("sum(eur):Q", title="Cost to serve (EUR)", stack="zero"),
            color=alt.Color("payer:N", title="Paid by",
                            scale=alt.Scale(domain=list(PAYER_COLORS), range=list(PAYER_COLORS.values())),
                            legend=alt.Legend(orient="top")),
            order=alt.Order("order:Q"),
            tooltip=[alt.Tooltip("route:N"), alt.Tooltip("payer:N"), alt.Tooltip("eur:Q", format=",.0f")],
        )
        .properties(height=alt.Step(30))
    )


def category_chart(route) -> alt.Chart:
    df = pd.DataFrame([{"category": k.replace("_", " "), "eur": round(v, 0)}
                       for k, v in route.by_category().items() if v > 0])
    return (
        alt.Chart(df).mark_bar(color=BAR_BLUE, cornerRadiusEnd=4, height=16)
        .encode(y=alt.Y("category:N", sort="-x", title=None), x=alt.X("eur:Q", title="EUR"),
                tooltip=[alt.Tooltip("category:N"), alt.Tooltip("eur:Q", format=",.0f")])
        .properties(height=alt.Step(26))
    )


def page_engine():
    st.title("Route engine")
    st.caption("Runs one test order through the CIF baseline and every distributor, 3PL and owned-warehouse "
               "node that serves the customer's country. Recommends the lowest risk-adjusted cost among the "
               "three in-scope scenarios. Risk premiums favour proven lanes and signed partners.")
    data = Data.from_workspace(ws)
    orders = ws.load("orders")
    lines = ws.load("order_lines")
    if orders.empty:
        st.info("Create a test order first.")
        return
    labels = {r.order_id: f"{r.order_id} | {r.customer_id} | {r.pallet_count:g} pallet(s)"
              for r in orders.itertuples()}
    c1, c2 = st.columns([2, 1])
    oid = c1.selectbox("Test order", list(labels), format_func=labels.get)
    include_base = c2.checkbox("Let baseline win the recommendation", value=False)
    order = orders[orders["order_id"] == oid].iloc[0].to_dict()
    olines = lines[lines["order_id"] == oid]

    ev = evaluate(order, olines, data, include_baseline=include_base)
    keys = ["auto"] + [r.key for r in ev.routes]
    names = {"auto": "Auto (recommended)", **{r.key: r.label for r in ev.routes}}
    default = str(order.get("dc_override") or "auto")
    choice = st.selectbox("Route to inspect (override)", keys, format_func=names.get,
                          index=keys.index(default) if default in keys else 0)
    ev = evaluate(order, olines, data, override=None if choice == "auto" else choice,
                  include_baseline=include_base)
    for n in ev.notes:
        st.info(n)

    if ev.recommended:
        st.success(f"Recommended: {ev.recommended.label}. {ev.reason}")
    else:
        st.error(ev.reason)

    st.subheader("All routes")
    st.altair_chart(payer_chart(ev), width="stretch")
    table = ev.table()
    st.dataframe(
        table[["recommended", "route", "feasible", "below_mov", "cost_to_serve_eur", "cost_per_unit_eur",
               "cost_pct_of_value", "flexitog_pays_eur", "partner_pays_eur", "customer_pays_eur",
               "lead_time_days", "lane_status", "dc_status", "risk_premium_pct", "customs_touchpoints",
               "handoffs", "doc_steps", "customer_steps", "placeholder_cost_share", "issues", "warnings"]],
        hide_index=True, width="stretch",
        column_config={"placeholder_cost_share": st.column_config.ProgressColumn(
            "placeholder share", min_value=0, max_value=1, format="percent")},
    )
    st.caption("Cost to serve = everything between Helmond stock and goods at the customer, excluding the goods "
               "themselves and recoverable import VAT. Hassle columns feed phase 3.")

    r = ev.selected
    if r is None:
        return
    st.subheader(f"Selected: {r.label}")
    if r is not ev.recommended:
        st.warning("Override active. This is not the recommended route.")
    m = st.columns(5)
    m[0].metric("Cost to serve", f"€ {r.cost_to_serve:,.0f}")
    m[1].metric("Per unit", f"€ {r.cost_per_unit:,.2f}")
    m[2].metric("% of order value", f"{r.cost_pct_of_value:.1f}%")
    m[3].metric("Lead time", f"{r.lead_time_days:.0f} days")
    m[4].metric("Import VAT (recoverable)", f"€ {r.vat_eur:,.0f}")
    for w in r.warnings + r.issues:
        st.warning(w)
    if r.placeholder_cost_share > 0.5:
        st.warning(f"{r.placeholder_cost_share:.0%} of this cost rests on placeholder parameters.")

    if ev.baseline and r is not ev.baseline:
        d = compare_to_baseline(r, ev.baseline)
        st.markdown("**Versus the CIF baseline**")
        b = st.columns(4)
        b[0].metric("Cost to serve", f"€ {r.cost_to_serve:,.0f}", f"{d['cost_to_serve_delta_eur']:+,.0f} €",
                    delta_color="inverse")
        b[1].metric("Customer pays", f"€ {r.paid('customer'):,.0f}", f"{d['customer_pays_delta_eur']:+,.0f} €",
                    delta_color="inverse")
        b[2].metric("Lead time", f"{r.lead_time_days:.0f} d", f"{d['lead_time_delta_days']:+.0f} d",
                    delta_color="inverse")
        b[3].metric("Customer steps removed", d["customer_steps_removed"])

    left, right = st.columns([3, 2])
    with left:
        st.markdown("**Steps**")
        sf = r.steps_frame()
        sf["cost_eur"] = sf["cost_eur"].round(2)
        sf["source"] = sf["source"].map(lambda s: "🟡" if s == P.PLACEHOLDER else "🟢" if s == P.REAL else "")
        st.dataframe(sf[["step", "category", "cost_eur", "days", "paid_by", "party", "customs", "doc_steps",
                         "source", "note"]], hide_index=True, width="stretch")
    with right:
        st.markdown("**Cost by category**")
        st.altair_chart(category_chart(r), width="stretch")
        st.caption(f"Lane: {r.lane_status} ({r.lane_basis}). Parties: {' → '.join(r.parties)}")


# Baseline is the reference, so it takes a neutral grey. In-scope scenarios take categorical slots 1-3.
SCENARIO_COLORS = {"Baseline: CIF to port": "#8a8984", "Distributor-held stock": "#2a78d6",
                   "3PL presence": "#eb6834", "Owned non-EU warehouse": "#1baf7a"}
SCORE_METRICS = {**B.METRICS, "cost_pct_of_value": ("Cost to serve, % of order value", True),
                 "coverage": ("Coverage (share of orders servable)", False)}


def scorecard_chart(sc: pd.DataFrame, metric: str) -> alt.Chart:
    label = SCORE_METRICS[metric][0]
    df = sc[["region", "scenario_label", metric]].rename(columns={metric: "value"}).dropna()
    order = list(SCENARIO_COLORS)
    base = alt.Chart(df).encode(
        y=alt.Y("scenario_label:N", title=None, sort=order, axis=alt.Axis(labelLimit=200)),
        x=alt.X("value:Q", title=label),
        tooltip=[alt.Tooltip("region:N"), alt.Tooltip("scenario_label:N", title="scenario"),
                 alt.Tooltip("value:Q", title=label, format=",.2f")],
    )
    bars = base.mark_bar(cornerRadiusEnd=4, height=16).encode(
        color=alt.Color("scenario_label:N", title="Scenario",
                        scale=alt.Scale(domain=order, range=list(SCENARIO_COLORS.values())),
                        legend=alt.Legend(orient="top")))
    text = base.mark_text(align="left", dx=4, fontSize=11).encode(text=alt.Text("value:Q", format=",.2f"))
    return (bars + text).properties(width=260, height=alt.Step(24)).facet(
        column=alt.Column("region:N", title=None, sort=B.STUDY_REGIONS + ["Middle East (other)", "Other"]))


def page_batch():
    st.title("Batch simulation and scorecard")
    st.caption("Builds a representative batch of orders per region, runs every order through the CIF baseline "
               "and the three in-scope scenarios (best node per scenario), and scores each region.")
    data = Data.from_workspace(ws)
    ss = st.session_state
    t_build, t_hist, t_score = st.tabs(["1. Build batch", "2. Sales history", "3. Scorecard"])

    # ------------------------------------------------------------ build
    with t_build:
        source = st.radio("Batch source", ["Synthetic test batch", "Saved test orders", "Sales history"],
                          horizontal=True,
                          help="Use the synthetic batch until real sales history is imported.")
        extra_customers = pd.DataFrame()
        if source == "Synthetic test batch":
            c1, c2, c3 = st.columns([1, 1, 2])
            per_region = c1.number_input("Orders per region", 1, 500, 15)
            seed = c2.number_input("Random seed", 0, 10_000, 42)
            regions = c3.multiselect("Regions", B.STUDY_REGIONS, default=B.STUDY_REGIONS)
            st.caption("Size mix: 50% single pallet, 35% 2-4 pallets, 15% 6-10 pallets. 1-4 SKUs per order, "
                       "customers drawn from the customer table.")
        elif source == "Saved test orders":
            orders_all = ws.load("orders")
            labels = sorted(orders_all["batch"].fillna("(no label)").astype(str).unique())
            chosen = st.multiselect("Batch labels", labels, default=labels)
        else:
            n_hist = ws.load("sales_history")["order_id"].nunique()
            st.write(f"Sales history holds {n_hist} order(s). Import more on tab 2.")
            c1, c2 = st.columns(2)
            per_region_h = c1.number_input("Max orders per region (0 = all)", 0, 100_000, 0)
            since = c2.date_input("Orders since", value=None)

        if st.button("Build batch", type="primary"):
            notes: list[str] = []
            if source == "Synthetic test batch":
                o, l, notes = B.synthetic_batch(data, int(per_region), int(seed), regions)
            elif source == "Saved test orders":
                orders_all = ws.load("orders")
                o = orders_all[orders_all["batch"].fillna("(no label)").astype(str).isin(chosen)]
                l = ws.load("order_lines")
                l = l[l["order_id"].isin(o["order_id"])]
            else:
                o, l, extra_customers, notes = B.history_batch(data, int(per_region_h) or None, since=since)
            ss["batch"] = {"orders": o, "lines": l, "customers": extra_customers, "source": source}
            ss.pop("results", None)
            for n in notes:
                st.info(n)

        b = ss.get("batch")
        if b and len(b["orders"]):
            d2 = _with_customers(data, b["customers"])
            prof = B.profile(b["orders"], b["lines"], d2, b["source"])
            st.markdown(f"**Current batch:** {len(b['orders'])} orders from {b['source'].lower()}")
            st.dataframe(prof.round(1), hide_index=True, width="stretch")
            with st.expander("Orders in batch"):
                st.dataframe(order_values(b["orders"], b["lines"], data.products), hide_index=True,
                             width="stretch")
            if b["source"] == "Synthetic test batch" and st.button("Save batch as test orders"):
                orders_all, lines_all = ws.load("orders"), ws.load("order_lines")
                keep = ~orders_all["order_id"].isin(b["orders"]["order_id"])
                ws.save("orders", pd.concat([orders_all[keep], b["orders"]], ignore_index=True))
                ws.save("order_lines", pd.concat([lines_all[~lines_all["order_id"].isin(b["orders"]["order_id"])],
                                                  b["lines"].assign(data_source="synthetic")], ignore_index=True))
                st.success("Saved. Edit them on the Test orders page.")
        elif b:
            st.warning("The batch is empty.")

    # ------------------------------------------------------------ sales history
    with t_hist:
        sh = ws.load("sales_history")
        if len(sh):
            dates = pd.to_datetime(sh["order_date"], errors="coerce")
            st.write(f"{sh['order_id'].nunique()} orders, {len(sh)} lines, "
                     f"{dates.min():%d %b %Y} to {dates.max():%d %b %Y}.")
        else:
            st.info("No sales history yet. Upload an export below. Minimum columns: order number, date, "
                    "customer, SKU, quantity. Country, value, pallets and shipped-via improve the results.")
        import_flow("sales_history", prefix="batch_")

        if len(sh) and ss.get("batch") and ss["batch"]["source"] != "Sales history":
            st.subheader("Test batch versus sales history")
            ho, hl, hc, _ = B.history_batch(data)
            b = ss["batch"]
            d2 = _with_customers(data, pd.concat([b["customers"], hc], ignore_index=True))
            both = pd.concat([B.profile(b["orders"], b["lines"], d2, "test batch"),
                              B.profile(ho, hl, d2, "sales history")], ignore_index=True)
            st.dataframe(both.sort_values(["region", "source"]).round(1), hide_index=True, width="stretch")
            st.caption("If the test batch differs a lot from history on order value or pallets, build the batch "
                       "from sales history instead, or change the synthetic size mix.")
            if len(sh) and "shipped_via" in sh:
                st.markdown("**Lanes proven by history** (orders in the last 12 months)")
                via, direct = data.history_counts()
                st.dataframe(pd.DataFrame(
                    [{"lane": f"Helmond -> {k or '(direct)'}", "orders": v} for k, v in via.items()] +
                    [{"lane": f"Helmond direct -> {k}", "orders": v} for k, v in direct.items()]),
                    hide_index=True)

    # ------------------------------------------------------------ scorecard
    with t_score:
        b = ss.get("batch")
        if not b or b["orders"].empty:
            st.info("Build a batch on tab 1 first.")
            return
        keys = list(B.HASSLE_METHODS)
        method = st.selectbox("Hassle method", keys, format_func=lambda k: B.HASSLE_METHODS[k][0])
        st.caption(B.HASSLE_METHODS[method][1])
        if st.button("Run batch", type="primary") or "results" not in ss:
            bar = st.progress(0.0, text="Running orders")
            d2 = _with_customers(data, b["customers"])
            ss["results"] = B.run_batch(b["orders"], b["lines"], d2, progress=lambda p: bar.progress(p))
            bar.empty()
        res = ss["results"]
        sc = B.scorecard(res, method)
        if sc.empty:
            st.warning("No results.")
            return

        ph = res.loc[res["available"], "placeholder_cost_share"].mean()
        if ph > 0.5:
            st.warning(f"{ph:.0%} of simulated cost rests on placeholder parameters. Treat winners as indicative.")

        st.subheader("Winners per region")
        st.caption("Best in-scope scenario per dimension, with the CIF baseline for reference. Lower is better. "
                   "'=' marks a tie.")
        st.dataframe(B.winners(sc), hide_index=True, width="stretch")

        metric = st.selectbox("Chart metric", list(SCORE_METRICS), format_func=lambda m: SCORE_METRICS[m][0])
        st.altair_chart(scorecard_chart(sc, metric))

        st.subheader("Scorecard")
        view = sc.drop(columns=["scenario"]).rename(columns={"hassle": f"hassle ({method})"})
        st.dataframe(view, hide_index=True, width="stretch", column_config={
            "coverage": st.column_config.ProgressColumn("coverage", min_value=0, max_value=1, format="percent"),
            "proven_lane_share": st.column_config.NumberColumn("proven lanes", format="percent"),
            "placeholder_cost_share": st.column_config.NumberColumn("placeholder share", format="percent"),
            **{c: st.column_config.NumberColumn(c, format="%.2f") for c in view.columns
               if view[c].dtype.kind == "f" and c not in ("coverage", "proven_lane_share",
                                                          "placeholder_cost_share")},
        })
        st.caption("Coverage = share of batch orders the scenario serves (a node covers the country and the "
                   "order meets its minimum order value). Averages use covered orders only. Customer cost = "
                   "what the customer pays on top of the goods, including distributor margin. FlexiTog "
                   "paperwork = customs touchpoints plus document steps FlexiTog or its contracted broker/3PL "
                   "handles.")

        st.subheader("Does the hassle method differentiate?")
        mc = B.method_check(res)
        st.dataframe(mc.round(2), hide_index=True, width="stretch")
        st.caption("Customer-first separates every in-scope scenario from the baseline, but scores all three at "
                   "0 when they take over the paperwork. FlexiTog paperwork then shows the cost of covering it "
                   "on your side, and it does separate them.")

        c1, c2 = st.columns(2)
        c1.download_button("Download order results (CSV)", res.to_csv(index=False).encode(),
                           file_name="batch_results.csv")
        c2.download_button("Download scorecard (CSV)", sc.to_csv(index=False).encode(), file_name="scorecard.csv")


def _with_customers(data: Data, extra: pd.DataFrame) -> Data:
    """Data with customers added that exist only in sales history."""
    if extra is None or extra.empty:
        return data
    from dataclasses import replace
    merged = pd.concat([data.customers, extra[~extra["customer_id"].isin(data.customers["customer_id"])]],
                       ignore_index=True)
    return replace(data, customers=merged, _history=None)


PAGES = {
    "Overview": page_overview,
    "Import data": page_import,
    "Master data": page_data,
    "Parameters": page_parameters,
    "Test orders": page_orders,
    "Route engine": page_engine,
    "Batch and scorecard": page_batch,
}

with st.sidebar:
    st.header("FlexiTog")
    choice = st.radio("Page", list(PAGES), label_visibility="collapsed")
    st.caption(f"Workspace: {ws.root}")

PAGES[choice]()
