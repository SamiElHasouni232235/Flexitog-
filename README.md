# FlexiTog EU route simulator

Simulates how a customer order flows from the Helmond EU hub to Türkiye, North Africa and Gulf/GCC
under four scenarios, and compares them on cost, lead time and hassle.

| Scenario | What it models |
|---|---|
| Baseline: DAP from Helmond | FlexiTog pays freight, insurance and delivery to the customer's door. Customer clears import, pays duty and VAT. |
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
   lead time, lane-aware recommendation, forced override, delta versus the DAP baseline.
3. **Batch mode and scorecard** (done): synthetic, saved or sales-history batches per region, all
   scenarios per order, scorecard with winners per dimension, hassle method check.

## Data model

| Table | Key | Notes |
|---|---|---|
| suppliers | supplier_id | SKUs (`;`-separated), brands, lead time, inbound mode (road/sea), location |
| distribution_centers | dc_id | `dc_type`: helmond_hub, distributor, 3pl, owned_warehouse. `status`: existing, potential, candidate |
| customers | customer_id | country, city, postal code. Region derived from country |
| products | sku | brand, weight, dimensions, unit price, HS code, origin, units per pallet, conformity cert flag |
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

- Cost to serve = all cost between the supplier and goods at the customer, including supplier
  freight. Goods value and recoverable import VAT are excluded. Each step records who pays:
  FlexiTog, partner or customer.
- Stock sourcing: each order's pallets are split by the supplier of each SKU. The baseline always
  ships from Helmond stock, so it carries supplier to Helmond freight. A distributor, 3PL or owned
  warehouse is refilled per supplier either via Helmond (supplier to Helmond, Helmond handling, EU
  export, main leg) or straight from the supplier (`direct` freight rates plus origin export
  documents). `direct_sourcing_mode` in General: 0 always via Helmond, 1 direct when cheaper per
  pallet (default), 2 direct whenever a rate exists. A supplier with `direct_to_partners` = no always
  goes via Helmond. `risk_premium_direct_sourcing_pct` adds a routing penalty scaled by the share
  sourced direct. Scorecards show the direct share per region and model.
- Baseline (DAP from Helmond, key `cif_baseline` kept for saved workspaces): one shipment per order,
  so minimum charges and per-shipment fees apply in full. FlexiTog pays handling, export docs, freight,
  insurance and delivery to the door. Customer pays clearance, duty, VAT and compliance.
- Demand-driven volumes (`Data.volume`, set by the Forecast view): shipments per year per country
  replace `shipments_per_year_per_country`, the refill load per node (forecast pallets per year of the
  countries it serves / refills per year) caps `replenishment_pallets_per_shipment` and
  `direct_replenishment_pallets_per_shipment`, and owned warehouse pallets per year replace
  `expected_pallets_per_year`. An order line may carry `unit_price_eur` (forecast lines priced from
  sales history); the SKU still sets origin, supplier, duty and compliance.
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
- Transport modes (Parameters > Transport modes per leg): each kind of leg has allowed modes and a
  pick rule. Defaults: supply (supplier to Helmond or to a partner) by sea, preferring sea and
  using a supplier's own mode first; refill (Helmond to a partner) preferring sea; export (DAP
  baseline) the cheapest of sea and road; delivery to customers (regional and in-country) by road
  or air, cheapest first. Pick `fastest` on delivery to use air. Air is used only where a group
  allows it. A leg with no rate in its allowed modes makes the route infeasible. Inbound and direct
  rates can be specific to the supplier country (`origin_country`).
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

- The tool ships with dummy data: 20 customers, 12 SKUs in three brands, 5 suppliers, candidate
  distributors/3PLs/warehouses and 12 months of dummy sales history (192 orders). FlexiTog's own line
  is made in Albania (Durrës, road to Helmond). RefrigiWear and Gold Freeze come mostly from China
  (Ningbo, Qingdao) and Bangladesh (Chattogram) by sea, with boots and socks from Serbia (Leskovac) by
  road. Albanian and Serbian origin pays the standard duty rate in the model; only EU origin gets the
  preferential rate. Overview > Reset to demo data restores it.
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
- Best option per region, scenario comparison, order explorer with route steps, risks with the coverage
  matrix and data readiness (see Route Dashboard layout below).
- Map filters: modes shown (sea, road, air) and one supplier at a time. Air legs to customers draw
  as dotted arcs.
- Parameters drawer, Transport modes: tick allowed modes per leg and choose preferred, cheapest or
  fastest.
- Map navigation: drag to pan, Ctrl/⌘ + scroll or pinch to zoom (plain scroll in full screen),
  double-click to zoom in (Shift + double-click out), + / − / arrows / 0 on the keyboard, F for full screen.
  Full screen uses the browser's full screen when allowed and a page overlay otherwise; the parameter
  drawer still opens over it. Click a country, issue, node, lane or customer for a detail card with
  zoom and jump actions.
- World map: every country (Natural Earth 1:50m, Antarctica left out), finer detail in Europe, Africa
  and Asia, Russia and Fiji split cleanly at the date line. Zoom out to see the whole world.
- Suppliers: supplier countries are filled blue, each supplier has a dark navy factory marker, a
  blue line where stock goes to Helmond and a navy line where it goes straight to a partner node
  (dashed = road, width = pallets in view). Sea legs (supplier, direct and Helmond outbound) follow
  a shortest path on a sea-lane graph (`geo.route_graph`): round the Cape of Good Hope, or via Suez
  with the Red Sea switch on; Jeddah stays reachable via Suez. The Suppliers button (or S) frames the supply base. Click a supplier
  country or factory for brands, SKUs, origin, lead time and share of the batch. Blue is reserved for
  suppliers: distributor-held stock is plum and the country value scale is violet.

### Route Dashboard layout

The tab answers six questions in order. One store (`RS` in `dashboard.html`: selected region, country,
order, option and the switch "Include partners not yet signed") feeds every section. The logic without DOM
is `flexitog/assets/route_core.js` (`window.FlexiRoute`, tested in `tests/test_route.py`); engine.js and
engine.py are untouched.

1. Best option per region: one card per region (the cards are the region selector; click the active card
   for all regions). Best scenario in its colour, cost to serve per unit, lead time (red when it misses the
   target), the target, risk counts by severity and the share of cost on real data. `bestScenario` rule:
   only Distributor, 3PL and Owned WH count (Baseline DAP is the reference); scenarios where every order meets
   its target come first; then the lowest cost to serve plus customer pays per unit, weighted by order count;
   then the lower hassle score; when none meets the target the cheapest wins, labelled "misses target". With
   the switch off the batch reruns with signed partners only (status existing).
2. Scenario comparison for the selection: four rows, order-weighted cost, customer cost, lead time, hassle,
   FlexiTog paperwork, orders missing the target and partner status. Best in-scope value in bold. A scenario
   without a route shows one line with the reason.
3. Map and country detail: countries coloured by their best scenario, routes only for the selected country or
   order, supplier and issue layers off behind the Suppliers and Issues buttons, legend entries only for layers
   that are on. Clicking a country selects it and its region. The Customers button (or C, on by default) shows
   every Master Data customer in the region as a white point, placed by its latitude and longitude, else its
   city, else the country centre (dashed outline). Customers on the same spot share one larger point; click
   it for the list. Forecast placeholder customers stay off the layer.
4. Order explorer: orders of the selection, every route option ranked by total cost with its status (signed or
   candidate) and data source (from RFQ, placeholder or entered rates). Click a bar to see its steps, who
   handles each one and whether it meets the target.
5. Risks (issues without the coverage type, by severity, faded outside the selection) and the coverage matrix
   (nine lane countries by four scenarios: signed, candidate or no partner; an empty cell opens Parameters >
   Partners).
6. Data readiness (collapsed): share of cost on real data and the data request table with a done, partial or
   missing status per dataset from the rows loaded.

Targets come from the lane rules (working days after pickup on the destination weekend): Saudi Arabia, UAE,
Kuwait and Qatar 2, Türkiye and Morocco 3, Egypt and Tunisia 4, Algeria 5. A Service Goal with a time unit
that names a country (ISO code or name, not a region) overrides its lane rule. Engine lead times are calendar
days; `workingDays` rolls a weekend delivery to the next working day and averages over the five pickup days.

RFQ wiring: `getRfqRate(providerId, lane, band)` reads `rate.<lane>.<band>.cost_per_shipment` and
`.transit_days` from the provider's latest RFQ response in Benchmarking, `getRfqStock` reads
`stock.<lane>.serve_from_stock` and `.transit_days`. Lanes L01 Saudi Arabia to L09 Tunisia, weight bands by
gross kg (quantity × unit_weight_kg plus 20 kg per pallet): B1 to 30, B2 to 100, B3 to 500, B4 to 2,000, B5
above. Each provider with a rate adds a Baseline DAP option in the Order explorer (door-to-door freight replaces
the main leg and local delivery). A partner node is a Master Data provider, so its own RFQ answer (same
`dc_id`) gives its delivery-from-stock transit from `stock.<lane>`. No RFQ value means the placeholder rate stays.
RFQ rates feed the Order explorer only; sections 1 and 2 still run on the engine rates.

### Login, home page and users

The page opens on a login card. Nothing of the app shows until a user logs in with username or email
and password (Enter submits, the eye button shows or hides the password, a wrong login shows one
message without naming the field). The session lives in sessionStorage: a refresh keeps you logged in,
closing the tab logs you out. Every page shows the user and a Log out button top right, and a Home link
top left. The address bar hash follows the view (`#dash`, `#forecast`, `#bench`, `#report`, `#md`,
`#users`), so a refresh stays on the same page.

After login the home page shows the logo from `flexitog/assets/brand/` (300 px wide, see the README
there) and one button per view in this order: Route Dashboard,
Forecast, Benchmarking, Report Extract, Master Data Upload, then Users for the admin. Five or six per row
on desktop, three on a tablet, two on a phone.

Users (admin only, blocked for everyone else, also by direct hash or `showView("users")`): table with
username, email, role, status, created date and actions (reset password, disable or enable, delete with
a confirm step). The admin account cannot be disabled or deleted. Add user takes username, email, role
(Editor or Viewer, Admin is reserved) and one permission checkbox per view, then creates a random
14-character password (upper, lower, digit, symbol, from `crypto.getRandomValues`) shown once with a
Copy button. Usernames and emails are unique, emails are checked. Roles and permissions are saved on
each user and not enforced yet (`FlexiAuth.permits(user, view)` is the hook). Export users and Import
users move the accounts as JSON, password hashes included, so test users survive a storage change.

Files: `auth_config.js` holds the seed admin (username, email, salt and hash, never the password),
`auth_store.js` is the only code that reads or writes users and sessions (`getUsers`, `getUser`,
`saveUser`, `deleteUser`, `getSession`, `setSession`, `clearSession`, all async; users in localStorage
under `flexitog-auth-v1:users`), `auth_core.js` (`window.FlexiAuth`) holds hashing, random passwords,
validation and import rules, `auth.js` and `auth.css` the screens. Password hash:
hex(SHA-256(UTF-8(salt + password))) with a random 16-byte salt per user, Web Crypto API. Change the seed
password by writing a new salt and hash in `auth_config.js`; the stored admin follows on the next load.
Tests: `tests/test_auth.py`.

The login runs in the browser. It keeps the screens away from someone who opens the page without an
account. It does not protect the data: the master data, sales orders and the user list sit in the page
file and in browser storage, and anyone with the file and the browser developer tools can read them or
set a session. Real access control needs a server that checks the login before it sends any data.

### Menu, master data and report extract

The menu button (three lines, top left) opens Home, Route Dashboard, Forecast, Benchmarking, Report
Extract, Master Data Upload, Users (admin only) and Parameters, plus shortcuts to the main master data tabs.

- Master data upload: one tab per table. Products, Customers, Suppliers, Logistics providers
  (distributors, 3PLs, owned warehouses and the Helmond hub, filterable by type), Lanes, Sales history,
  Demand forecast, Test orders, Test order lines and Other data (any file: rate cards, quotes, shipment
  logs). Each tab is an editable table with search, add and delete row, required-field and allowed-value
  checks, CSV export and a CSV template. Upload CSV (comma, semicolon or tab) or Excel: the page finds
  the sheet and header row, matches columns to fields (same aliases as the Python importer), converts
  countries to ISO codes, reads 1.234,50 and 13-09-2025, and shows a check and preview before rows go in.
  Modes: update matching and add new, add all, replace. Save changes reruns the map, scorecard and report.
  Select rows with the checkbox column (Shift + click selects a range, the header box selects the page,
  Select all takes every row that matches the search and filter). The selection bar then deletes the
  selected rows (with a confirm click), exports only them as CSV or Excel, or sets one column to the same
  value on all of them. Delete and Set change the draft: Save changes keeps them, Discard undoes them.
  Click a column header to sort: A to Z (numbers low to high, dates oldest first), again Z to A, a third
  time off. Blanks sort last. The row under the headers filters per column: text that the cell contains,
  a dropdown for list columns, `>`, `<`, `>=`, `<=` or `=` with a number for number columns, `(empty)`
  for blank cells. Sort and filters change the view only. Keep this order makes the sorted order the
  table order. Move rows by dragging the ⠿ handle in the # column, with Alt + ↑ / ↓ on the focused
  handle, or with Move To top, Up, Down, To bottom in the selection bar. Drag is off while a sort is on.
  A new order is a draft change: Save changes keeps it.
  Sales history rebuilds the batch in the browser (one order per historical order, same rules as
  `batch.history_batch`). Header buttons give the whole master data as one Excel workbook and an
  Excel workbook of upload templates.
- Saving: in the published artifact, saved tables are stored with the dashboard and everyone who opens
  it sees them. Opened as a local file, they stay in that browser. Export the master data workbook to
  move data into the Python tool (Import data accepts it sheet by sheet).
- Report extract: a standard cross-border supply chain report for all regions or one. Sections:
  executive summary, scope and method, scenario scorecard, landed cost breakdown, lead time breakdown,
  demand profile, network (logistics providers and lanes), supply base (suppliers and brand mix),
  stock sourcing (via Helmond or direct, per region, model and lane), transport modes (policy and
  mode mix per leg), trade compliance by country, risk and issue register, data quality, recommendations, and an order
  appendix. Export as an Excel workbook (one sheet
  per section plus all orders), an HTML report or a CSV of every order and scenario.

Excel read and write uses SheetJS Community Edition 0.18.5 (Apache-2.0), inlined from
`flexitog/assets/vendor/`. The menu and master data code is `flexitog/assets/workspace.js`.

### Sales Forecast

Menu > Forecast builds the 2027 demand every route scenario prices. Source: the Odoo sales order line
export (sheet `Sheet1`, headers `Order Lines/...`). The page embeds the anonymized sample
(`flexitog/assets/data/`, Dummy data badge on). Upload the real export on the Forecast view (SheetJS, in
the browser, kept in that tab only), or build a local copy with
`python tools/build_dashboard.py out.html --sales workspace/Official_Sales_Orders_MENA_Turkey.xlsx`.
Keep the real file in `workspace/`: git ignores it and it holds real customer names.

Data rules (`forecast_core.js` `clean`, the one implementation for the embedded and uploaded file):
1. Skip rows with an empty Order Reference.
2. Net revenue = Total − Total Tax (UK lines include 20% VAT).
3. FX table in EUR per unit, default 1 GBP = 1.1555 EUR and 1 USD = 0.8607 EUR. Reporting currency USD.
4. Order date = the earliest Created on of all lines in the order.
5. Customer = Customer/Company Name Entity, else Customer; " (EU)" stripped; "Turk Hava Yollan Teknik AS"
   maps to "Turkish Airlines Technic" (the sample's "Anatolia Aero Teknik AS" to "Anatolia Aero Technic").
6. Freight: category Service, or a product name with Delivery, Freight, Fedex, UPS SAVER or Collection UK.
   Lines without a product name are blank and ignored. Everything else is goods.
7. Product class from the name: Coveralls, Baselayers, Trousers, Jackets (in that order), else the
   template category (Gloves, Footwear, Headwear, Accessories, Drying cabinets, Other clothing).
8. Goods revenue, units (quantity x pack size) and orders by month, country and class; freight apart.

Validation (`tests/test_forecast.py`): with the real file in `workspace/` the totals must match the
Excel analytics: net revenue USD 529,622 (goods + freight billed), 79 orders, 464 order lines, 32
customers, 9 countries, Saudi Arabia USD 315,959, last 12 months to 2 October 2026 USD 513,857. The
sample matches the counts; its revenue is perturbed (USD 521,301).

Methods (pick one; all four show side by side with their back-test):
- Run rate: trailing 12 full months per country. Orders above the 95th percentile of order value are
  capped; the excess is reported as project orders (toggle to include them in every method).
- Holt linear exponential smoothing per country, no seasonality, alpha and beta sliders (0.3 / 0.1).
- Customer-driven: per customer the average days between orders and the average order value, plus new
  customers per quarter per country at the median first-order value.
- Target allocation: the 2027 target (USD 2.3M to 2.5M) split by historical share or your weights.

Scenarios: Base = the method x (1 + growth uplift); Low / High = Base x (1 -/+ the method's back-test
WAPE, clipped to 10-50%); Target = the Base mix scaled to the target midpoint. Revenue converts to units
with the net unit price per class and country, to orders with the average order value and to lines with
lines per order. Back-test: hold out the last 3 full months, fit on the rest; WAPE above 40% labels the
forecast indicative.

Integration: the demand object `window.DEMAND.rows` = {month, country, product_class, units, orders,
revenue, revenue_eur, lines, shipments}. With Use as demand on (default), the Route Dashboard, the
scorecard and the report extract price `FC.forecastBatch` (forecast orders per country and month, one
line per class at the representative SKU of the product class profile) and the engine reads
`FC.volumes`. The Forecast view shows cost to serve, landed cost, margin (gross margin % per class is a
placeholder), next-day / 48-hour feasibility, lead time and hassle per scenario, and freight per unit
by product class. Benchmarking > Test Order and Report can build the test set from one average month
of the forecast. The page makes no network calls: Google Fonts is gone, system fonts take over.

### Benchmarking

Menu > Benchmarking builds one standard test order package from the sales history and sends it to
logistics providers, so every freight forwarder, 3PL, carrier or distributor quotes on the same basis.
Four sub-tabs; each view keeps its state when you switch back to the Route Dashboard.

- Logistics Providers: one row per Master Data provider (Master data > Logistics providers, rows with a
  provider type). Columns: name, type, countries and lanes, RFQ status, last upload (file name and date),
  actions. Helmond (type Own hub) comes first, labelled Baseline, with no RFQ upload: its costs and lead
  times come from Master Data and the parameters. Add, edit and delete providers in Master Data; they show
  here the next time the view opens. The table follows the Master Data order. Drag ⠿ (or Alt + ↑ / ↓) to
  move a provider: the new order saves in Master Data at once. Click a column header to sort by provider,
  type, number of countries, RFQ status or last upload; Helmond stays first. Print report (PDF) writes the printable A4 provider report (cover,
  overview, RFQ comparison, one page per provider). The RFQ workflow below runs on this tab.
- Sales Data and Analysis: the default source is Master data > Sales history (192 demo orders). Add
  CSV or Excel exports from each merged entity; a mapping step matches columns (English and Dutch
  headers) to order date, order number, customer, destination country, SKU, description, garment
  category, brand, quantity, value, currency and optional weight, cartons, pallets and incoterm. Data
  quality shows rows loaded and dropped with reasons, missing values per column, duplicates and the
  date range. Exchange rates (EUR per unit, placeholders) convert values. Analyses with chart and table:
  orders, units and value per month and year, seasonality index per month (overall and per region),
  volume per region, country, customer and garment category, order profile, top customers per region
  with peak months, peak and low months. A findings list is written from the numbers.
- Service Goals: editable goals with name, description, target, unit, mandatory or preferred and the
  regions they apply to. Seven defaults (next-day TR/NAF, 48 hours GCC, customs paperwork, no hassle,
  damage rate, returns, tracking and POD).
- Test Order and Report: a 12-month test set drawn month by month from the history with a fixed seed
  (same options, same set). Options: base years, scale factor or yearly revenue target in USD, seed,
  order values on or off, lines as SKU or garment category. Customers become codes per region (Customer
  GCC-01). Cartons, pallets, weight and volume come from the product master or packing defaults per
  category. A check compares totals, monthly shape, region and category mix with the history. Generate
  report files writes, per ticked provider or as a generic version, a PDF report, a Word report and an
  Excel response template. Generating for a provider sets its Date test order sent to today. Cost
  against Helmond (on this tab and as Comparison report (PDF)) prices the test order set for Helmond and
  every provider with an active RFQ answer, Helmond first. The outbound package never holds these costs.

Seasonality index: units per calendar month averaged over the years that cover that month, divided by
the mean of those averages (average month = 100). Part years do not skew the shape.

Response template (version 1) sheets: Instructions, Provider, Rates per order (one row per test order
ID), Rates per lane (one row per destination country from Helmond), Service goals (meets goal yes, no,
partly, comment), Test order lines (reference) and a hidden `_meta` sheet with the package and provider
IDs. Cost columns per row: transport mode, transit days, total lead time days, freight rate, fuel
surcharge, customs clearance fee, warehousing cost, other surcharges, incoterm offered, currency,
comment. `BenchCore.parseResponse` reads a completed file into a ProviderResponse
`{package_id, provider_id, provider_name, currency, valid_until, lines: [{kind: order|lane, ref, cost fields}],
goals: [{goal_id, meets, comment}]}`: the input for the side-by-side comparison (not built yet).
Exports never hold real customer names, source order numbers, margins, purchase prices or supplier costs.

#### RFQ workflow (Logistics Providers)

Provider fields used (Master Data table `distribution_centers`): `dc_id` (provider ID), `name`, `dc_type`,
`provider_type` (3PL, Freight forwarder, Own hub; blank derives from `dc_type`: helmond_hub is Own hub,
3pl is 3PL, freight_forwarder is Freight forwarder), `status`, `country`, `serves_countries`,
`contact_name`, `contact_email`, `contact_phone`, `website`, `notes`, `data_source` (placeholder shows the
dummy badge). Rows without a provider type (distributors, owned warehouses) stay out of Benchmarking.
`dc_type` freight_forwarder holds no stock: the engine and the map skip it.

RFQ status per provider: Not sent, Sent (set by hand, or by Prefilled RFQ), Answered (after a confirmed
upload).

1. Download latest RFQ gets the bundled template `flexitog/assets/rfq/Transport_Volume_Scenario_RFQ_FlexiTog.xlsx`.
   Replace RFQ template stores a newer file in this browser. Reset to bundled drops it.
2. Prefilled RFQ writes the provider ID, name, website and contact into Provider Profile B6 to B11 and adds a
   hidden sheet `_rfqmeta` with two cells only: `template_version` and `provider_id`. No growth basis,
   targets or internal data. Only the changed sheet XML is rewritten through JSZip.
3. Upload answered RFQ (per row, or at the top of the table) reads the file with SheetJS:
   - Template check: the Export sheet and a supported `meta.rfq_version`.
   - Provider: the `_rfqmeta` provider ID picks the row; a different row asks to confirm. An ID missing
     from Master Data offers Create in Master Data. A file without `_rfqmeta` opens a dropdown, preselected
     from Provider Profile B6.
   - Validation lists every problem with sheet and cell: currency in Provider Profile B16; per served lane
     (not marked Not served in Provider Profile D53 to D61) and band: transit in H above 0, rate per kg in I
     or minimum charge in J; every filled amount numeric and not negative (fees of 0 pass, fuel at most
     100%). Any problem saves nothing.
   - Preview of the parsed rates (lane, band, mode, transit, rates, fees, cost per shipment). Nothing saves
     until Confirm and save.
4. History: each confirmed upload is kept. The latest one is active; View parsed rates opens older ones,
   Make this upload active switches back. Download original returns the uploaded file, Remove upload drops
   the active one.

Comparison against Helmond, per test order: Helmond = what FlexiTog pays under DAP from Helmond in the
route engine (`window.FlexiDash.helmond`). Provider = MAX(minimum, rate per kg × kg) × (1 + fuel) + docs
+ other for the order's lane and weight band, converted to EUR. Columns: orders priced, cost per order,
cost per unit, lead time in working days, and the difference to Helmond on the orders both price.
Providers without an answer show "No RFQ answer yet", never a guessed cost.

Old lists: a Benchmarking provider list saved before this change moves into Master Data once, with its
uploads (old types: 3PL / contract logistics to 3PL; freight forwarder, carrier, courier, customs broker
and 4PL to Freight forwarder; distributors stay outside Benchmarking).

Storage: every Benchmarking file goes through `DataStore` in `workspace.js`, the same layer as Master Data
(artifact database when published, this browser otherwise). RFQ state under `rfqstate`, parsed values and
rates under `rfqvalues`, original files and a replaced template in IndexedDB `flexitog-bench`. No
Benchmarking file calls localStorage directly. Logic without DOM is `flexitog/assets/rfq_core.js`
(`window.FlexiRFQ`), tested in `tests/test_rfq.py` against `tests/fixtures/Sample_RFQ_Response_DUMMY.xlsx`.
JSZip 3.10.1 (MIT) is inlined from `flexitog/assets/vendor/`.

Storage follows the master data: saved with the dashboard when published, in this browser (localStorage,
prefix `flexitog-bench-v1:`) when opened as a file. The logic without DOM is
`flexitog/assets/bench_core.js` (tested in `tests/test_benchmark.py`), the screens are
`benchmark.js` and `benchmark.css`. PDF uses jsPDF 4.2.1 with AutoTable 5.0.8, Word uses docx 9.9.0
(all MIT), inlined from `flexitog/assets/vendor/` like SheetJS.

The browser engine (`flexitog/assets/engine.js`) is a port of `engine.py`/`batch.py`.
`tests/test_dashboard_engine.py` runs both on the same batch and requires identical results, so change
both together. Issues are in `flexitog/issues.py` (briefing notes to verify) plus rules computed in the
page. The basemap is Natural Earth 1:50m, rebuilt with `tools/build_basemap.mjs`.
