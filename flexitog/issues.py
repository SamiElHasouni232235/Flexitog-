"""Regional issues shown on the dashboard map.

Briefing notes from general trade knowledge (2024-2026). They are placeholders to verify with
the customs broker and forwarder before use. Severity: critical, serious, warning, info.
The dashboard adds computed issues on top (coverage gaps, high duty, long lead times).
"""
from __future__ import annotations

ISSUES = [
    {"id": "red-sea", "title": "Red Sea diversions", "severity": "serious", "lat": 13.5, "lon": 42.6,
     "countries": ["SA", "AE", "QA", "KW", "BH", "OM"],
     "detail": "Since late 2023 most carriers route Asia/Europe-Gulf services around the Cape of Good Hope. "
               "Gulf transit times in the freight table assume this (+10-14 days) and carry war-risk surcharges.",
     "lever": "What-if: Red Sea reopens"},
    {"id": "saber", "title": "SABER / SASO conformity", "severity": "warning", "lat": 24.7, "lon": 46.7,
     "countries": ["SA"],
     "detail": "Regulated products need a Product Certificate (PCoC) per model and a Shipment Certificate per "
               "shipment on the SABER platform. Missing certificates stop clearance.",
     "lever": "Compliance costs, SKU conformity flag"},
    {"id": "egypt-aci", "title": "Egypt ACI and GOEIC registration", "severity": "serious", "lat": 30.0, "lon": 31.2,
     "countries": ["EG"],
     "detail": "Advance Cargo Information (Nafeza/CargoX) is mandatory before loading. Apparel falls under "
               "Decree 43/2016 manufacturer registration. FX availability can delay importer payment.",
     "lever": "Compliance costs, clearance days"},
    {"id": "algeria", "title": "Algeria import restrictions", "severity": "critical", "lat": 36.7, "lon": 3.1,
     "countries": ["DZ"],
     "detail": "Import licensing, bank domiciliation and changing product restrictions. Long port dwell times. "
               "Treat any Algerian volume as high risk.",
     "lever": "Clearance days, compliance costs"},
    {"id": "turkey-acd", "title": "Türkiye additional duties", "severity": "serious", "lat": 41.0, "lon": 29.0,
     "countries": ["TR"],
     "detail": "The customs union removes duty on goods in EU free circulation (A.TR), but Türkiye levies "
               "additional customs duties on many apparel lines of Asian origin. Origin per SKU drives the rate.",
     "lever": "What-if: all SKUs EU-made"},
    {"id": "morocco-origin", "title": "Morocco origin rules", "severity": "warning", "lat": 33.6, "lon": -7.6,
     "countries": ["MA"],
     "detail": "0% duty needs EU preferential origin with EUR.1 or origin declaration. Non-EU-made apparel "
               "pays up to 40%. Tanger Med free zone suits a regional stock point.",
     "lever": "What-if: all SKUs EU-made"},
    {"id": "gcc-borders", "title": "GCC land border queues", "severity": "warning", "lat": 24.1, "lon": 51.6,
     "countries": ["SA", "QA"],
     "detail": "Trucks from Jebel Ali to Saudi Arabia cross at Al Ghuwaifat/Batha, with queues of one to three "
               "days in peak periods. Saudi clearance runs through FASAH.",
     "lever": "Regional freight transit days"},
    {"id": "legalisation", "title": "Document legalisation", "severity": "info", "lat": 27.5, "lon": 49.5,
     "countries": ["SA", "QA", "KW", "BH", "OM", "AE"],
     "detail": "Commercial invoice and certificate of origin need chamber and embassy (or e-) legalisation in "
               "most GCC states. Fees scale with invoice value in the UAE.",
     "lever": "Compliance costs"},
    {"id": "libya", "title": "Libya outside scope", "severity": "info", "lat": 31.0, "lon": 16.0,
     "countries": ["LY"],
     "detail": "No EU agreement in force and an unstable security situation. Not part of the three study regions.",
     "lever": ""},
]
