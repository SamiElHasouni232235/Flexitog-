"""Placeholder master data so the tool runs before real data is imported.

All names are generic. Every row is tagged data_source=placeholder.
Replace by importing real files on the Import page.
"""
from __future__ import annotations

import pandas as pd

from .schema import ENTITIES, PLACEHOLDER, SOURCE_COL
from .importer import coerce_frame, enrich


SUPPLIERS = [
    {"supplier_id": "SUP-PK1", "name": "Placeholder Supplier Pakistan", "country": "PK", "city": "Sialkot",
     "sku_ids": "FT-GLV-100;FT-GLV-200", "lead_time_days": 75, "incoterm": "FOB", "currency": "USD"},
    {"supplier_id": "SUP-CN1", "name": "Placeholder Supplier China", "country": "CN", "city": "Ningbo",
     "sku_ids": "FT-JKT-100;FT-JKT-200;FT-TRS-100", "lead_time_days": 90, "incoterm": "FOB", "currency": "USD"},
    {"supplier_id": "SUP-BD1", "name": "Placeholder Supplier Bangladesh", "country": "BD", "city": "Dhaka",
     "sku_ids": "FT-OVR-100;FT-BAL-100", "lead_time_days": 95, "incoterm": "FOB", "currency": "USD"},
    {"supplier_id": "SUP-PT1", "name": "Placeholder Supplier Portugal", "country": "PT", "city": "Porto",
     "sku_ids": "FT-BOT-100", "lead_time_days": 21, "incoterm": "DAP", "currency": "EUR"},
]

DCS = [
    {"dc_id": "HLM", "name": "Helmond EU hub", "dc_type": "helmond_hub", "status": "existing",
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
    {"dc_id": "3PL-JAFZ", "name": "3PL Jebel Ali Free Zone", "dc_type": "3pl", "status": "candidate",
     "country": "AE", "city": "Dubai", "port_of_entry": "Jebel Ali",
     "serves_countries": "AE;SA;QA;KW;BH;OM", "notes": "Duty-suspended storage, re-export to GCC"},
    {"dc_id": "3PL-IST", "name": "3PL Istanbul", "dc_type": "3pl", "status": "candidate",
     "country": "TR", "city": "Istanbul", "port_of_entry": "Istanbul (Kapıkule)", "serves_countries": "TR"},
    {"dc_id": "3PL-TNG", "name": "3PL Tanger Med", "dc_type": "3pl", "status": "candidate",
     "country": "MA", "city": "Tangier", "port_of_entry": "Tanger Med (ferry)",
     "serves_countries": "MA;TN;EG;DZ", "notes": "Free zone, onward short sea"},
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
    {"sku": "FT-JKT-100", "description": "Freezer jacket -50°C", "product_family": "Jackets",
     "unit_weight_kg": 2.1, "length_cm": 60, "width_cm": 40, "height_cm": 12, "unit_price_eur": 139,
     "hs_code": "6201.40", "country_of_origin": "CN", "units_per_pallet": 120, "requires_conformity_cert": True},
    {"sku": "FT-JKT-200", "description": "Chillroom jacket -20°C", "product_family": "Jackets",
     "unit_weight_kg": 1.5, "length_cm": 55, "width_cm": 38, "height_cm": 10, "unit_price_eur": 89,
     "hs_code": "6201.40", "country_of_origin": "CN", "units_per_pallet": 160, "requires_conformity_cert": True},
    {"sku": "FT-TRS-100", "description": "Freezer bib trousers -50°C", "product_family": "Trousers",
     "unit_weight_kg": 1.8, "length_cm": 55, "width_cm": 40, "height_cm": 10, "unit_price_eur": 119,
     "hs_code": "6203.43", "country_of_origin": "CN", "units_per_pallet": 140, "requires_conformity_cert": True},
    {"sku": "FT-OVR-100", "description": "Freezer coverall -50°C", "product_family": "Coveralls",
     "unit_weight_kg": 3.2, "length_cm": 65, "width_cm": 45, "height_cm": 15, "unit_price_eur": 199,
     "hs_code": "6201.40", "country_of_origin": "BD", "units_per_pallet": 80, "requires_conformity_cert": True},
    {"sku": "FT-BAL-100", "description": "Thermal balaclava", "product_family": "Headwear",
     "unit_weight_kg": 0.1, "length_cm": 25, "width_cm": 20, "height_cm": 3, "unit_price_eur": 14,
     "hs_code": "6505.00", "country_of_origin": "BD", "units_per_pallet": 2000, "requires_conformity_cert": False},
    {"sku": "FT-GLV-100", "description": "Insulated freezer gloves", "product_family": "Gloves",
     "unit_weight_kg": 0.25, "length_cm": 30, "width_cm": 15, "height_cm": 5, "unit_price_eur": 24,
     "hs_code": "6116.10", "country_of_origin": "PK", "units_per_pallet": 1200, "requires_conformity_cert": True},
    {"sku": "FT-GLV-200", "description": "Cut-resistant liner gloves", "product_family": "Gloves",
     "unit_weight_kg": 0.08, "length_cm": 25, "width_cm": 12, "height_cm": 2, "unit_price_eur": 9,
     "hs_code": "6116.10", "country_of_origin": "PK", "units_per_pallet": 3000, "requires_conformity_cert": True},
    {"sku": "FT-BOT-100", "description": "Insulated safety boots S3", "product_family": "Footwear",
     "unit_weight_kg": 1.9, "length_cm": 35, "width_cm": 25, "height_cm": 15, "unit_price_eur": 129,
     "hs_code": "6403.40", "country_of_origin": "PT", "units_per_pallet": 150, "requires_conformity_cert": True},
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
]

ORDERS = [
    {"order_id": "T-SA-001", "customer_id": "C-SA-01", "pallet_count": 2, "pallet_type": "EUR",
     "batch": "sample", "notes": "Sample test order"},
    {"order_id": "T-TR-001", "customer_id": "C-TR-01", "pallet_count": 1, "pallet_type": "EUR",
     "batch": "sample", "notes": "Sample test order"},
]

ORDER_LINES = [
    {"order_id": "T-SA-001", "sku": "FT-JKT-100", "quantity": 120},
    {"order_id": "T-SA-001", "sku": "FT-GLV-100", "quantity": 300},
    {"order_id": "T-TR-001", "sku": "FT-TRS-100", "quantity": 60},
    {"order_id": "T-TR-001", "sku": "FT-BAL-100", "quantity": 200},
]

SEED = {
    "suppliers": SUPPLIERS,
    "distribution_centers": DCS,
    "customers": CUSTOMERS,
    "products": PRODUCTS,
    "lanes": LANES,
    "orders": ORDERS,
    "order_lines": ORDER_LINES,
    "sales_history": [],
    "demand_forecast": [],
}


def seed_frame(key: str) -> pd.DataFrame:
    entity = ENTITIES[key]
    rows = SEED.get(key, [])
    df = pd.DataFrame(rows, columns=entity.field_names()) if not rows else pd.DataFrame(rows)
    for name in entity.field_names():
        if name not in df.columns:
            df[name] = None
    df = df[entity.field_names()]
    df, _ = coerce_frame(df, entity)
    df = enrich(df, entity)
    df[SOURCE_COL] = PLACEHOLDER
    return df
