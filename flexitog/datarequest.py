"""Datasets the simulator needs from the company, in priority order.

Shared by the Excel request pack (tools/build_request_pack.py) and the HTML report.
"""

# (sheet, kind, key, priority, why, where to get it, where it goes in the tool)
DATASETS = [
    ("Products", "entity", "products", "High",
     "Country of origin sets duty: EU-made enters Türkiye and North Africa at 0%, Asian-made pays 12-40%. "
     "Units per pallet drives pallet counts, freight and handling.",
     "ERP item master. HS codes from the customs team or broker. Origin from purchasing or supplier "
     "declarations.", "Import data > Products / SKUs"),
    ("Sales history", "entity", "sales_history", "High",
     "Builds the batch from real orders and proves which lanes run reliably. 24 months of order lines to "
     "Türkiye, North Africa and Gulf/GCC.",
     "ERP sales order or invoice line export. Add shipped_via (Helmond or the partner used) and pallets "
     "when the shipment log has them.", "Batch and scorecard > Sales history, or Import data"),
    ("Customers", "entity", "customers", "High",
     "Maps each order to a country, city and port. current_dc_id links customers already served by a "
     "distributor.", "CRM or ERP debtor master.", "Import data > Customers"),
    ("Freight rates", "param", "freight", "High",
     "Largest cost line in every scenario. Need single-shipment (groupage/LCL) and consolidated "
     "(FTL/FCL) rates, minimum charges and transit days.",
     "Forwarder quotes and invoices of the last 12 months. Logistics team.",
     "Parameters > Freight rates per leg (load file)"),
    ("Partners", "entity", "distribution_centers", "High",
     "Every distributor, 3PL and warehouse option with the countries it serves, its minimum order value, "
     "and its commercial terms (margin or discount, rate card). Status: existing, potential or candidate.",
     "Sales / commercial team contracts for distributors. RFQ answers from 3PLs.",
     "Import data > Distribution centers"),
    ("Duties", "param", "duties", "High",
     "Duty and VAT per country, split by EU-preferential and standard rate. Confirm per HS code for the "
     "main product families.",
     "Customs broker, EU Access2Markets / TARIC, destination tariff schedules.",
     "Parameters > Customs duty and VAT per country (load file)"),
    ("Compliance", "param", "compliance", "Medium",
     "Certificates and legalisation per country (SABER, embassy legalisation, Egypt ACI/GOEIC). Actual "
     "invoices replace the placeholder costs.",
     "Compliance or export team, past SABER and legalisation invoices, customs broker.",
     "Parameters > Compliance and certification costs (load file)"),
    ("Lanes", "entity", "lanes", "Medium",
     "Routes in use today, shipments in 12 months and on-time share. Proven lanes win the recommendation.",
     "Forwarder shipment reports, logistics team shipment log.", "Import data > Lanes"),
    ("Stock policy", "param", "scenarios", "Medium",
     "How many months of stock a regional node holds and how big a refill shipment is. Drives storage, "
     "capital cost and freight consolidation.", "Supply planning / S&OP.",
     "Parameters > Scenario defaults (load file)"),
    ("Helmond costs", "param", "general", "Medium",
     "Internal handling cost per pallet, export documents, insurance rate, cost of capital.",
     "Helmond warehouse manager and finance.", "Parameters > General (load file)"),
    ("Lead times", "param", "lead_times", "Low",
     "Order processing and clearance days per country.", "Logistics team, customs broker.",
     "Parameters > Lead time per non-transport step (load file)"),
    ("Owned warehouse", "param", "owned_fixed", "Low",
     "Fixed cost per year (lease, staff, local entity) and planned pallets per year for each candidate "
     "location.", "Finance, management, real estate quotes.",
     "Parameters > Owned warehouse fixed cost (load file)"),
    ("Suppliers", "entity", "suppliers", "Low",
     "Only needed to simulate orders that start at a supplier instead of Helmond stock.",
     "Purchasing.", "Import data > Suppliers"),
    ("Demand forecast", "entity", "demand_forecast", "Low",
     "Optional. Sizes regional stock for the 3PL and owned warehouse scenarios.", "S&OP / demand planning.",
     "Import data > Demand forecast"),
]

