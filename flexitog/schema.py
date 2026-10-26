"""Entity schemas for the FlexiTog route simulator.

Each entity is a list of Field definitions. The importer uses the aliases to
guess which uploaded column maps to which field. Users can extend any entity
with custom fields (stored in the workspace, see store.py).
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict

# Provenance column added to every entity table.
SOURCE_COL = "data_source"
PLACEHOLDER = "placeholder"
MANUAL = "manual"
IMPORTED_PREFIX = "imported:"

DTYPES = ("str", "float", "int", "date", "bool", "list")


@dataclass
class Field:
    name: str
    dtype: str = "str"
    required: bool = False
    description: str = ""
    aliases: list[str] = field(default_factory=list)
    allowed: list[str] | None = None
    custom: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Entity:
    key: str
    label: str
    primary_key: list[str]
    fields: list[Field]
    description: str = ""
    importable: bool = True

    def field_names(self) -> list[str]:
        return [f.name for f in self.fields]

    def get(self, name: str) -> Field | None:
        return next((f for f in self.fields if f.name == name), None)

    def required_fields(self) -> list[str]:
        return [f.name for f in self.fields if f.required]


# Regions in scope. Everything outside these maps to "Other".
REGIONS = ["Türkiye", "North Africa", "Gulf/GCC", "Middle East (other)"]

COUNTRY_REGION = {
    "TR": "Türkiye",
    "MA": "North Africa", "DZ": "North Africa", "TN": "North Africa",
    "EG": "North Africa", "LY": "North Africa",
    "SA": "Gulf/GCC", "AE": "Gulf/GCC", "QA": "Gulf/GCC", "KW": "Gulf/GCC",
    "BH": "Gulf/GCC", "OM": "Gulf/GCC",
    "JO": "Middle East (other)", "LB": "Middle East (other)",
    "IQ": "Middle East (other)", "IL": "Middle East (other)",
    "NL": "EU",
}

COUNTRY_NAMES = {
    "TR": "Türkiye", "MA": "Morocco", "DZ": "Algeria", "TN": "Tunisia",
    "EG": "Egypt", "LY": "Libya", "SA": "Saudi Arabia",
    "AE": "United Arab Emirates", "QA": "Qatar", "KW": "Kuwait",
    "BH": "Bahrain", "OM": "Oman", "JO": "Jordan", "LB": "Lebanon",
    "IQ": "Iraq", "IL": "Israel", "NL": "Netherlands",
    # sourcing countries
    "CN": "China", "BD": "Bangladesh", "RS": "Serbia", "AL": "Albania", "PK": "Pakistan", "IN": "India",
    "VN": "Vietnam", "PT": "Portugal",
}

# Extra spellings seen in real exports. Keys are normalised (lowercase, no
# punctuation or spaces).
COUNTRY_ALIASES = {
    "turkey": "TR", "turkiye": "TR", "türkiye": "TR", "tur": "TR",
    "morocco": "MA", "maroc": "MA", "mar": "MA",
    "algeria": "DZ", "algerie": "DZ", "dza": "DZ",
    "tunisia": "TN", "tunisie": "TN", "tun": "TN",
    "egypt": "EG", "egy": "EG", "arabrepublicofegypt": "EG",
    "libya": "LY", "lby": "LY",
    "saudiarabia": "SA", "ksa": "SA", "kingdomofsaudiarabia": "SA", "sau": "SA",
    "unitedarabemirates": "AE", "uae": "AE", "are": "AE", "emirates": "AE",
    "qatar": "QA", "qat": "QA",
    "kuwait": "KW", "kwt": "KW",
    "bahrain": "BH", "bhr": "BH",
    "oman": "OM", "omn": "OM",
    "jordan": "JO", "jor": "JO",
    "lebanon": "LB", "lbn": "LB",
    "iraq": "IQ", "irq": "IQ",
    "israel": "IL", "isr": "IL",
    "netherlands": "NL", "nederland": "NL", "holland": "NL", "nld": "NL",
    "thenetherlands": "NL",
    "china": "CN", "prc": "CN", "chn": "CN", "peoplesrepublicofchina": "CN",
    "bangladesh": "BD", "bgd": "BD",
    "serbia": "RS", "srb": "RS", "srbija": "RS",
    "albania": "AL", "alb": "AL", "shqiperia": "AL", "albanie": "AL", "albanië": "AL",
    "pakistan": "PK", "pak": "PK", "india": "IN", "ind": "IN", "vietnam": "VN", "vnm": "VN",
    "portugal": "PT", "prt": "PT",
}

EU27 = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
        "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"}

DC_TYPES = ["helmond_hub", "distributor", "3pl", "owned_warehouse", "freight_forwarder"]
PROVIDER_TYPES = ["3PL", "Freight forwarder", "Own hub"]
DC_TYPE_LABELS = {
    "helmond_hub": "Helmond EU hub",
    "distributor": "Distributor-held stock",
    "3pl": "3PL presence",
    "owned_warehouse": "Owned non-EU warehouse",
    "freight_forwarder": "Freight forwarder (no stock, not routed by the engine)",
}
DC_STATUS = ["existing", "potential", "candidate"]
LANE_STATUS = ["proven", "occasional", "unproven"]
MODES = ["road", "sea", "air", "multimodal"]
LANE_MODES = ["road", "sea", "air", "express", "multimodal"]
GARMENT_CATEGORIES = ["Jackets", "Trousers", "Coveralls", "Other"]
PREFERENCE_CERTS = ["EUR.1", "ATR", "none"]
RATE_UNITS = ["per kg", "per m3", "per shipment"]
QUOTE_CURRENCIES = ["EUR", "USD"]
STUDY_REGIONS = ["Türkiye", "North Africa", "Gulf/GCC"]

# Provenance: every row says where its values come from, when, and whether they are confirmed.
# (data_source above stays the technical origin: placeholder, imported:<file>, manual, history.)
DATA_STATUS = ["confirmed", "estimate"]


def provenance_fields() -> list["Field"]:
    return [
        Field("source_ref", description="Where the values come from: a document, quote, person or file",
              aliases=["source", "sourceref", "bron"]),
        Field("source_date", dtype="date", description="Date of the source", aliases=["sourcedate", "asof"]),
        Field("data_status", allowed=DATA_STATUS, description="confirmed or estimate. Blank = estimate",
              aliases=["status", "datastatus", "confidence"]),
    ]


ENTITIES: dict[str, Entity] = {
    "suppliers": Entity(
        key="suppliers",
        label="Suppliers",
        primary_key=["supplier_id"],
        description="Existing suppliers. Each supplier is tied to one or more SKUs.",
        fields=[
            Field("supplier_id", required=True, description="Unique supplier code",
                  aliases=["supplier", "suppliercode", "vendorid", "vendor", "vendorcode", "crediteur", "creditor"]),
            Field("name", required=True, description="Supplier name",
                  aliases=["suppliername", "vendorname", "naam"]),
            Field("country", required=True, description="Supplier country (ISO2)",
                  aliases=["suppliercountry", "origin", "countrycode", "land"]),
            Field("city", aliases=["town", "location", "plaats"]),
            Field("sku_ids", dtype="list",
                  description="SKUs this supplier delivers, separated by ; or ,",
                  aliases=["skus", "articles", "items", "products", "artikelen"]),
            Field("lead_time_days", dtype="float",
                  description="Production + transport lead time to Helmond, in days",
                  aliases=["leadtime", "leadtimedays", "lt", "levertijd"]),
            Field("incoterm", aliases=["incoterms", "deliveryterms"]),
            Field("currency", aliases=["cur", "valuta"]),
            Field("brands", description="Brands this supplier makes, separated by ;",
                  aliases=["brand", "merk", "merken", "label"]),
            Field("inbound_mode", allowed=MODES, description="Main transport mode to Helmond",
                  aliases=["mode", "transportmode", "inboundmode"]),
            Field("direct_to_partners", dtype="bool",
                  description="Can ship straight to a distributor, 3PL or owned warehouse. Blank = yes",
                  aliases=["directship", "dropship", "shipdirect", "direct"]),
            Field("latitude", dtype="float", description="Optional. For the dashboard map. Blank = city lookup",
                  aliases=["lat"]),
            Field("longitude", dtype="float", description="Optional. For the dashboard map. Blank = city lookup",
                  aliases=["lon", "lng", "long"]),
            Field("notes", aliases=["comment", "comments", "remarks", "opmerkingen"]),
        ],
    ),
    "distribution_centers": Entity(
        key="distribution_centers",
        label="Distribution centers",
        primary_key=["dc_id"],
        description=("Nodes goods can flow through: Helmond hub, distributor-held stock, "
                     "3PL presence, owned non-EU warehouse. DAP direct is out of scope."),
        fields=[
            Field("dc_id", required=True, description="Unique node code",
                  aliases=["id", "code", "nodeid", "warehouseid", "dccode"]),
            Field("name", required=True, aliases=["dcname", "warehousename", "partner", "partnername"]),
            Field("dc_type", required=True, allowed=DC_TYPES,
                  description="helmond_hub, distributor, 3pl or owned_warehouse",
                  aliases=["type", "nodetype", "model", "distributionmodel"]),
            Field("status", required=True, allowed=DC_STATUS,
                  description="existing, potential or candidate",
                  aliases=["state", "relationship"]),
            Field("country", required=True, description="Country where stock is held (ISO2)",
                  aliases=["countrycode", "land"]),
            Field("region", description="Derived from country when left empty"),
            Field("city", aliases=["location", "town"]),
            Field("port_of_entry", description="Port or border crossing used to reach this node",
                  aliases=["port", "pod", "portofdischarge", "entryport"]),
            Field("serves_countries", dtype="list",
                  description="Countries this node delivers to (ISO2, separated by ;)",
                  aliases=["servedcountries", "coverage", "markets"]),
            Field("min_order_value_eur", dtype="float",
                  description="Minimum order value this node accepts. Blank = use parameter default",
                  aliases=["mov", "minimumordervalue", "minorder"]),
            Field("margin_pct", dtype="float",
                  description="Distributor margin or discount off list price, %. Blank = scenario default",
                  aliases=["margin", "discount", "distributordiscount"]),
            Field("inbound_eur_per_pallet", dtype="float",
                  description="3PL/warehouse inbound handling rate. Blank = scenario default",
                  aliases=["inbound", "inboundrate", "receiving"]),
            Field("storage_eur_per_pallet_month", dtype="float",
                  description="3PL/warehouse storage rate. Blank = scenario default",
                  aliases=["storage", "storagerate"]),
            Field("outbound_eur_per_order", dtype="float",
                  description="3PL/warehouse pick and dispatch fee per order. Blank = scenario default",
                  aliases=["outbound", "outboundrate", "pickfee"]),
            # Logistics provider fields for Benchmarking (the RFQ workflow reads providers from this table).
            Field("provider_type", allowed=PROVIDER_TYPES,
                  description="3PL, Freight forwarder or Own hub. Rows with a type appear in Benchmarking. "
                              "Blank = from dc_type (helmond_hub = Own hub, 3pl = 3PL, freight_forwarder = Freight forwarder)",
                  aliases=["providertype", "lsptype"]),
            Field("contact_name", description="Contact person for the RFQ", aliases=["contact", "contactperson"]),
            Field("contact_email", description="Contact email for the RFQ", aliases=["email", "contactemail", "e-mail"]),
            Field("contact_phone", description="Contact phone, with country code", aliases=["phone", "telephone", "contactphone"]),
            Field("website", aliases=["web", "url", "site"]),
            # Service profile of forwarders and 3PLs (the logisticsProviders template).
            Field("customs_brokerage", dtype="bool", description="Handles import customs clearance", aliases=["customsbrokerage", "brokerage"]),
            Field("free_zone", dtype="bool", description="Operates in a free zone (duty suspended stock)", aliases=["freezone"]),
            Field("warehousing", dtype="bool", description="Offers warehousing", aliases=["warehouse", "storageservice"]),
            Field("compliance_support", dtype="bool", description="Supports certificates and compliance (SABER, CoO)",
                  aliases=["compliancesupport", "compliance"]),
            Field("handoffs_per_shipment", dtype="int", description="Parties touching one shipment",
                  aliases=["handoffspershipment", "handoffs"]),
            Field("documents_per_shipment", dtype="int", description="Documents FlexiTog prepares per shipment",
                  aliases=["documentspershipment", "documents"]),
            Field("latitude", dtype="float", description="Optional. For the dashboard map", aliases=["lat"]),
            Field("longitude", dtype="float", description="Optional. For the dashboard map",
                  aliases=["lon", "lng", "long"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "customers": Entity(
        key="customers",
        label="Customers",
        primary_key=["customer_id"],
        description="Customers with location detail so orders map to a precise destination.",
        fields=[
            Field("customer_id", required=True,
                  aliases=["customer", "customerno", "customernumber", "custid", "debtor", "debiteur",
                           "debiteurnummer", "accountno", "account", "clientid", "soldto"]),
            Field("name", required=True,
                  aliases=["customername", "company", "companyname", "client", "clientname", "naam", "accountname"]),
            Field("country", required=True, description="ISO2 code or country name",
                  aliases=["countrycode", "land", "shiptocountry", "destinationcountry"]),
            Field("region", description="Derived from country when left empty",
                  aliases=["salesregion", "market", "area"]),
            Field("city", aliases=["town", "shiptocity", "plaats", "stad"]),
            Field("segment", description="Customer segment, e.g. cold store, food processing, logistics",
                  aliases=["segment", "sector", "industry", "branche"]),
            Field("postal_code", aliases=["zip", "zipcode", "postcode", "postalcode", "shiptozip"]),
            Field("address", aliases=["street", "address1", "addressline1", "adres"]),
            Field("current_incoterm", description="Incoterm the customer buys on today",
                  aliases=["incoterm", "incoterms", "deliveryterms"]),
            Field("destination_port", description="Port the customer takes over at (CIF baseline)",
                  aliases=["port", "pod", "portofdischarge"]),
            Field("current_dc_id", description="Distributor/3PL currently serving this customer, if any",
                  aliases=["distributor", "distributorid", "servedby"]),
            Field("latitude", dtype="float", description="Optional. For the dashboard map. Blank = city lookup",
                  aliases=["lat"]),
            Field("longitude", dtype="float", description="Optional. For the dashboard map. Blank = city lookup",
                  aliases=["lon", "lng", "long"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "products": Entity(
        key="products",
        label="Products / SKUs",
        primary_key=["sku"],
        description="Full-catalogue capable SKU master. Weight, dimensions and price drive freight and duty.",
        fields=[
            Field("sku", required=True,
                  aliases=["skuid", "item", "itemno", "itemnumber", "itemcode", "article", "articlenumber",
                           "artikelnummer", "artnr", "material", "materialnumber", "partnumber", "productcode"]),
            Field("description",
                  aliases=["name", "productname", "itemname", "itemdescription", "omschrijving", "desc"]),
            Field("brand", description="Brand, e.g. FlexiTog, RefrigiWear, Gold Freeze",
                  aliases=["merk", "label", "brandname", "make"]),
            Field("category", allowed=GARMENT_CATEGORIES,
                  description="Garment category for landed cost: Jackets, Trousers, Coveralls or Other",
                  aliases=["garmentcategory", "category"]),
            Field("product_family", aliases=["family", "productgroup", "group", "artikelgroep"]),
            Field("unit_weight_kg", dtype="float", required=True,
                  aliases=["weight", "weightkg", "grossweight", "grossweightkg", "netweight", "gewicht", "kg"]),
            Field("length_cm", dtype="float", aliases=["length", "lengte", "l"]),
            Field("width_cm", dtype="float", aliases=["width", "breedte", "w"]),
            Field("height_cm", dtype="float", aliases=["height", "hoogte", "h"]),
            Field("unit_price_eur", dtype="float", required=True, description="EXW price per unit, EUR",
                  aliases=["price", "unitprice", "listprice", "priceeur", "salesprice", "prijs", "exportprice", "exwpriceeur"]),
            Field("carton_l_cm", dtype="float", description="Export carton length, cm", aliases=["cartonlcm", "cartonlength"]),
            Field("carton_w_cm", dtype="float", description="Export carton width, cm", aliases=["cartonwcm", "cartonwidth"]),
            Field("carton_h_cm", dtype="float", description="Export carton height, cm", aliases=["cartonhcm", "cartonheight"]),
            Field("units_per_carton", dtype="float", description="Garments per export carton",
                  aliases=["unitspercarton", "qtypercarton", "percarton"]),
            Field("hs_code", description="Customs tariff code. Drives duty rate",
                  aliases=["hs", "hscode", "tariffcode", "taric", "cn8", "commoditycode", "goederencode"]),
            Field("country_of_origin", description="Manufacturing origin (ISO2). Decides EU-preferential duty",
                  aliases=["origin", "coo", "countryoforigin", "madein"]),
            Field("units_per_pallet", dtype="float",
                  description="Units on one full pallet. Used to suggest pallet count",
                  aliases=["palletqty", "qtyperpallet", "unitsperpallet", "perpallet"]),
            Field("requires_conformity_cert", dtype="bool",
                  description="SKU needs a product conformity certificate (e.g. SASO/SABER PCoC)",
                  aliases=["saso", "saber", "certificationrequired", "pcoc"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "lanes": Entity(
        key="lanes",
        label="Lanes (existing routes)",
        primary_key=["lane_id"],
        description=("Routes already in use. The engine favours proven lanes over unproven ones. "
                     "Origin/destination are supplier, DC or customer ids, or ISO2 country codes."),
        fields=[
            Field("lane_id", required=True, aliases=["id", "route", "routeid"]),
            Field("origin_id", required=True, aliases=["origin", "from", "van"]),
            Field("destination_id", required=True, aliases=["destination", "to", "naar", "dest"]),
            Field("mode", required=True, allowed=LANE_MODES, aliases=["transportmode", "modality"]),
            Field("status", allowed=LANE_STATUS, description="proven, occasional or unproven. Blank = unproven",
                  aliases=["lanestatus", "maturity"]),
            Field("shipments_last_12m", dtype="int", aliases=["shipments", "loads", "volume12m"]),
            Field("on_time_pct", dtype="float", aliases=["otd", "ontime", "otif"]),
            Field("transit_days", dtype="float", aliases=["transit", "transittime", "days"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "sales_history": Entity(
        key="sales_history",
        label="Sales history",
        primary_key=["order_id", "sku"],
        description="Past order lines. Used to spot proven lanes and to build representative test batches.",
        fields=[
            Field("order_id", required=True,
                  aliases=["orderno", "ordernumber", "salesorder", "so", "invoiceno", "invoice", "documentno",
                           "ordernummer", "factuurnummer"]),
            Field("order_date", dtype="date", required=True,
                  aliases=["date", "orderdate", "invoicedate", "shipdate", "datum", "documentdate"]),
            Field("customer_id", required=True,
                  aliases=["customer", "customerno", "custid", "debtor", "debiteur", "account", "soldto"]),
            Field("sku", required=True,
                  aliases=["item", "itemno", "itemcode", "article", "artikelnummer", "material", "productcode"]),
            Field("quantity", dtype="float", required=True, aliases=["qty", "units", "aantal", "quantityshipped"]),
            Field("net_value_eur", dtype="float",
                  aliases=["value", "netvalue", "amount", "revenue", "sales", "netamount", "omzet", "lineamount"]),
            Field("country", aliases=["shiptocountry", "destinationcountry", "land"]),
            Field("shipped_via", description="DC id or route used", aliases=["via", "dc", "warehouse", "route"]),
            Field("incoterm", aliases=["incoterms", "deliveryterms"]),
            Field("pallets", dtype="float", aliases=["pallet", "palletcount", "noofpallets"]),
        ],
    ),
    "demand_forecast": Entity(
        key="demand_forecast",
        label="Demand forecast",
        primary_key=["period", "sku", "country", "customer_id"],
        description="Forecast quantity per period. Customer is optional; country is enough.",
        fields=[
            Field("period", dtype="date", required=True, description="First day of the forecast month",
                  aliases=["month", "date", "forecastmonth", "periode", "week", "forecastdate"]),
            Field("sku", required=True, aliases=["item", "itemno", "itemcode", "article", "productcode"]),
            Field("country", aliases=["market", "land", "destinationcountry"]),
            Field("customer_id", aliases=["customer", "customerno", "debtor", "account"]),
            Field("region", description="Derived from country when left empty"),
            Field("forecast_qty", dtype="float", required=True,
                  aliases=["forecast", "qty", "quantity", "units", "demand", "fcst"]),
        ],
    ),
    "orders": Entity(
        key="orders",
        label="Test orders",
        primary_key=["order_id"],
        importable=True,
        description="Test orders for the simulator. Pallet count is required: it drives freight and customs cost.",
        fields=[
            Field("order_id", required=True, aliases=["orderno", "ordernumber", "id"]),
            Field("customer_id", required=True, aliases=["customer", "customerno"]),
            Field("supplier_id", description="Optional. Blank = stock already in Helmond",
                  aliases=["supplier", "vendor"]),
            Field("dc_override", description="Blank = let the engine recommend. Otherwise a dc_id",
                  aliases=["dc", "forceddc", "route"]),
            Field("pallet_count", dtype="float", required=True, aliases=["pallets", "palletqty", "noofpallets"]),
            Field("pallet_type", allowed=["EUR", "industrial", "custom"], aliases=["pallettype"]),
            Field("order_date", dtype="date", aliases=["date"]),
            Field("batch", description="Batch label, e.g. a region test set", aliases=["testset", "set"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "order_lines": Entity(
        key="order_lines",
        label="Test order lines",
        primary_key=["order_id", "sku"],
        description="SKU lines of each test order.",
        fields=[
            Field("order_id", required=True, aliases=["orderno", "ordernumber"]),
            Field("sku", required=True, aliases=["item", "itemno", "article"]),
            Field("quantity", dtype="float", required=True, aliases=["qty", "units"]),
        ],
    ),
    "countries": Entity(
        key="countries",
        label="Countries",
        primary_key=["country"],
        description=("Import cost facts per destination country. The single source for duty, VAT and clearance. "
                     "Rows with target = true are the study's target countries."),
        fields=[
            Field("country", required=True, description="ISO2 code or country name", aliases=["name", "code", "iso2"]),
            Field("target", dtype="bool", description="A target country of the study. Blank = yes", aliases=["targetcountry"]),
            Field("region", allowed=STUDY_REGIONS, description="Türkiye, North Africa or Gulf/GCC. Blank = built-in region"),
            Field("duty_rate_pct", dtype="float", required=True,
                  description="Import duty you pay, % of CIF, with the preference certificate where one applies",
                  aliases=["dutyrate", "duty"]),
            Field("standard_duty_rate_pct", dtype="float",
                  description="Duty without preference (non-EU origin goods), % of CIF. Blank = duty_rate_pct",
                  aliases=["standarddutyrate", "mfn"]),
            Field("preference_cert", allowed=PREFERENCE_CERTS, required=True, description="EUR.1, ATR or none",
                  aliases=["preferencecert", "preference"]),
            Field("vat_rate_pct", dtype="float", required=True, description="Import VAT, %", aliases=["vatrate", "vat"]),
            Field("other_fees_pct", dtype="float", description="Other import levies, % of CIF", aliases=["otherfeespct"]),
            Field("clearance_fee_eur", dtype="float", required=True, description="Customs clearance fee per shipment, EUR",
                  aliases=["clearancefeeeur", "clearancefee"]),
            Field("compliance_cost_eur", dtype="float", required=True,
                  description="Yearly compliance cost (certificates, registrations), EUR", aliases=["compliancecosteur"]),
            Field("expected_yearly_units", dtype="float", required=True,
                  description="Garments expected per year, spreads the compliance cost", aliases=["expectedyearlyunits"]),
        ],
    ),
    "quotes": Entity(
        key="quotes",
        label="Freight quotes",
        primary_key=["quote_id"],
        description="Freight quotes per provider and lane. Rates in the quote currency, surcharges per shipment.",
        fields=[
            Field("quote_id", required=True, description="Unique quote code", aliases=["id", "quoteid"]),
            Field("provider_id", required=True, description="dc_id of the provider in Logistics providers",
                  aliases=["provider", "providerid"]),
            Field("lane_id", required=True, description="lane_id in Lanes", aliases=["laneid", "lane"]),
            Field("quote_date", dtype="date", required=True, aliases=["quotedate", "date"]),
            Field("valid_until", dtype="date", description="Blank = no end date", aliases=["validuntil", "expiry"]),
            Field("base_rate", dtype="float", required=True, description="Rate per rate unit, quote currency",
                  aliases=["baserate", "rate"]),
            Field("rate_unit", required=True, allowed=RATE_UNITS, aliases=["rateunit", "unit"]),
            Field("min_charge", dtype="float", description="Minimum freight charge per shipment", aliases=["mincharge", "minimum"]),
            Field("weight_from_kg", dtype="float", description="Weight band start, chargeable kg. Blank = any",
                  aliases=["weightfromkg"]),
            Field("weight_to_kg", dtype="float", description="Weight band end, chargeable kg. Blank = any", aliases=["weighttokg"]),
            Field("fuel_surcharge", dtype="float", description="Per shipment, quote currency", aliases=["fuelsurcharge", "fuel"]),
            Field("peak_surcharge", dtype="float", description="Per shipment, quote currency", aliases=["peaksurcharge", "peak"]),
            Field("war_risk_surcharge", dtype="float", description="Per shipment, quote currency",
                  aliases=["warrisksurcharge", "warrisk"]),
            Field("other_surcharge", dtype="float", description="Documents and other fees per shipment, quote currency",
                  aliases=["othersurcharge", "otherfees"]),
            Field("currency", required=True, allowed=QUOTE_CURRENCIES, aliases=["cur", "valuta"]),
            Field("transit_days", dtype="float", description="Door to door, days", aliases=["transitdaysdoortodoor", "transit"]),
            Field("notes", aliases=["comment", "remarks"]),
        ],
    ),
    "settings": Entity(
        key="settings",
        label="Settings",
        primary_key=["settings_id"],
        description="One row with the rates every calculation shares.",
        fields=[
            Field("settings_id", required=True, description="Always 'main'"),
            Field("eur_usd_rate", dtype="float", required=True, description="USD per 1 EUR", aliases=["eurusdrate"]),
            Field("eur_usd_date", dtype="date", required=True, description="Date of the exchange rate", aliases=["eurusddate"]),
            Field("insurance_rate_pct", dtype="float", required=True, description="Cargo insurance, % of EXW + freight",
                  aliases=["insurancerate"]),
            Field("margin_pct", dtype="float", required=True, description="FlexiTog margin on landed cost, %",
                  aliases=["marginpct"]),
            Field("shipment_units", dtype="float", required=True, description="Garments per shipment for landed cost",
                  aliases=["shipmentunits"]),
        ],
    ),
}

# Every table carries the provenance columns.
for _e in ENTITIES.values():
    _e.fields.extend(provenance_fields())

# Import targets the user asked for first, shown on top in the UI.
PRIMARY_IMPORTS = ["customers", "products", "sales_history", "demand_forecast"]


def normalise(text: str) -> str:
    """Lowercase and strip everything except letters and digits."""
    return "".join(ch for ch in str(text).lower() if ch.isalnum())


def to_iso2(value) -> str | None:
    """Map a country name or code to ISO2. Unknown values are returned upper-cased."""
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in ("nan", "none"):
        return None
    if text.upper() in COUNTRY_NAMES:
        return text.upper()
    key = normalise(text)
    if key in COUNTRY_ALIASES:
        return COUNTRY_ALIASES[key]
    for code, name in COUNTRY_NAMES.items():
        if normalise(name) == key:
            return code
    return text.upper()


def region_for(country: str | None) -> str:
    if not country:
        return "Other"
    return COUNTRY_REGION.get(country, "Other")
