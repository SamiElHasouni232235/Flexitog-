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
}

DC_TYPES = ["helmond_hub", "distributor", "3pl", "owned_warehouse"]
DC_TYPE_LABELS = {
    "helmond_hub": "Helmond EU hub",
    "distributor": "Distributor-held stock",
    "3pl": "3PL presence",
    "owned_warehouse": "Owned non-EU warehouse",
}
DC_STATUS = ["existing", "potential", "candidate"]
LANE_STATUS = ["proven", "occasional", "unproven"]
MODES = ["road", "sea", "air", "multimodal"]


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
            Field("sku_ids", dtype="list", required=True,
                  description="SKUs this supplier delivers, separated by ; or ,",
                  aliases=["skus", "articles", "items", "products", "artikelen"]),
            Field("lead_time_days", dtype="float", required=True,
                  description="Production + transport lead time to Helmond, in days",
                  aliases=["leadtime", "leadtimedays", "lt", "levertijd"]),
            Field("incoterm", aliases=["incoterms", "deliveryterms"]),
            Field("currency", aliases=["cur", "valuta"]),
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
            Field("city", required=True, aliases=["town", "shiptocity", "plaats", "stad"]),
            Field("postal_code", aliases=["zip", "zipcode", "postcode", "postalcode", "shiptozip"]),
            Field("address", aliases=["street", "address1", "addressline1", "adres"]),
            Field("current_incoterm", description="Incoterm the customer buys on today",
                  aliases=["incoterm", "incoterms", "deliveryterms"]),
            Field("destination_port", description="Port the customer takes over at (CIF baseline)",
                  aliases=["port", "pod", "portofdischarge"]),
            Field("current_dc_id", description="Distributor/3PL currently serving this customer, if any",
                  aliases=["distributor", "distributorid", "servedby"]),
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
            Field("description", required=True,
                  aliases=["name", "productname", "itemname", "itemdescription", "omschrijving", "desc"]),
            Field("product_family", aliases=["category", "family", "productgroup", "group", "artikelgroep"]),
            Field("unit_weight_kg", dtype="float", required=True,
                  aliases=["weight", "weightkg", "grossweight", "grossweightkg", "netweight", "gewicht", "kg"]),
            Field("length_cm", dtype="float", aliases=["length", "lengte", "l"]),
            Field("width_cm", dtype="float", aliases=["width", "breedte", "w"]),
            Field("height_cm", dtype="float", aliases=["height", "hoogte", "h"]),
            Field("unit_price_eur", dtype="float", required=True,
                  aliases=["price", "unitprice", "listprice", "priceeur", "salesprice", "prijs", "exportprice"]),
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
            Field("mode", required=True, allowed=MODES, aliases=["transportmode", "modality"]),
            Field("status", required=True, allowed=LANE_STATUS, aliases=["lanestatus", "maturity"]),
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
}

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
