"""Placeholder master data so the tool runs before real data is imported.

All names are generic. Every row is tagged data_source=placeholder.
Replace by importing real files on the Import page.
"""
from __future__ import annotations

import pandas as pd

from .schema import ENTITIES, PLACEHOLDER, SOURCE_COL
from .importer import coerce_frame, enrich


# FlexiTog's own line is made in Albania. RefrigiWear and Gold Freeze come mostly from China and
# Bangladesh, with a few items from Serbia. Supplier names are placeholders.
SUPPLIERS = [
    {"supplier_id": "SUP-AL1", "name": "Placeholder garment maker Albania", "country": "AL", "city": "Durrës",
     "sku_ids": "FT-JKT-100;FT-JKT-200;FT-TRS-100;FT-OVR-100", "lead_time_days": 35, "incoterm": "DAP",
     "currency": "EUR", "brands": "FlexiTog", "inbound_mode": "sea", "direct_to_partners": True,
     "notes": "Cut-make-trim for the FlexiTog line. Sea from Durrës; road via Montenegro and Croatia is the alternative"},
    {"supplier_id": "SUP-CN1", "name": "Placeholder workwear maker China (Ningbo)", "country": "CN", "city": "Ningbo",
     "sku_ids": "RW-PRK-100;RW-GLV-100", "lead_time_days": 90, "incoterm": "FOB", "currency": "USD",
     "brands": "RefrigiWear", "inbound_mode": "sea", "direct_to_partners": True},
    {"supplier_id": "SUP-CN2", "name": "Placeholder glove maker China (Qingdao)", "country": "CN", "city": "Qingdao",
     "sku_ids": "GF-GLV-200", "lead_time_days": 85, "incoterm": "FOB", "currency": "USD",
     "brands": "Gold Freeze", "inbound_mode": "sea", "direct_to_partners": True},
    {"supplier_id": "SUP-BD1", "name": "Placeholder garment maker Bangladesh (Chattogram)", "country": "BD",
     "city": "Chattogram", "sku_ids": "RW-VST-100;GF-BAL-100;GF-TRS-200", "lead_time_days": 95, "incoterm": "FOB",
     "currency": "USD", "brands": "RefrigiWear;Gold Freeze", "inbound_mode": "sea", "direct_to_partners": True},
    {"supplier_id": "SUP-RS1", "name": "Placeholder footwear and hosiery maker Serbia", "country": "RS",
     "city": "Leskovac", "sku_ids": "RW-BOT-100;GF-SOC-100", "lead_time_days": 30, "incoterm": "FCA",
     "currency": "EUR", "brands": "RefrigiWear;Gold Freeze", "inbound_mode": "sea",
     "direct_to_partners": True},
]

DCS = [
    {"dc_id": "HLM", "name": "Helmond EU hub", "dc_type": "helmond_hub", "status": "existing", "provider_type": "Own hub",
     "country": "NL", "city": "Helmond", "port_of_entry": "Rotterdam",
     "serves_countries": "TR;MA;DZ;TN;EG;LY;SA;AE;QA;KW;BH;OM",
     "notes": "Origin of every flow in this tool"},
    # Distributors
    {"dc_id": "DIST-SA", "name": "Distributor Saudi Arabia", "dc_type": "distributor", "status": "potential",
     "country": "SA", "city": "Dammam", "port_of_entry": "Dammam", "serves_countries": "SA"},
    {"dc_id": "DIST-AE", "name": "Distributor UAE", "dc_type": "distributor", "status": "potential",
     "country": "AE", "city": "Dubai", "port_of_entry": "Jebel Ali", "serves_countries": "AE;OM"},
    {"dc_id": "DIST-TR", "name": "Distributor Türkiye", "dc_type": "distributor", "status": "potential",
     "country": "TR", "city": "Istanbul", "port_of_entry": "Istanbul (Kapıkule)", "serves_countries": "TR"},
    {"dc_id": "DIST-MA", "name": "Distributor Morocco", "dc_type": "distributor", "status": "potential",
     "country": "MA", "city": "Casablanca", "port_of_entry": "Casablanca", "serves_countries": "MA"},
    {"dc_id": "DIST-EG", "name": "Distributor Egypt", "dc_type": "distributor", "status": "potential",
     "country": "EG", "city": "Cairo", "port_of_entry": "Alexandria", "serves_countries": "EG"},
    # 3PL
    {"dc_id": "3PL-JAFZ", "name": "3PL Jebel Ali Free Zone", "dc_type": "3pl", "status": "candidate", "provider_type": "3PL",
     "country": "AE", "city": "Dubai", "port_of_entry": "Jebel Ali",
     "serves_countries": "AE;SA;QA;KW;BH;OM", "notes": "Duty-suspended storage, re-export to GCC"},
    {"dc_id": "3PL-IST", "name": "3PL Istanbul", "dc_type": "3pl", "status": "candidate", "provider_type": "3PL",
     "country": "TR", "city": "Istanbul", "port_of_entry": "Istanbul (Kapıkule)", "serves_countries": "TR"},
    {"dc_id": "3PL-TNG", "name": "3PL Tanger Med", "dc_type": "3pl", "status": "candidate", "provider_type": "3PL",
     "country": "MA", "city": "Tangier", "port_of_entry": "Tanger Med (ferry)",
     "serves_countries": "MA;TN;EG;DZ", "notes": "Free zone, onward short sea"},
    # Logistics providers for Benchmarking (moved here from the Benchmarking view). Dummy records to try the
    # RFQ workflow: replace or delete them. Freight forwarders hold no stock, so the engine does not route them.
    {"dc_id": "PRV-0001", "name": "Example Forwarding Co. (dummy)", "dc_type": "freight_forwarder", "status": "candidate",
     "customs_brokerage": True, "free_zone": False, "warehousing": False, "compliance_support": True,
     "handoffs_per_shipment": 4, "documents_per_shipment": 5,
     "provider_type": "Freight forwarder", "country": "NL", "city": "Eindhoven", "serves_countries": "TR;MA;TN;EG",
     "contact_name": "Alex Example", "contact_email": "alex@forwarder.example.com", "contact_phone": "+31 40 000 0001",
     "website": "https://forwarder.example.com", "notes": "Dummy record to try the tool. Replace or delete it."},
    {"dc_id": "PRV-0002", "name": "Sample Gulf 3PL (dummy)", "dc_type": "3pl", "status": "candidate",
     "customs_brokerage": True, "free_zone": True, "warehousing": True, "compliance_support": True,
     "handoffs_per_shipment": 3, "documents_per_shipment": 4,
     "provider_type": "3PL", "country": "AE", "city": "Dubai", "port_of_entry": "Jebel Ali", "serves_countries": "AE;SA;QA;KW;BH;OM",
     "contact_name": "Sam Sample", "contact_email": "sam@gulf3pl.example.com", "contact_phone": "+971 4 000 0002",
     "website": "https://gulf3pl.example.com", "notes": "Dummy record to try the tool. Replace or delete it."},
    {"dc_id": "PRV-0003", "name": "Demo Road Carrier (dummy)", "dc_type": "freight_forwarder", "status": "candidate",
     "provider_type": "Freight forwarder", "country": "TR", "city": "Istanbul", "serves_countries": "TR",
     "contact_name": "Dana Demo", "contact_email": "dana@roadcarrier.example.com", "contact_phone": "+90 212 000 0003",
     "notes": "Dummy record to try the tool. Replace or delete it."},
    # Owned
    {"dc_id": "OWN-AE", "name": "Owned warehouse UAE (hypothetical)", "dc_type": "owned_warehouse",
     "status": "candidate", "country": "AE", "city": "Dubai", "port_of_entry": "Jebel Ali",
     "serves_countries": "AE;SA;QA;KW;BH;OM"},
    {"dc_id": "OWN-TR", "name": "Owned warehouse Türkiye (hypothetical)", "dc_type": "owned_warehouse",
     "status": "candidate", "country": "TR", "city": "Istanbul", "port_of_entry": "Istanbul (Kapıkule)",
     "serves_countries": "TR"},
    {"dc_id": "OWN-MA", "name": "Owned warehouse Morocco (hypothetical)", "dc_type": "owned_warehouse",
     "status": "candidate", "country": "MA", "city": "Tangier", "port_of_entry": "Tanger Med (ferry)",
     "serves_countries": "MA;TN;EG;DZ"},
]

CUSTOMERS = [
    {"customer_id": "C-TR-01", "name": "Sample cold store Istanbul", "country": "TR", "city": "Istanbul",
     "postal_code": "34555", "current_incoterm": "CIF", "destination_port": "Ambarlı"},
    {"customer_id": "C-TR-02", "name": "Sample food logistics Izmir", "country": "TR", "city": "Izmir",
     "postal_code": "35410", "current_incoterm": "CIF", "destination_port": "Izmir"},
    {"customer_id": "C-MA-01", "name": "Sample fish processor Agadir", "country": "MA", "city": "Agadir",
     "postal_code": "80000", "current_incoterm": "CIF", "destination_port": "Casablanca"},
    {"customer_id": "C-EG-01", "name": "Sample frozen foods Cairo", "country": "EG", "city": "Cairo",
     "postal_code": "11511", "current_incoterm": "CIF", "destination_port": "Alexandria"},
    {"customer_id": "C-DZ-01", "name": "Sample dairy Algiers", "country": "DZ", "city": "Algiers",
     "postal_code": "16000", "current_incoterm": "CIF", "destination_port": "Algiers"},
    {"customer_id": "C-SA-01", "name": "Sample cold chain Riyadh", "country": "SA", "city": "Riyadh",
     "postal_code": "11564", "current_incoterm": "CIF", "destination_port": "Dammam"},
    {"customer_id": "C-SA-02", "name": "Sample food distribution Jeddah", "country": "SA", "city": "Jeddah",
     "postal_code": "21442", "current_incoterm": "CIF", "destination_port": "Jeddah"},
    {"customer_id": "C-AE-01", "name": "Sample cold store Dubai", "country": "AE", "city": "Dubai",
     "postal_code": "00000", "current_incoterm": "CIF", "destination_port": "Jebel Ali"},
    {"customer_id": "C-QA-01", "name": "Sample catering Doha", "country": "QA", "city": "Doha",
     "postal_code": "00000", "current_incoterm": "CIF", "destination_port": "Hamad"},
    {"customer_id": "C-KW-01", "name": "Sample food import Kuwait City", "country": "KW", "city": "Kuwait City",
     "postal_code": "13001", "current_incoterm": "CIF", "destination_port": "Shuwaikh"},
]

PRODUCTS = [
    {"sku": "FT-JKT-100", "category": "Jackets", "carton_l_cm": 60, "carton_w_cm": 40, "carton_h_cm": 40, "units_per_carton": 8, "brand": "FlexiTog", "description": "Freezer jacket -50°C", "product_family": "Jackets",
     "unit_weight_kg": 2.1, "length_cm": 60, "width_cm": 40, "height_cm": 12, "unit_price_eur": 139,
     "hs_code": "6201.40", "country_of_origin": "AL", "units_per_pallet": 120, "requires_conformity_cert": True},
    {"sku": "FT-JKT-200", "category": "Jackets", "carton_l_cm": 55, "carton_w_cm": 40, "carton_h_cm": 40, "units_per_carton": 10, "brand": "FlexiTog", "description": "Chillroom jacket -20°C", "product_family": "Jackets",
     "unit_weight_kg": 1.5, "length_cm": 55, "width_cm": 38, "height_cm": 10, "unit_price_eur": 89,
     "hs_code": "6201.40", "country_of_origin": "AL", "units_per_pallet": 160, "requires_conformity_cert": True},
    {"sku": "FT-TRS-100", "category": "Trousers", "carton_l_cm": 55, "carton_w_cm": 40, "carton_h_cm": 40, "units_per_carton": 10, "brand": "FlexiTog", "description": "Freezer bib trousers -50°C", "product_family": "Trousers",
     "unit_weight_kg": 1.8, "length_cm": 55, "width_cm": 40, "height_cm": 10, "unit_price_eur": 119,
     "hs_code": "6203.43", "country_of_origin": "AL", "units_per_pallet": 140, "requires_conformity_cert": True},
    {"sku": "FT-OVR-100", "category": "Coveralls", "carton_l_cm": 65, "carton_w_cm": 45, "carton_h_cm": 45, "units_per_carton": 6, "brand": "FlexiTog", "description": "Freezer coverall -50°C", "product_family": "Coveralls",
     "unit_weight_kg": 3.2, "length_cm": 65, "width_cm": 45, "height_cm": 15, "unit_price_eur": 199,
     "hs_code": "6201.40", "country_of_origin": "AL", "units_per_pallet": 80, "requires_conformity_cert": True},
    {"sku": "RW-PRK-100", "category": "Jackets", "carton_l_cm": 62, "carton_w_cm": 42, "carton_h_cm": 42, "units_per_carton": 7, "brand": "RefrigiWear", "description": "Insulated freezer parka -45°C", "product_family": "Jackets",
     "unit_weight_kg": 2.4, "length_cm": 62, "width_cm": 42, "height_cm": 14, "unit_price_eur": 169,
     "hs_code": "6201.40", "country_of_origin": "CN", "units_per_pallet": 100, "requires_conformity_cert": True},
    {"sku": "RW-VST-100", "category": "Other", "carton_l_cm": 50, "carton_w_cm": 35, "carton_h_cm": 36, "units_per_carton": 15, "brand": "RefrigiWear", "description": "Insulated freezer vest", "product_family": "Vests",
     "unit_weight_kg": 0.9, "length_cm": 50, "width_cm": 35, "height_cm": 6, "unit_price_eur": 59,
     "hs_code": "6201.40", "country_of_origin": "BD", "units_per_pallet": 300, "requires_conformity_cert": True},
    {"sku": "RW-GLV-100", "category": "Other", "carton_l_cm": 40, "carton_w_cm": 30, "carton_h_cm": 30, "units_per_carton": 60, "brand": "RefrigiWear", "description": "Insulated freezer gloves", "product_family": "Gloves",
     "unit_weight_kg": 0.25, "length_cm": 30, "width_cm": 15, "height_cm": 5, "unit_price_eur": 24,
     "hs_code": "6116.10", "country_of_origin": "CN", "units_per_pallet": 1200, "requires_conformity_cert": True},
    {"sku": "RW-BOT-100", "category": "Other", "carton_l_cm": 60, "carton_w_cm": 40, "carton_h_cm": 30, "units_per_carton": 6, "brand": "RefrigiWear", "description": "Insulated safety boots S3", "product_family": "Footwear",
     "unit_weight_kg": 1.9, "length_cm": 35, "width_cm": 25, "height_cm": 15, "unit_price_eur": 129,
     "hs_code": "6403.40", "country_of_origin": "RS", "units_per_pallet": 150, "requires_conformity_cert": True},
    {"sku": "GF-GLV-200", "category": "Other", "carton_l_cm": 40, "carton_w_cm": 30, "carton_h_cm": 30, "units_per_carton": 200, "brand": "Gold Freeze", "description": "Cut-resistant liner gloves", "product_family": "Gloves",
     "unit_weight_kg": 0.08, "length_cm": 25, "width_cm": 12, "height_cm": 2, "unit_price_eur": 9,
     "hs_code": "6116.10", "country_of_origin": "CN", "units_per_pallet": 3000, "requires_conformity_cert": True},
    {"sku": "GF-BAL-100", "category": "Other", "carton_l_cm": 40, "carton_w_cm": 30, "carton_h_cm": 30, "units_per_carton": 100, "brand": "Gold Freeze", "description": "Thermal balaclava", "product_family": "Headwear",
     "unit_weight_kg": 0.1, "length_cm": 25, "width_cm": 20, "height_cm": 3, "unit_price_eur": 14,
     "hs_code": "6505.00", "country_of_origin": "BD", "units_per_pallet": 2000, "requires_conformity_cert": False},
    {"sku": "GF-TRS-200", "category": "Trousers", "carton_l_cm": 50, "carton_w_cm": 35, "carton_h_cm": 40, "units_per_carton": 12, "brand": "Gold Freeze", "description": "Thermal trousers -30°C", "product_family": "Trousers",
     "unit_weight_kg": 1.2, "length_cm": 50, "width_cm": 35, "height_cm": 8, "unit_price_eur": 79,
     "hs_code": "6203.43", "country_of_origin": "BD", "units_per_pallet": 180, "requires_conformity_cert": True},
    {"sku": "GF-SOC-100", "category": "Other", "carton_l_cm": 40, "carton_w_cm": 30, "carton_h_cm": 30, "units_per_carton": 150, "brand": "Gold Freeze", "description": "Thermal socks", "product_family": "Socks",
     "unit_weight_kg": 0.12, "length_cm": 25, "width_cm": 10, "height_cm": 3, "unit_price_eur": 8,
     "hs_code": "6115.96", "country_of_origin": "RS", "units_per_pallet": 4000, "requires_conformity_cert": False},
]

LANES = [
    {"lane_id": "L-HLM-SA", "origin_id": "HLM", "destination_id": "SA", "mode": "sea", "status": "occasional",
     "shipments_last_12m": 4, "notes": "Placeholder. Set to proven if Saudi shipments run reliably"},
    {"lane_id": "L-HLM-TR", "origin_id": "HLM", "destination_id": "TR", "mode": "road", "status": "occasional",
     "shipments_last_12m": 6, "notes": "Placeholder"},
    {"lane_id": "L-HLM-AE", "origin_id": "HLM", "destination_id": "AE", "mode": "sea", "status": "occasional",
     "shipments_last_12m": 3, "notes": "Placeholder"},
    {"lane_id": "L-HLM-MA", "origin_id": "HLM", "destination_id": "MA", "mode": "road", "status": "unproven",
     "shipments_last_12m": 1, "notes": "Placeholder"},
    {"lane_id": "L-HLM-MA-SEA", "origin_id": "HLM", "destination_id": "MA", "mode": "sea", "status": "unproven",
     "notes": "Sample lane for the quote sample"},
    {"lane_id": "L-HLM-SA-AIR", "origin_id": "HLM", "destination_id": "SA", "mode": "air", "status": "unproven",
     "notes": "Sample lane for the quote sample"},
]

CUSTOMERS += [
    {"customer_id": "C-TR-03", "name": "Sample meat processor Ankara", "country": "TR", "city": "Ankara",
     "postal_code": "06000", "current_incoterm": "CIF", "destination_port": "Ambarlı"},
    {"customer_id": "C-TR-04", "name": "Sample cold store Bursa", "country": "TR", "city": "Bursa",
     "postal_code": "16000", "current_incoterm": "CIF", "destination_port": "Ambarlı"},
    {"customer_id": "C-MA-02", "name": "Sample frozen foods Casablanca", "country": "MA", "city": "Casablanca",
     "postal_code": "20000", "current_incoterm": "CIF", "destination_port": "Casablanca"},
    {"customer_id": "C-MA-03", "name": "Sample logistics Tangier", "country": "MA", "city": "Tangier",
     "postal_code": "90000", "current_incoterm": "CIF", "destination_port": "Tanger Med"},
    {"customer_id": "C-EG-02", "name": "Sample cold chain Alexandria", "country": "EG", "city": "Alexandria",
     "postal_code": "21500", "current_incoterm": "CIF", "destination_port": "Alexandria"},
    {"customer_id": "C-TN-01", "name": "Sample seafood Sfax", "country": "TN", "city": "Sfax",
     "postal_code": "3000", "current_incoterm": "CIF", "destination_port": "Radès"},
    {"customer_id": "C-SA-03", "name": "Sample food logistics Dammam", "country": "SA", "city": "Dammam",
     "postal_code": "32241", "current_incoterm": "CIF", "destination_port": "Dammam"},
    {"customer_id": "C-AE-02", "name": "Sample catering Abu Dhabi", "country": "AE", "city": "Abu Dhabi",
     "postal_code": "00000", "current_incoterm": "CIF", "destination_port": "Jebel Ali"},
    {"customer_id": "C-OM-01", "name": "Sample fish export Muscat", "country": "OM", "city": "Muscat",
     "postal_code": "100", "current_incoterm": "CIF", "destination_port": "Sohar"},
    {"customer_id": "C-BH-01", "name": "Sample cold store Manama", "country": "BH", "city": "Manama",
     "postal_code": "317", "current_incoterm": "CIF", "destination_port": "Khalifa Bin Salman"},
]


def _demo_sales_history(months: int = 12, seed: int = 7) -> list[dict]:
    """Dummy sales history: CIF orders shipped direct from Helmond, weighted to bigger markets."""
    import numpy as np

    rng = np.random.default_rng(seed)
    weight = {"SA": 3, "AE": 3, "TR": 3, "MA": 2, "EG": 2, "QA": 1, "KW": 1, "DZ": 1, "TN": 1, "OM": 1, "BH": 1}
    custs = [c for c in CUSTOMERS if c["country"] in weight]
    p = np.array([weight[c["country"]] for c in custs], dtype=float)
    p /= p.sum()
    skus = [pr["sku"] for pr in PRODUCTS]
    upp = {pr["sku"]: pr["units_per_pallet"] for pr in PRODUCTS}
    price = {pr["sku"]: pr["unit_price_eur"] for pr in PRODUCTS}
    rows = []
    start = pd.Timestamp("2025-09-01")
    for i in range(months * 16):
        cust = custs[rng.choice(len(custs), p=p)]
        day = start + pd.Timedelta(days=int(rng.integers(0, months * 30)))
        pallets = int(rng.choice([1, 1, 1, 2, 2, 3, 4, 6, 8]))
        chosen = rng.choice(len(skus), size=int(rng.integers(1, 4)), replace=False)
        shares = rng.dirichlet(np.ones(len(chosen)))
        for idx, share in zip(chosen, shares):
            sku = skus[idx]
            qty = max(10, int(round(upp[sku] * pallets * share / 10)) * 10)
            rows.append({"order_id": f"SO-{25000 + i}", "order_date": day.date().isoformat(),
                         "customer_id": cust["customer_id"], "sku": sku, "quantity": qty,
                         "net_value_eur": qty * price[sku], "country": cust["country"],
                         "shipped_via": "HLM", "incoterm": "CIF"})
    return rows


ORDERS = [
    {"order_id": "T-SA-001", "customer_id": "C-SA-01", "pallet_count": 2, "pallet_type": "EUR",
     "batch": "sample", "notes": "Sample test order"},
    {"order_id": "T-TR-001", "customer_id": "C-TR-01", "pallet_count": 1, "pallet_type": "EUR",
     "batch": "sample", "notes": "Sample test order"},
]

ORDER_LINES = [
    {"order_id": "T-SA-001", "sku": "FT-JKT-100", "quantity": 120},
    {"order_id": "T-SA-001", "sku": "RW-GLV-100", "quantity": 300},
    {"order_id": "T-TR-001", "sku": "FT-TRS-100", "quantity": 60},
    {"order_id": "T-TR-001", "sku": "GF-BAL-100", "quantity": 200},
]

# Import cost facts per target country. Duty, VAT, other levies and clearance mirror the duties parameter
# table (placeholder research); compliance cost and expected yearly units are study estimates.
COUNTRIES = [
    {"country": "TR", "duty_rate_pct": 0, "standard_duty_rate_pct": 12, "preference_cert": "ATR", "vat_rate_pct": 20,
     "other_fees_pct": 0, "clearance_fee_eur": 180, "compliance_cost_eur": 500, "expected_yearly_units": 8000},
    {"country": "MA", "duty_rate_pct": 0, "standard_duty_rate_pct": 40, "preference_cert": "EUR.1", "vat_rate_pct": 20,
     "other_fees_pct": 0.25, "clearance_fee_eur": 200, "compliance_cost_eur": 800, "expected_yearly_units": 5000},
    {"country": "DZ", "duty_rate_pct": 0, "standard_duty_rate_pct": 30, "preference_cert": "EUR.1", "vat_rate_pct": 19,
     "other_fees_pct": 2, "clearance_fee_eur": 300, "compliance_cost_eur": 1500, "expected_yearly_units": 1500},
    {"country": "TN", "duty_rate_pct": 0, "standard_duty_rate_pct": 20, "preference_cert": "EUR.1", "vat_rate_pct": 19,
     "other_fees_pct": 1, "clearance_fee_eur": 200, "compliance_cost_eur": 800, "expected_yearly_units": 1000},
    {"country": "EG", "duty_rate_pct": 0, "standard_duty_rate_pct": 30, "preference_cert": "EUR.1", "vat_rate_pct": 14,
     "other_fees_pct": 1, "clearance_fee_eur": 250, "compliance_cost_eur": 2500, "expected_yearly_units": 3000},
    {"country": "SA", "duty_rate_pct": 5, "standard_duty_rate_pct": 5, "preference_cert": "none", "vat_rate_pct": 15,
     "other_fees_pct": 0, "clearance_fee_eur": 250, "compliance_cost_eur": 6000, "expected_yearly_units": 9000},
    {"country": "AE", "duty_rate_pct": 5, "standard_duty_rate_pct": 5, "preference_cert": "none", "vat_rate_pct": 5,
     "other_fees_pct": 0, "clearance_fee_eur": 180, "compliance_cost_eur": 1500, "expected_yearly_units": 7000},
    {"country": "QA", "duty_rate_pct": 5, "standard_duty_rate_pct": 5, "preference_cert": "none", "vat_rate_pct": 0,
     "other_fees_pct": 0, "clearance_fee_eur": 200, "compliance_cost_eur": 1200, "expected_yearly_units": 1500},
    {"country": "KW", "duty_rate_pct": 5, "standard_duty_rate_pct": 5, "preference_cert": "none", "vat_rate_pct": 0,
     "other_fees_pct": 0, "clearance_fee_eur": 220, "compliance_cost_eur": 1200, "expected_yearly_units": 1500},
]
for _c in COUNTRIES:
    _c.setdefault("target", True)

# Sample freight quotes for two countries (Morocco, Saudi Arabia) from two providers: a forwarder (PRV-0001)
# and a 3PL (PRV-0002). Dummy numbers marked estimate. Q-0007 has expired, Q-0002 is four months old.
QUOTES = [
    {"quote_id": "Q-0001", "provider_id": "PRV-0001", "lane_id": "L-HLM-MA", "quote_date": "2026-10-01", "valid_until": "2027-03-31",
     "base_rate": 0.55, "rate_unit": "per kg", "min_charge": 250, "fuel_surcharge": 45, "peak_surcharge": 0,
     "war_risk_surcharge": 0, "other_surcharge": 60, "currency": "EUR", "transit_days": 7},
    {"quote_id": "Q-0002", "provider_id": "PRV-0001", "lane_id": "L-HLM-SA", "quote_date": "2026-06-15", "valid_until": "2026-12-31",
     "base_rate": 95, "rate_unit": "per m3", "min_charge": 150, "fuel_surcharge": 35, "peak_surcharge": 40,
     "war_risk_surcharge": 25, "other_surcharge": 80, "currency": "USD", "transit_days": 30},
    {"quote_id": "Q-0003", "provider_id": "PRV-0002", "lane_id": "L-HLM-SA", "quote_date": "2026-09-20", "valid_until": "2027-01-31",
     "base_rate": 110, "rate_unit": "per m3", "min_charge": 200, "fuel_surcharge": 30, "peak_surcharge": 0,
     "war_risk_surcharge": 30, "other_surcharge": 90, "currency": "EUR", "transit_days": 28},
    {"quote_id": "Q-0004", "provider_id": "PRV-0002", "lane_id": "L-HLM-SA-AIR", "quote_date": "2026-10-05", "valid_until": "2026-12-31",
     "base_rate": 3.10, "rate_unit": "per kg", "min_charge": 120, "fuel_surcharge": 60, "peak_surcharge": 25,
     "war_risk_surcharge": 0, "other_surcharge": 70, "currency": "USD", "transit_days": 5},
    {"quote_id": "Q-0005", "provider_id": "PRV-0002", "lane_id": "L-HLM-MA-SEA", "quote_date": "2026-09-10", "valid_until": "2027-02-28",
     "base_rate": 70, "rate_unit": "per m3", "min_charge": 120, "fuel_surcharge": 25, "peak_surcharge": 0,
     "war_risk_surcharge": 0, "other_surcharge": 70, "currency": "EUR", "transit_days": 12},
    {"quote_id": "Q-0006", "provider_id": "PRV-0001", "lane_id": "L-HLM-MA-SEA", "quote_date": "2026-10-10", "valid_until": "2027-04-30",
     "base_rate": 78, "rate_unit": "per m3", "min_charge": 100, "fuel_surcharge": 20, "peak_surcharge": 0,
     "war_risk_surcharge": 0, "other_surcharge": 55, "currency": "EUR", "transit_days": 10},
    {"quote_id": "Q-0007", "provider_id": "PRV-0001", "lane_id": "L-HLM-SA", "quote_date": "2026-03-01", "valid_until": "2026-06-30",
     "base_rate": 88, "rate_unit": "per m3", "min_charge": 150, "fuel_surcharge": 30, "peak_surcharge": 0,
     "war_risk_surcharge": 0, "other_surcharge": 80, "currency": "USD", "transit_days": 32, "notes": "Expired sample"},
]

SETTINGS = [{"settings_id": "main", "eur_usd_rate": 1.16, "eur_usd_date": "2026-10-20", "insurance_rate_pct": 0.30,
             "margin_pct": 25, "shipment_units": 500}]

# Provenance of the built-in data: all of it is an estimate until replaced by a confirmed source.
SEED_SOURCE = "Built-in study placeholder"
SEED_DATE = "2026-10-26"

SEED = {
    "suppliers": SUPPLIERS,
    "distribution_centers": DCS,
    "customers": CUSTOMERS,
    "products": PRODUCTS,
    "lanes": LANES,
    "orders": ORDERS,
    "order_lines": ORDER_LINES,
    "sales_history": _demo_sales_history(),
    "demand_forecast": [],
    "countries": COUNTRIES,
    "temperature_zones": [{"category_match": "Freezer", "zone": "freezer"}, {"category_match": "Chiller", "zone": "chiller"},
                          {"category_match": "PPE", "zone": "ppe"}, {"category_match": "Safety", "zone": "ppe"}],
    "quotes": QUOTES,
    "settings": SETTINGS,
}


def seed_frame(key: str) -> pd.DataFrame:
    entity = ENTITIES[key]
    rows = SEED.get(key, [])
    df = pd.DataFrame(rows, columns=entity.field_names()) if not rows else pd.DataFrame(rows)
    for name in entity.field_names():
        if name not in df.columns:
            df[name] = None
    df = df[entity.field_names()]
    if len(df):
        df["source_ref"] = df["source_ref"].fillna(SEED_SOURCE)
        df["source_date"] = df["source_date"].fillna(SEED_DATE)
        df["data_status"] = df["data_status"].fillna("estimate")
    df, _ = coerce_frame(df, entity)
    df = enrich(df, entity)
    df[SOURCE_COL] = PLACEHOLDER
    return df
