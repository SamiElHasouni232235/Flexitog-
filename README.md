# FlexiTog EU route simulator

Simulates how a customer order flows from the Helmond EU hub to Türkiye, North Africa and Gulf/GCC
under four scenarios, and compares them on cost, lead time and hassle.

| Scenario | What it models |
|---|---|
| Baseline: CIF to port | FlexiTog pays freight + insurance to destination port. Customer clears, pays duty, moves goods inland. |
| Distributor-held stock | Distributor imports and holds stock in-country. |
| 3PL presence | FlexiTog stock at a regional 3PL. |
| Owned non-EU warehouse | FlexiTog-run warehouse in the region. |

Out of scope: US and UK operations, DAP direct.

## Run

```bash
pip install -r requirements.txt
streamlit run app.py
python -m pytest -q
python tools/build_dashboard.py           # interactive HTML dashboard from the current workspace
python tools/build_report.py              # static HTML report from the current workspace
python tools/build_request_pack.py        # Excel data request pack
```

Data is stored as CSV under `workspace/` (git-ignored). Set `FLEXITOG_WORKSPACE` to use another folder.
On first run the tool fills every table with generic placeholder rows.

## Build phases

1. **Data model + import** (done): entity schemas, CSV/Excel import with column mapping, editable
   master data and parameters, test order builder.
2. **Single-order engine** (done): route per scenario and node, cost breakdown by category and payer,
   lead time, lane-aware recommendation, forced override, delta versus the CIF baseline.
3. **Batch mode and scorecard** (done): synthetic, saved or sales-history batches per region, all
   scenarios per order, scorecard with winners per dimension, hassle method check.

## Data model

| Table | Key | Notes |
|---|---|---|
| suppliers | supplier_id | SKUs (`;`-separated), lead time, location |
| distribution_centers | dc_id | `dc_type`: helmond_hub, distributor, 3pl, owned_warehouse. `status`: existing, potential, candidate |
| customers | customer_id | country, city, postal code. Region derived from country |
| products | sku | weight, dimensions, unit price, HS code, origin, units per pallet, conformity cert flag |
| lanes | lane_id | existing routes with status proven / occasional / unproven |
| sales_history | order_id + sku | past order lines |
| demand_forecast | period + sku + country + customer_id | forecast quantity |
| orders / order_lines | order_id | test orders. Pallet count is required |

Every row has a `data_source` column: `placeholder`, `imported:<file>` or `manual`.
Every parameter row has `source`: `placeholder` or `real`, plus `source_note`.

## Import

- CSV with `,` `;` or tab, or Excel (pick sheet and header row).
- Headers are matched on field names and common aliases, including Dutch ERP headers
  (Debiteurnummer, Artikelnummer, Omschrijving, Gewicht, Prijs, Land, Plaats).
- Country names and codes (Turkey, KSA, UAE, Maroc) normalise to ISO2.
- Numbers like `1.234,50`, `€ 40`, `15%` parse. The decimal separator is detected per column or forced.
- Unmatched columns are kept as extra columns or ignored. Add custom fields per table.
- Commit modes: upsert, append, replace.

## Parameters (placeholder defaults)

General, freight per leg, duty and VAT per country, compliance costs (SABER, legalisation,
Egypt ACI/GOEIC and more), non-transport lead times, scenario defaults (handling, storage,
margin, minimum order value, handoffs) and owned warehouse fixed cost. All ship as placeholders.

## Engine rules (phase 2)

- Cost to serve = all cost between Helmond stock and goods at the customer. Goods value and
  recoverable import VAT are excluded. Each step records who pays: FlexiTog, partner or customer.
- Baseline: one shipment per order, so minimum charges and per-shipment fees apply in full.
  FlexiTog pays handling, export docs, freight and insurance to port. Customer pays clearance,
  duty, compliance and inland delivery.
- Stocked scenarios assume stock on hand in the region. Order lead time = local pick + delivery.
  Replenishment freight is consolidated (`replenishment_freight_factor`) and per-shipment fees
  are spread over `replenishment_pallets_per_shipment`.
- A node in another country (for example Jebel Ali serving Saudi Arabia) is treated as a free zone:
  duty-suspended storage, then a per-order re-export, regional freight and import in the customer country.
- Duty = value-weighted rate per SKU origin. EU27 origin uses the preferential rate and adds a
  preference document step.
- Distributor margin (default 25% of goods value) counts as cost to the chain, paid by the customer
  through price.
- Recommendation = lowest cost x (1 + risk premium). Premiums for occasional/unproven lanes and
  potential/candidate nodes steer toward proven lanes. Routes below minimum order value are excluded.
- Lane status comes from the lanes table and from sales history (`shipped_via` order count, 12 months).
- Air freight is never used as a fallback. A country with no surface rate is infeasible.
- Hassle metrics per route: customs touchpoints, handoffs between parties, documentation steps,
  steps the customer handles itself. Phase 3 lets you pick the scoring method.

## Batch and scorecard (phase 3)

- Batch sources: synthetic test batch (reproducible seed, size mix 50% 1 pallet / 35% 2-4 / 15% 6-10),
  saved test orders, or sales history (one batch order per historical order). Upload sales history on
  the Batch page or the Import page. A profile table compares the test batch with history per region.
- Each order runs through the baseline and the best node per in-scope scenario.
- Scorecard per region x scenario: coverage, cost to serve per unit, cost % of order value, customer
  cost per unit, FlexiTog cost per unit, lead time, hassle score, customer paperwork steps,
  FlexiTog paperwork, proven-lane share, placeholder share. Winners per dimension, ties marked.
- Hassle methods: customer-first (default), customs touchpoints, handoffs, documentation steps.
  Customer-first scores the paperwork left with the customer (weights in General parameters). FlexiTog
  paperwork shows what FlexiTog takes on to cover it. The method check table shows which methods
  separate the scenarios.

## Demo data, HTML report and data request pack

- The tool ships with dummy data: 20 customers, 8 SKUs, candidate distributors/3PLs/warehouses and
  12 months of dummy sales history (192 orders). Overview > Reset to demo data restores it.
- HTML report: Batch and scorecard > Download HTML report, or `python tools/build_report.py`.
  One self-contained page with findings, the regional scorecard, one order route by route, the
  hassle method check and the data request list. `reports/demo_route_report.html` is the demo run.
- Data request pack: `templates/FlexiTog_data_request_pack.xlsx`. One sheet per dataset with the
  exact headers the importer reads, placeholders prefilled on parameter sheets, owner/status tracking
  on the Overview sheet. Partner sheets take per-partner margin and 3PL rates (`margin_pct`,
  `inbound_eur_per_pallet`, `storage_eur_per_pallet_month`, `outbound_eur_per_order`), which override
  the scenario defaults.

## Interactive dashboard

`python tools/build_dashboard.py` (or Batch and scorecard > Download interactive dashboard) writes one
HTML file that runs the whole simulator in the browser, with no Python and no server:

- Map of Europe, North Africa and the Middle East: lanes from Helmond scaled by pallets, distributor /
  3PL / owned-warehouse nodes (faded = not signed), customers, and issue markers by severity.
  Colour countries by cheapest scenario, cost per unit, customer cost, lead time, FlexiTog paperwork or
  issue count. Click a country for its scenario comparison, serving nodes and issues.
- Parameters drawer: what-if switches (Red Sea reopens, all SKUs EU-made), scenario defaults, partners
  (use/remove, status, MOV, margin, storage, served countries), freight, duty and VAT, compliance, SKUs
  (price, units per pallet, EU-made), general and risk, lead times, owned-warehouse fixed cost. Every
  change reruns the batch. Changes stay in the viewer's browser. "Copy changes" gives JSON that
  Parameters > Apply changes from the interactive dashboard writes back into the workspace.
- Region cards, scorecard small multiples, order explorer with route override, issues list and the
  data request table.

The browser engine (`flexitog/assets/engine.js`) is a port of `engine.py`/`batch.py`.
`tests/test_dashboard_engine.py` runs both on the same batch and requires identical results, so change
both together. Issues are in `flexitog/issues.py` (briefing notes to verify) plus rules computed in the
page. The basemap is Natural Earth 1:50m, rebuilt with `tools/build_basemap.mjs`.
