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
```

Data is stored as CSV under `workspace/` (git-ignored). Set `FLEXITOG_WORKSPACE` to use another folder.
On first run the tool fills every table with generic placeholder rows.

## Build phases

1. **Data model + import** (done): entity schemas, CSV/Excel import with column mapping, editable
   master data and parameters, test order builder.
2. Single-order engine: routing, cost breakdown, lead time, forced DC override.
3. Batch mode and scorecard per region.

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
