# Supply chain benchmark

A web app to compare alternative operating models for a distribution business against one baseline.

> **Dummy data.** Every figure in this first version is a placeholder for testing the tool, not company data. The app shows this on every page, with a "Dummy" badge on each dummy record and a count of dummy inputs on the results page.

## Contents

1. [Run the app](#run-the-app)
2. [Screens](#screens)
3. [Project layout](#project-layout)
4. [Data model](#data-model)
5. [Formulas](#formulas)
6. [Scoring](#scoring)
7. [Replace dummy data with real data](#replace-dummy-data-with-real-data)
8. [Known limits](#known-limits)

## Run the app

Requirements: Node.js 20 or later.

```bash
npm install
npm run dev        # start the app at http://localhost:5173
npm test           # run the engine and store unit tests (Vitest)
npm run typecheck  # TypeScript strict check
npm run build      # production build in dist/
npm run preview    # serve the production build
```

### One-file preview

```bash
npm run build:single   # writes preview/supply-chain-benchmark.html
```

This puts the whole app in one HTML file. Double-click it to open it in a browser, with no install and no server. It saves your work in that browser, the same way as the normal app. Map tiles need an internet connection.

The workspace saves in the browser (localStorage) on every change. Use the data screen to export or import a JSON file of the full workspace.

## Screens

| Screen | Purpose |
| --- | --- |
| Baseline network | Map with DC, hubs, radius circles, simulated stores and linehaul lines. Editable DC and hub tables. Country coverage check, with France flagged as a coverage gap. |
| Products | Product master and sales mix, with mix totals and weighted averages (units per pallet, value per unit). |
| Scenarios | Volume scenarios (mode A) and test orders (mode B). The test order editor has a line table, CSV paste and a summary of units, cartons, pallets, orders and lines. |
| Model builder | Model list, templates, and a sectioned form: description, strengths and weaknesses, network with a live map, operations, contract and capacity, admin and staffing, cost overrides, custom parameters and ratings. |
| Criteria and weights | Criterion names, weights, metric and direction, plus the blend slider between calculated scores and ratings. |
| Cost assumptions | One shared table grouped by labour, handling, buildings and stock, linehaul, last mile, 3PL tariffs and emissions. |
| Results | Scenario picker, top model summary, ranking, score heatmap with hover details, radar chart, stacked cost bars, key figures with change versus baseline, a map per model, and strong and weak points. |
| Data | JSON export and import, CSV import for stores and test orders, reset to dummy data, clear all dummy data. |

## Project layout

```
src/
  engine/      Pure TypeScript calculation engine. No React imports.
    types.ts     Domain types
    geo.ts       Haversine and road distance
    random.ts    Seeded random generator
    stores.ts    Store generation, serving nodes, nearest open hub assignment
    products.ts  Product mix profile, order line conversion, test order summary
    demand.ts    Scenario to annual demand per store and per serving node
    costs.ts     One function per cost component
    model.ts     Full model run, growth run and metrics
    metrics.ts   Metric catalogue for criteria
    scoring.ts   1 to 10 scoring, rating blend, weighted rank
    dummy.ts     Dummy input count
    csv.ts       CSV parsing for stores and test orders
    coverage.ts  Country coverage check
    *.test.ts    Unit tests
  data/        Dummy seed data and templates
  state/       Zustand store with localStorage persistence and import validation
  ui/          Shared UI parts (map, badges, inputs, formatting)
  pages/       One file per screen
```

## Data model

Every seeded record carries `isDummy: true`. Editing a record keeps the flag. Only the "Mark as real data" checkbox on the record clears it.

### Product

| Field | Unit | Meaning |
| --- | --- | --- |
| id, sku, name | | Identity. Seed: "Dummy product A" to "Dummy product T". |
| category | | small, standard or bulky |
| unitKg | kg/unit | Weight per unit |
| unitsPerCarton | units/carton | |
| cartonsPerPallet | cartons/pallet | |
| unitValueEur | €/unit | Value per unit, used for inventory carrying cost |
| salesMixPct | % of units | Share of annual units. The engine scales the total to 100%. |
| isDummy | | |

### Network

- **DC**: name, lat, lon, locationToConfirm, isDummy. Seed: "Central DC" near Bad Hersfeld, labelled "location to confirm".
- **Hub**: id, name, country (NL, BE, LU, FR, DE), lat, lon, radiusKm, storeCount, isDummy. Seed: Venlo (128 stores), Kontich (117), Mannheim (136), Kassel (94), München (109), each with a 100 km radius.
- **Store**: id, name, lat, lon, country, weeklyVolume, homeHubId, isDummy.
- **Store set**: mode (`generated` or `imported`), seed, imported stores, isDummy. Generated stores sit at random inside each hub radius. The generator uses the set seed combined with the hub id, so the layout stays the same between sessions and editing one hub leaves the other hubs' stores in place.

### Scenario

id, name, type (test order, forecast, target, baseline), mode and isDummy.

- **Mode A, volume**: annualUnits (units/year), storeGrowthFactor (multiplier on store count), deliveriesPerStorePerWeek, linesPerOrder.
- **Mode B, test order**: order lines (store id or hub id, product id, quantity in units) and annualisationFactor (for example 52 for a weekly order).

Seed: one weekly test order, one forecast (6.0 million units) and one growth target (8.5 million units, 30% more stores, 1.5 deliveries per week).

### Model

| Field | Meaning |
| --- | --- |
| id, name, colour, description, strengths, weaknesses, tags | Identity and notes. Tags: network, 3PL, staffing, transport, other. |
| hubRole | `stock` (hubs hold stock and pick), `cross-dock` (DC picks, hubs sort), `none` (ship from DC) |
| openHubIds | Open hubs. Stores of a closed hub move to the nearest open hub. |
| hubOperator | `own` staff or `3pl` |
| linehaul | `ftl` (full truck) or `groupage` (per pallet) |
| lastMile | `own-vans` or `carrier` |
| operations | pickRateLinesPerHour (lines/h), stockDaysAtHub (working days), stopsPerVanRoute, extraDcFloorM2 (m²) |
| contract | noticeWeeks (weeks), capacityUnitsPerYear (units/year, 0 = no limit), setupWeeks (weeks) |
| admin | adminFteBase (FTE), adminFtePerHub (FTE/hub), systemsCostPerYear (€/year) |
| extraStaff | List of role, FTE and annual cost per FTE (€/year) |
| costOverrides | Any shared cost assumption replaced for this model only |
| ratings | Rating 1 to 5 per criterion |
| customParams | Free key, value and unit. Shown in results, not used in the calculation. |

Seed: Baseline, 3PL runs all hubs and delivery, Cross-dock hubs with stock only at DC, Consolidate to 3 hubs (Venlo, Mannheim, München), Direct from DC by carrier.

### Criterion

id, name, weight, metric, higherIsBetter. Seed: People, Flexibility, Growth, Sustainability, Buildings, Movement and material handling, Administration. Add a criterion with metric "manual" for rating-only scoring.

### Cost assumptions (dummy values)

| Group | Key | Dummy value | Unit |
| --- | --- | --- | --- |
| Labour | labourRatePerHour | 32 | €/h |
| | driverRatePerHour | 30 | €/h |
| | productiveHoursPerFte | 1,650 | h/year |
| | adminFteCostPerYear | 62,000 | €/year |
| Handling | palletHandlingMinutes | 6 | min/pallet |
| | orderHandlingMinutes | 6 | min/order |
| Buildings and stock | rentPerM2Year | 75 | €/m²/year |
| | m2PerPalletPosition | 0.6 | m²/position |
| | fixedHubM2 | 600 | m²/hub |
| | workingDaysPerYear | 250 | days/year |
| | weeksPerYear | 52 | weeks/year |
| | inventoryCarryingRate | 0.20 | share/year |
| | capacityPenaltyPerUnit | 1.50 | €/unit |
| Linehaul | ftlCostPerKm | 1.65 | €/km |
| | groupageCostPerPalletKm | 0.11 | €/pallet/km |
| | palletsPerTruck | 33 | pallets |
| | truckFillRate | 0.85 | share |
| | roadFactor | 1.25 | factor |
| | minTripsPerWeekStockHub | 2 | trips/week |
| | minTripsPerWeekCrossDock | 5 | trips/week |
| Last mile | vanCostPerKm | 0.55 | €/km |
| | vanSpeedKmh | 50 | km/h |
| | minutesPerStop | 15 | min/stop |
| | kmBetweenStops | 8 | km |
| | carrierCostPerStop | 18 | €/stop |
| | carrierCostPerCarton | 2.40 | €/carton |
| 3PL tariffs | tplCostPerLine | 0.60 | €/line |
| | tplCostPerPallet | 7 | €/pallet |
| | tplCostPerOrder | 2.50 | €/order |
| | tplStoragePerPalletWeek | 2.30 | €/pallet/week |
| Emissions | co2PerTruckKm | 0.85 | kg/km |
| | co2PerVanKm | 0.24 | kg/km |
| | co2PerCarrierStop | 0.6 | kg/stop |
| | co2PerM2Year | 22 | kg/m²/year |

Seven keys go beyond the brief because the formulas need them: `m2PerPalletPosition`, `fixedHubM2`, `workingDaysPerYear`, `weeksPerYear`, `capacityPenaltyPerUnit`, and the two minimum trip frequencies. All are editable and flagged dummy.

## Formulas

All costs are in € per year. All distances are road km. Per model and scenario, the engine works per serving node: each open hub, or the DC when the model has no hubs.

The DC's base running cost is the same for every model and stays out of the totals. The DC only carries the cost that changes between models: DC handling and extra DC floor space.

### 1. Distance and store assignment

```
haversine km   = 2 × 6,371.0088 × asin( √( sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlon/2) ) )
road km        = haversine km × roadFactor
```

Each store goes to the open hub with the lowest road km. With hub role "none", or with no open hubs, every store goes to the DC.

### 2. Demand per node

**Mode A, volume.** Store weight = weeklyVolume (1 for every generated store).

```
store units/year    = annualUnits × store weight / Σ store weights
store orders/year   = storeGrowthFactor × deliveriesPerStorePerWeek × weeksPerYear
store lines/year    = store orders × linesPerOrder
```

The product mix gives the profile of one average unit. With mix shares w normalised to 1:

```
cartons per unit = Σ w / unitsPerCarton
pallets per unit = Σ w / (unitsPerCarton × cartonsPerPallet)
kg per unit      = Σ w × unitKg
value per unit   = Σ w × unitValueEur          (€/unit)
```

**Mode B, test order.** Per order line:

```
cartons = ceil(quantity / unitsPerCarton)
pallets = cartons / cartonsPerPallet
```

A store line counts as one order line for that store. A hub line spreads its quantity evenly over the stores of that hub. Each of those stores gets one order, and the hub line counts min(quantity, stores of the hub) order lines. Units, cartons, pallets, orders and lines are then multiplied by the annualisation factor.

Node demand is the sum over its assigned stores. The node's average store distance is order-weighted:

```
avg store km = Σ(store orders × store road km) / Σ store orders
```

### 3. Linehaul DC to hub

```
one-way km           = road km DC to hub
effective truck load = palletsPerTruck × truckFillRate                   (pallets)
```

Full truck:

```
trips/week  = max( ceil(pallets/year ÷ weeksPerYear ÷ effective load), minimum trips/week )
trips/year  = trips/week × weeksPerYear
truck km    = trips/year × 2 × one-way km
cost        = truck km × ftlCostPerKm
```

The minimum is `minTripsPerWeekStockHub` for stock hubs and `minTripsPerWeekCrossDock` for cross-dock hubs, as cross-dock hubs need daily replenishment.

Groupage:

```
cost      = pallets/year × one-way km × groupageCostPerPalletKm
truck km  = pallets/year ÷ effective load × one-way km      (for CO2, return leg shared with other shippers)
```

Models without hubs have no linehaul.

### 4. DC handling (own staff)

```
stock hubs:            hours = pallets × palletHandlingMinutes / 60
cross-dock or no hubs: hours = lines / pickRate + orders × orderHandlingMinutes / 60 + pallets × palletHandlingMinutes / 60
cost = hours × labourRatePerHour
FTE  = hours / productiveHoursPerFte
```

### 5. Hub handling

Own staff:

```
stock hub:      hours = lines / pickRate + pallets × palletHandlingMinutes / 60 + orders × orderHandlingMinutes / 60
cross-dock hub: hours = pallets × palletHandlingMinutes / 60 + orders × orderHandlingMinutes / 60
cost = hours × labourRatePerHour,  FTE = hours / productiveHoursPerFte
```

3PL:

```
stock hub:      fees = lines × tplCostPerLine + pallets × tplCostPerPallet + orders × tplCostPerOrder
cross-dock hub: fees = pallets × tplCostPerPallet + orders × tplCostPerOrder
```

### 6. Buildings

```
pallet positions = pallets/year / workingDaysPerYear × stockDaysAtHub    (stock hubs only, 0 for cross-dock)
floor m²         = pallet positions × m2PerPalletPosition + fixedHubM2
own site rent    = floor m² × rentPerM2Year
3PL storage      = pallet positions × tplStoragePerPalletWeek × weeksPerYear   (no rent)
extra DC space   = extraDcFloorM2 × rentPerM2Year
buildings cost   = Σ hub rent or storage + extra DC space
```

### 7. Inventory carrying (stock hubs only)

```
hub stock value = annual value / workingDaysPerYear × stockDaysAtHub     (€)
carrying cost   = hub stock value × inventoryCarryingRate                (€/year)
```

### 8. Last mile

One stop per store order.

Own vans:

```
routes        = stops / stopsPerVanRoute
route km      = 2 × avg store km + (stopsPerVanRoute − 1) × kmBetweenStops
van km        = routes × route km
driver hours  = van km / vanSpeedKmh + stops × minutesPerStop / 60
cost          = van km × vanCostPerKm + driver hours × driverRatePerHour
driver FTE    = driver hours / productiveHoursPerFte
```

Carrier:

```
cost = stops × carrierCostPerStop + cartons × carrierCostPerCarton
```

### 9. Admin, systems and extra staffing

```
admin FTE   = adminFteBase + adminFtePerHub × open hubs
admin cost  = admin FTE × adminFteCostPerYear
systems     = systemsCostPerYear
extra staff = Σ FTE × annual cost per FTE
```

### 10. CO2

```
CO2 kg = truck km × co2PerTruckKm + van km × co2PerVanKm + carrier stops × co2PerCarrierStop + floor m² × co2PerM2Year
```

Floor m² covers hub space (own and 3PL) plus extra DC space.

### Outputs per model

| Output | Formula | Unit |
| --- | --- | --- |
| Total cost | linehaul + DC handling + hub handling + buildings + inventory + last mile + admin + systems + extra staff | €/year |
| Cost per unit | total cost / units | €/unit |
| Own FTE | DC FTE + own hub FTE + driver FTE + admin FTE + extra staff FTE | FTE |
| Sites | 1 (DC) + open hubs | sites |
| Variable cost | linehaul + 3PL fees + 3PL storage + carrier cost + van km cost | €/year |
| Variable cost share | variable cost / total cost | share |
| Capacity use | units / capacity (empty when capacity is 0) | share |
| CO2 per 1,000 units | CO2 kg / units × 1,000 | kg |

### Growth run

The engine runs every model a second time at 150% volume and 150% stores (orders and lines rise 50%).

```
extra units        = units at 150% − units at 100%
extra cost         = cost at 150% − cost at 100%
units over capacity = max(0, units at 150% − capacity)          (0 when capacity is 0)
penalty            = units over capacity × capacityPenaltyPerUnit
cost per extra unit = (extra cost + penalty) / extra units      (€/unit)
```

### Criterion metrics

| Criterion | Metric | Direction |
| --- | --- | --- |
| People | own FTE | lower is better |
| Flexibility | variable cost share × 100 − 0.5 × notice weeks (points) | higher is better |
| Growth | cost per extra unit at +50% including the capacity penalty (€/unit) | lower is better |
| Sustainability | CO2 per 1,000 units (kg) | lower is better |
| Buildings | rent + 3PL storage + extra DC space (€/year) | lower is better |
| Movement and material handling | linehaul + DC handling + hub handling + last mile (€/year) | lower is better |
| Administration | admin FTE cost + systems cost (€/year) | lower is better |

Other metrics on offer for new criteria: total cost, cost per unit, total CO2, truck km, van km, floor space, sites, setup weeks, and "manual rating only".

## Scoring

1. **Calculated score** per criterion with a metric, by linear position between the worst and best value across models:
   `score = 1 + 9 × (value − worst) / (best − worst)`. Best is the highest value when higher is better, else the lowest. When all values are equal, every model gets 5.5.
2. **Rating score**: `1 + (rating − 1) × 9 / 4`, so rating 1 gives 1 and rating 5 gives 10.
3. **Blend**: `final = blend × calculated + (1 − blend) × rating score`. Default blend 60% calculated. A model with no rating for a criterion uses the calculated score alone.
4. **Manual criteria** use the rating score alone (5.5 when a model has no rating).
5. **Weighted total**: `Σ(weight × final) / Σ weight`. Weights need not add to 100. Models rank by weighted total. Equal totals share a rank.
6. Each heatmap cell shows the metric value, calculated score and rating on hover or keyboard focus.

## Replace dummy data with real data

Work screen by screen. Each record keeps its "Dummy" badge until you tick "Mark as real data". The banner and the results page count the inputs still marked dummy.

1. **Network.** Enter the confirmed DC position and untick "Location to confirm". Check hub coordinates, radius and store counts. Mark each as real.
2. **Stores.** On the data screen, import a CSV with columns `name, lat, lon, country, weekly volume`. Each store links to its nearest hub. Weekly volume sets the store's share of units in volume scenarios. Use "Export current stores as CSV" to get the format.
3. **Products.** Replace the dummy products with the real range, or edit them in place. The sales mix should add up to 100%.
4. **Cost assumptions.** Enter real rates and tariffs and mark each as real. Use model cost overrides for quotes that apply to one model only, for example a 3PL tender.
5. **Scenarios.** Enter a real forecast in volume mode, or import a real test order CSV (`target, product, quantity`) on the data screen.
6. **Models.** Adjust each model's parameters to the real proposal and mark it as real.
7. **Criteria.** Review names, weights and metrics with the decision makers. Set ratings per model.

To start from a clean sheet, export a JSON backup and use "Clear all dummy data". It removes every product, hub, store set, scenario and model still marked dummy, and sets dummy cost assumptions to 0. "Reset to dummy data" brings back the full seed.

## Known limits

- Carrier emissions use a fixed amount per stop, with no link to distance. This favours carrier models on CO2.
- Stock held at the DC is the same in every model. Inventory carrying cost covers hub stock only.
- Van routes have no shift-length limit.
- Generated stores take the country of their hub, even when the radius crosses a border.
- Map tiles load from OpenStreetMap and need an internet connection. The rest of the app works offline.
