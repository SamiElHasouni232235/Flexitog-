"""Cost and time parameters with placeholder defaults.

Every row carries `source` ("placeholder" or "real") and `source_note`.
Placeholder values come from general trade and freight knowledge as of 2025-2026
and must be replaced with FlexiTog quotes and broker data before conclusions
are drawn. Phase 2 (routing engine) reads these tables.
"""
from __future__ import annotations

import pandas as pd

PLACEHOLDER = "placeholder"
REAL = "real"
PARAM_SOURCES = [PLACEHOLDER, REAL]


def _rows(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    df["source"] = df.get("source", PLACEHOLDER)
    df["source"] = df["source"].fillna(PLACEHOLDER)
    return df


# ---------------------------------------------------------------- general

GENERAL = _rows([
    {"parameter": "cargo_insurance_pct_of_value", "value": 0.30, "unit": "% of CIF value",
     "source_note": "Typical all-risk cargo cover 0.2-0.5%"},
    {"parameter": "pallet_max_weight_kg", "value": 500, "unit": "kg",
     "source_note": "Workwear is volume-bound; 300-500 kg per EUR pallet is common"},
    {"parameter": "pallet_volume_m3", "value": 1.73, "unit": "m3",
     "source_note": "EUR pallet 1.2 x 0.8 x 1.8 m incl. base"},
    {"parameter": "helmond_outbound_handling_eur_per_pallet", "value": 12, "unit": "EUR/pallet",
     "source_note": "Pick, wrap, label at Helmond. Replace with internal cost"},
    {"parameter": "export_docs_eur_per_shipment", "value": 60, "unit": "EUR/shipment",
     "source_note": "EU export declaration (MRN) via forwarder"},
    {"parameter": "certificate_of_origin_eur", "value": 45, "unit": "EUR/shipment",
     "source_note": "Chamber of Commerce CoO or EUR.1/A.TR issuance"},
    {"parameter": "working_capital_rate_pct", "value": 8.0, "unit": "% per year",
     "source_note": "Cost of capital tied up in forward stock"},
    {"parameter": "shipments_per_year_per_country", "value": 12, "unit": "shipments",
     "source_note": "Spreads per-SKU-per-year and one-off compliance cost over shipments"},
    {"parameter": "one_off_amortisation_years", "value": 3, "unit": "years",
     "source_note": "Write-off period for one-off registrations"},
    {"parameter": "free_zone_handling_eur_per_pallet", "value": 15, "unit": "EUR/pallet",
     "source_note": "Free-zone entry/exit paperwork when a hub serves a neighbour country"},
    {"parameter": "risk_premium_lane_occasional_pct", "value": 5, "unit": "% of cost",
     "source_note": "Routing score penalty. Not a real cost, only steers the recommendation"},
    {"parameter": "risk_premium_lane_unproven_pct", "value": 15, "unit": "% of cost",
     "source_note": "Routing score penalty for lanes never or rarely used"},
    {"parameter": "risk_premium_dc_potential_pct", "value": 5, "unit": "% of cost",
     "source_note": "Routing score penalty for a partner not yet signed"},
    {"parameter": "risk_premium_dc_candidate_pct", "value": 10, "unit": "% of cost",
     "source_note": "Routing score penalty for a hypothetical node"},
    {"parameter": "proven_lane_min_orders_12m", "value": 6, "unit": "orders",
     "source_note": "Sales history orders via a DC in 12 months that make its lane proven"},
    {"parameter": "hassle_weight_customer_paperwork", "value": 3, "unit": "points/step",
     "source_note": "Customer-first hassle score: clearance, duty or compliance step the customer handles"},
    {"parameter": "hassle_weight_customer_other", "value": 1, "unit": "points/step",
     "source_note": "Customer-first hassle score: other step the customer arranges (e.g. inland transport)"},
])


# ---------------------------------------------------------------- freight
# leg: main = Helmond to destination country/port; domestic = in-country delivery;
# inbound = supplier to Helmond (used when an order starts at a supplier).

FREIGHT = _rows([
    # Türkiye: road via Balkans, customs union partner.
    {"leg": "main", "dest_country": "TR", "mode": "road", "port_or_border": "Istanbul (Kapıkule)",
     "eur_per_pallet": 260, "min_charge_eur": 450, "transit_days": 6,
     "source_note": "Groupage NL-Istanbul, EUR 200-320/pallet. FTL approx. EUR 3.8-4.5k"},
    {"leg": "main", "dest_country": "TR", "mode": "sea", "port_or_border": "Ambarlı / Mersin",
     "eur_per_pallet": 190, "min_charge_eur": 400, "transit_days": 14,
     "source_note": "LCL Rotterdam-Ambarlı incl. origin/destination THC"},
    # North Africa.
    {"leg": "main", "dest_country": "MA", "mode": "road", "port_or_border": "Tanger Med (ferry)",
     "eur_per_pallet": 280, "min_charge_eur": 450, "transit_days": 6,
     "source_note": "Groupage via Spain + Algeciras ferry"},
    {"leg": "main", "dest_country": "MA", "mode": "sea", "port_or_border": "Casablanca",
     "eur_per_pallet": 180, "min_charge_eur": 400, "transit_days": 10,
     "source_note": "LCL Rotterdam-Casablanca"},
    {"leg": "main", "dest_country": "EG", "mode": "sea", "port_or_border": "Alexandria",
     "eur_per_pallet": 210, "min_charge_eur": 450, "transit_days": 16,
     "source_note": "LCL Rotterdam-Alexandria"},
    {"leg": "main", "dest_country": "DZ", "mode": "sea", "port_or_border": "Algiers",
     "eur_per_pallet": 240, "min_charge_eur": 500, "transit_days": 14,
     "source_note": "LCL Rotterdam-Algiers, port congestion adds risk"},
    {"leg": "main", "dest_country": "TN", "mode": "sea", "port_or_border": "Radès",
     "eur_per_pallet": 200, "min_charge_eur": 450, "transit_days": 12,
     "source_note": "LCL Rotterdam-Radès"},
    # Gulf/GCC. Red Sea diversions add 10-14 days via Cape of Good Hope.
    {"leg": "main", "dest_country": "AE", "mode": "sea", "port_or_border": "Jebel Ali",
     "eur_per_pallet": 230, "min_charge_eur": 500, "transit_days": 30,
     "source_note": "LCL Rotterdam-Jebel Ali, Cape routing"},
    {"leg": "main", "dest_country": "SA", "mode": "sea", "port_or_border": "Dammam",
     "eur_per_pallet": 250, "min_charge_eur": 500, "transit_days": 33,
     "source_note": "LCL Rotterdam-Dammam, Cape routing"},
    {"leg": "main", "dest_country": "SA", "mode": "sea", "port_or_border": "Jeddah",
     "eur_per_pallet": 260, "min_charge_eur": 500, "transit_days": 24,
     "source_note": "LCL Rotterdam-Jeddah. Red Sea risk surcharges volatile"},
    {"leg": "main", "dest_country": "QA", "mode": "sea", "port_or_border": "Hamad",
     "eur_per_pallet": 260, "min_charge_eur": 500, "transit_days": 32,
     "source_note": "LCL Rotterdam-Hamad"},
    {"leg": "main", "dest_country": "KW", "mode": "sea", "port_or_border": "Shuwaikh",
     "eur_per_pallet": 270, "min_charge_eur": 500, "transit_days": 34,
     "source_note": "LCL Rotterdam-Shuwaikh"},
    {"leg": "main", "dest_country": "BH", "mode": "sea", "port_or_border": "Khalifa Bin Salman",
     "eur_per_pallet": 265, "min_charge_eur": 500, "transit_days": 33,
     "source_note": "LCL Rotterdam-Bahrain"},
    {"leg": "main", "dest_country": "OM", "mode": "sea", "port_or_border": "Sohar",
     "eur_per_pallet": 255, "min_charge_eur": 500, "transit_days": 30,
     "source_note": "LCL Rotterdam-Sohar"},
    {"leg": "main", "dest_country": "*", "mode": "air", "port_or_border": "Main airport",
     "eur_per_pallet": 1100, "min_charge_eur": 600, "transit_days": 4,
     "source_note": "Approx. EUR 3-4/kg chargeable at 300 kg/pallet. Emergency use only"},
    # Regional hub to neighbour country (3PL / owned warehouse serving the region).
    {"leg": "regional", "dest_country": "GCC", "mode": "road", "port_or_border": "GCC land border",
     "eur_per_pallet": 120, "min_charge_eur": 250, "transit_days": 3,
     "source_note": "Jebel Ali to other GCC by truck. Customs at each border"},
    {"leg": "regional", "dest_country": "NAF", "mode": "sea", "port_or_border": "Short sea",
     "eur_per_pallet": 160, "min_charge_eur": 350, "transit_days": 7,
     "source_note": "Tanger Med to EG/TN/DZ. Poor intra-Maghreb connections"},
    # In-country delivery from port/warehouse to the customer city.
    {"leg": "domestic", "dest_country": "*", "mode": "road", "port_or_border": "",
     "eur_per_pallet": 55, "min_charge_eur": 90, "transit_days": 2,
     "source_note": "Generic in-country LTL. Override per country"},
    {"leg": "domestic", "dest_country": "SA", "mode": "road", "port_or_border": "",
     "eur_per_pallet": 80, "min_charge_eur": 120, "transit_days": 3,
     "source_note": "Long distances Dammam-Riyadh-Jeddah"},
    # Supplier to Helmond. Used only when the order starts at a supplier.
    {"leg": "inbound", "dest_country": "NL", "mode": "sea", "port_or_border": "Rotterdam",
     "eur_per_pallet": 140, "min_charge_eur": 300, "transit_days": 35,
     "source_note": "Asia-Rotterdam LCL + drayage to Helmond. Replace per supplier"},
])


# ---------------------------------------------------------------- duties
# duty_pct_eu_origin: rate when goods qualify for EU preferential treatment
# (EUR.1 / A.TR / origin declaration). duty_pct_standard: MFN / common tariff
# for workwear (HS 6201-6211, 6116, 6403) of non-EU origin.

DUTIES = _rows([
    {"country": "TR", "duty_pct_eu_origin": 0.0, "duty_pct_standard": 12.0, "vat_pct": 20.0,
     "other_fees_pct": 0.0, "preference_document": "A.TR",
     "clearance_broker_eur": 180,
     "source_note": ("Customs union: 0% with A.TR for goods in EU free circulation. Türkiye adds "
                     "'additional customs duty' on Asian-origin apparel (up to 30%+); check per HS code")},
    {"country": "MA", "duty_pct_eu_origin": 0.0, "duty_pct_standard": 40.0, "vat_pct": 20.0,
     "other_fees_pct": 0.25, "preference_document": "EUR.1",
     "clearance_broker_eur": 200, "source_note": "EU-Morocco AA. MFN on apparel up to 40%. Para-fiscal levy 0.25%"},
    {"country": "DZ", "duty_pct_eu_origin": 0.0, "duty_pct_standard": 30.0, "vat_pct": 19.0,
     "other_fees_pct": 2.0, "preference_document": "EUR.1",
     "clearance_broker_eur": 300,
     "source_note": "EU-Algeria AA. DAPS safeguard levy on some goods. Import licensing risk"},
    {"country": "TN", "duty_pct_eu_origin": 0.0, "duty_pct_standard": 20.0, "vat_pct": 19.0,
     "other_fees_pct": 1.0, "preference_document": "EUR.1",
     "clearance_broker_eur": 200, "source_note": "EU-Tunisia AA"},
    {"country": "EG", "duty_pct_eu_origin": 0.0, "duty_pct_standard": 30.0, "vat_pct": 14.0,
     "other_fees_pct": 1.0, "preference_document": "EUR.1",
     "clearance_broker_eur": 250, "source_note": "EU-Egypt AA. MFN apparel 30-40%"},
    {"country": "LY", "duty_pct_eu_origin": 10.0, "duty_pct_standard": 10.0, "vat_pct": 0.0,
     "other_fees_pct": 4.0, "preference_document": "none",
     "clearance_broker_eur": 350, "source_note": "No EU agreement in force. High uncertainty"},
    {"country": "SA", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 15.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 250, "source_note": "GCC common external tariff 5%. No EU-GCC FTA"},
    {"country": "AE", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 5.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 180, "source_note": "GCC CET 5%. Free-zone storage is duty-suspended"},
    {"country": "QA", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 0.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 200, "source_note": "GCC CET 5%. No VAT yet"},
    {"country": "KW", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 0.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 220, "source_note": "GCC CET 5%. No VAT yet"},
    {"country": "BH", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 10.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 200, "source_note": "GCC CET 5%"},
    {"country": "OM", "duty_pct_eu_origin": 5.0, "duty_pct_standard": 5.0, "vat_pct": 5.0,
     "other_fees_pct": 0.0, "preference_document": "none",
     "clearance_broker_eur": 200, "source_note": "GCC CET 5%"},
])


# ---------------------------------------------------------------- compliance
# basis: per_shipment, per_sku_year (per certified SKU/model per year),
#        one_off (per SKU registration), per_order.
# applies_to: all or cert_skus (only SKUs flagged requires_conformity_cert).

COMPLIANCE = _rows([
    {"country": "SA", "item": "SABER Product Certificate (PCoC)", "basis": "per_sku_year",
     "cost_eur": 350, "applies_to": "cert_skus", "doc_steps": 1, "lead_days": 10,
     "source_note": "Via notified body. Model-level, valid 1 year"},
    {"country": "SA", "item": "SABER Shipment Certificate (SC)", "basis": "per_shipment",
     "cost_eur": 150, "applies_to": "cert_skus", "doc_steps": 1, "lead_days": 3,
     "source_note": "One per shipment against valid PCoCs"},
    {"country": "SA", "item": "CoO + invoice legalisation", "basis": "per_shipment",
     "cost_eur": 120, "applies_to": "all", "doc_steps": 2, "lead_days": 3,
     "source_note": "Chamber + embassy legalisation / e-legalisation"},
    {"country": "AE", "item": "Invoice attestation (MoFA)", "basis": "per_shipment",
     "cost_eur": 40, "applies_to": "all", "doc_steps": 1, "lead_days": 1,
     "source_note": "AED fee scales with invoice value above AED 10k"},
    {"country": "QA", "item": "CoO + invoice legalisation", "basis": "per_shipment",
     "cost_eur": 110, "applies_to": "all", "doc_steps": 2, "lead_days": 3, "source_note": ""},
    {"country": "KW", "item": "CoO + invoice legalisation", "basis": "per_shipment",
     "cost_eur": 110, "applies_to": "all", "doc_steps": 2, "lead_days": 3, "source_note": ""},
    {"country": "BH", "item": "CoO + invoice legalisation", "basis": "per_shipment",
     "cost_eur": 90, "applies_to": "all", "doc_steps": 2, "lead_days": 3, "source_note": ""},
    {"country": "OM", "item": "CoO + invoice legalisation", "basis": "per_shipment",
     "cost_eur": 90, "applies_to": "all", "doc_steps": 2, "lead_days": 3, "source_note": ""},
    {"country": "EG", "item": "ACI / Nafeza + CargoX registration", "basis": "per_shipment",
     "cost_eur": 80, "applies_to": "all", "doc_steps": 2, "lead_days": 2,
     "source_note": "Advance Cargo Information, blockchain docs via CargoX"},
    {"country": "EG", "item": "GOEIC manufacturer registration", "basis": "one_off",
     "cost_eur": 1500, "applies_to": "all", "doc_steps": 3, "lead_days": 60,
     "source_note": "Decree 43/2016 lists apparel. Brand-owner/factory registration"},
    {"country": "DZ", "item": "Bank domiciliation + CoC", "basis": "per_shipment",
     "cost_eur": 200, "applies_to": "all", "doc_steps": 3, "lead_days": 10,
     "source_note": "Importer side. Adds delay"},
    {"country": "MA", "item": "EUR.1 + conformity check (MCI)", "basis": "per_shipment",
     "cost_eur": 60, "applies_to": "all", "doc_steps": 1, "lead_days": 2, "source_note": ""},
    {"country": "TN", "item": "EUR.1 + technical control", "basis": "per_shipment",
     "cost_eur": 60, "applies_to": "all", "doc_steps": 1, "lead_days": 2, "source_note": ""},
    {"country": "TR", "item": "A.TR + TAREKS check", "basis": "per_shipment",
     "cost_eur": 50, "applies_to": "all", "doc_steps": 1, "lead_days": 1,
     "source_note": "TAREKS risk-based inspection for some PPE"},
])


# ---------------------------------------------------------------- lead times (non-transport legs)

LEAD_TIMES = _rows([
    {"step": "order_processing_helmond", "days": 2, "applies_to": "helmond_hub",
     "source_note": "Order entry to goods ready at Helmond dock"},
    {"step": "export_clearance_eu", "days": 1, "applies_to": "all", "source_note": ""},
    {"step": "import_clearance", "days": 3, "applies_to": "all",
     "source_note": "Default. Overridden by country row below if present"},
    {"step": "import_clearance:SA", "days": 5, "applies_to": "SA", "source_note": "FASAH + SABER checks"},
    {"step": "import_clearance:EG", "days": 7, "applies_to": "EG", "source_note": "Port dwell often longer"},
    {"step": "import_clearance:DZ", "days": 10, "applies_to": "DZ", "source_note": ""},
    {"step": "import_clearance:AE", "days": 2, "applies_to": "AE", "source_note": ""},
    {"step": "import_clearance:TR", "days": 2, "applies_to": "TR", "source_note": ""},
    {"step": "local_pick_and_dispatch", "days": 1, "applies_to": "distributor;3pl;owned_warehouse",
     "source_note": "From in-region stock"},
    {"step": "replenishment_cycle", "days": 30, "applies_to": "distributor;3pl;owned_warehouse",
     "source_note": "Used for stock-out risk only, not order lead time"},
])


# ---------------------------------------------------------------- scenario defaults per node type
# Handling, storage, margin and MOV defaults. A value on a DC row overrides these.
# handoffs = parties that take custody between Helmond and the customer.

SCENARIOS = _rows([
    {"scenario": "cif_baseline", "label": "Baseline: CIF to port",
     "inbound_eur_per_pallet": 0, "storage_eur_per_pallet_month": 0, "avg_storage_months": 0,
     "outbound_eur_per_order": 0, "margin_pct": 0, "min_order_value_eur": 1500,
     "replenishment_freight_factor": 1.0, "replenishment_pallets_per_shipment": 0,
     "source_note": ("FlexiTog pays freight + insurance to port. Customer clears, pays duty and moves "
                     "goods inland. Each order ships on its own, so min charges and per-shipment fees apply")},
    {"scenario": "distributor", "label": "Distributor-held stock",
     "inbound_eur_per_pallet": 0, "storage_eur_per_pallet_month": 0, "avg_storage_months": 0,
     "outbound_eur_per_order": 0, "margin_pct": 25, "min_order_value_eur": 250,
     "replenishment_freight_factor": 0.75, "replenishment_pallets_per_shipment": 10,
     "source_note": ("Distributor buys stock, carries duty. Its handling, storage and capital cost sit "
                     "inside the margin (20-35% of goods value typical for workwear)")},
    {"scenario": "3pl", "label": "3PL presence",
     "inbound_eur_per_pallet": 18, "storage_eur_per_pallet_month": 14, "avg_storage_months": 2.5,
     "outbound_eur_per_order": 35, "margin_pct": 0, "min_order_value_eur": 500,
     "replenishment_freight_factor": 0.75, "replenishment_pallets_per_shipment": 12,
     "source_note": ("Jebel Ali FZ / Istanbul / Tanger Med 3PL rate cards: inbound EUR 10-25/pallet, "
                     "storage EUR 10-20/pallet/month. Replenishment in consolidated loads")},
    {"scenario": "owned_warehouse", "label": "Owned non-EU warehouse",
     "inbound_eur_per_pallet": 8, "storage_eur_per_pallet_month": 9, "avg_storage_months": 2.5,
     "outbound_eur_per_order": 25, "margin_pct": 0, "min_order_value_eur": 500,
     "replenishment_freight_factor": 0.7, "replenishment_pallets_per_shipment": 20,
     "source_note": ("Variable cost only. Fixed cost (lease, staff, entity) comes from the owned "
                     "warehouse fixed cost table, spread per pallet")},
])

OWNED_FIXED = _rows([
    {"location": "AE", "fixed_cost_eur_per_year": 220000, "expected_pallets_per_year": 1500,
     "source_note": "Small FZ unit (1,000 m2) + 3 FTE + entity costs"},
    {"location": "TR", "fixed_cost_eur_per_year": 160000, "expected_pallets_per_year": 1200, "source_note": ""},
    {"location": "MA", "fixed_cost_eur_per_year": 140000, "expected_pallets_per_year": 800,
     "source_note": "Tanger Med zone"},
])


DEFAULT_TABLES: dict[str, tuple[str, pd.DataFrame]] = {
    "general": ("General", GENERAL),
    "freight": ("Freight rates per leg", FREIGHT),
    "duties": ("Customs duty and VAT per country", DUTIES),
    "compliance": ("Compliance and certification costs", COMPLIANCE),
    "lead_times": ("Lead time per non-transport step", LEAD_TIMES),
    "scenarios": ("Scenario defaults (handling, margin, MOV, handoffs)", SCENARIOS),
    "owned_fixed": ("Owned warehouse fixed cost", OWNED_FIXED),
}


# Unique key column per table, used to merge new defaults into saved files.
TABLE_KEYS = {"general": "parameter", "scenarios": "scenario", "duties": "country",
              "owned_fixed": "location", "lead_times": "step"}


def default_table(name: str) -> pd.DataFrame:
    return DEFAULT_TABLES[name][1].copy()
