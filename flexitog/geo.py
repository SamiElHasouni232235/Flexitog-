"""Coordinates for map drawing: cities, ports, border crossings and sea-lane waypoints.

Customers and DCs can carry their own latitude/longitude. Otherwise the city is looked up
here, then the country centroid is used.
"""
from __future__ import annotations

# (lat, lon)
CITIES = {
    "helmond": (51.48, 5.66), "rotterdam": (51.95, 4.13),
    "istanbul": (41.01, 28.98), "izmir": (38.42, 27.14), "ankara": (39.93, 32.86), "bursa": (40.19, 29.06),
    "mersin": (36.80, 34.64), "ambarlı": (40.97, 28.68), "ambarli": (40.97, 28.68), "kapıkule": (41.72, 26.36),
    "casablanca": (33.59, -7.62), "agadir": (30.43, -9.60), "tangier": (35.77, -5.80), "tanger med": (35.89, -5.50),
    "cairo": (30.04, 31.24), "alexandria": (31.20, 29.92), "algiers": (36.75, 3.06), "oran": (35.70, -0.63),
    "tunis": (36.81, 10.18), "sfax": (34.74, 10.76), "radès": (36.77, 10.28), "rades": (36.77, 10.28),
    "tripoli": (32.89, 13.19),
    "riyadh": (24.71, 46.68), "jeddah": (21.49, 39.19), "dammam": (26.43, 50.10),
    "dubai": (25.20, 55.27), "jebel ali": (25.01, 55.06), "abu dhabi": (24.45, 54.38),
    "doha": (25.29, 51.53), "hamad": (25.01, 51.60), "kuwait city": (29.38, 47.99), "shuwaikh": (29.35, 47.93),
    "manama": (26.23, 50.59), "khalifa bin salman": (26.20, 50.72), "muscat": (23.59, 58.41), "sohar": (24.50, 56.63),
    "amman": (31.95, 35.93), "beirut": (33.89, 35.50), "baghdad": (33.31, 44.36),
    # supplier cities
    "ningbo": (29.87, 121.55), "qingdao": (36.07, 120.38), "shanghai": (31.23, 121.47), "shenzhen": (22.54, 114.06),
    "chattogram": (22.34, 91.83), "chittagong": (22.34, 91.83), "dhaka": (23.81, 90.41),
    "leskovac": (43.00, 21.95), "belgrade": (44.79, 20.45), "beograd": (44.79, 20.45), "niš": (43.32, 21.90),
    "nis": (43.32, 21.90), "durrës": (41.32, 19.45), "durres": (41.32, 19.45), "tirana": (41.33, 19.82),
    "shkodër": (42.07, 19.51), "shkoder": (42.07, 19.51), "korçë": (40.62, 20.78), "korce": (40.62, 20.78),
    "sialkot": (32.49, 74.53), "karachi": (24.86, 67.01), "porto": (41.15, -8.61),
}

COUNTRY_CENTROIDS = {
    "NL": (52.1, 5.3), "TR": (39.0, 35.2), "MA": (31.8, -7.1), "DZ": (28.0, 2.6), "TN": (34.0, 9.5),
    "EG": (26.8, 30.8), "LY": (27.0, 17.2), "SA": (24.0, 45.0), "AE": (24.2, 54.4), "QA": (25.3, 51.2),
    "KW": (29.3, 47.6), "BH": (26.0, 50.55), "OM": (21.0, 57.0), "JO": (31.2, 36.5), "LB": (33.9, 35.9),
    "IQ": (33.0, 43.7), "IL": (31.0, 34.9),
    "CN": (31.0, 112.0), "BD": (23.7, 90.3), "RS": (44.0, 20.9), "AL": (41.1, 20.0), "PK": (30.0, 70.0),
    "IN": (22.0, 79.0), "VN": (16.0, 107.5), "PT": (39.6, -8.0),
}

# Sea and road waypoints. A lane is Helmond/Rotterdam -> chain -> destination.
WAYPOINTS = {
    "north_sea": [(51.95, 4.13), (51.0, 1.6), (49.9, -2.5), (48.6, -5.6)],
    "iberia": [(43.3, -9.9), (37.0, -9.3), (35.95, -5.6)],
    "west_med": [(36.8, -1.0), (37.6, 5.0)],
    "central_med": [(37.4, 11.3), (35.5, 18.0)],
    "east_med": [(34.2, 26.0), (32.2, 31.0)],
    "suez": [(31.3, 32.35), (29.9, 32.55)],
    "red_sea": [(27.0, 34.6), (21.5, 38.4)],
    "bab_el_mandeb": [(15.0, 41.8), (12.6, 43.4)],
    "arabian_sea": [(12.8, 48.5), (15.5, 54.5), (20.0, 59.2), (22.6, 59.9)],
    "hormuz": [(24.4, 58.0), (26.5, 56.6), (26.0, 54.8)],
    "balkans_road": [(51.48, 5.66), (50.1, 8.7), (48.2, 11.6), (48.2, 16.4), (47.5, 19.0), (44.8, 20.5), (42.7, 23.3)],
    "iberia_road": [(51.48, 5.66), (48.9, 2.35), (44.8, -0.6), (40.4, -3.7), (36.13, -5.45)],
    "aegean": [(38.0, 24.5), (40.2, 26.2)],
}

# Waypoint chain per main-leg destination, keyed on the freight table's port_or_border text.
PORT_ROUTES = {
    "istanbul (kapıkule)": ("road", ["balkans_road"], "kapıkule"),
    "ambarlı / mersin": ("sea", ["north_sea", "iberia", "west_med", "central_med", "aegean"], "ambarlı"),
    "tanger med (ferry)": ("road", ["iberia_road"], "tanger med"),
    "casablanca": ("sea", ["north_sea", "iberia"], "casablanca"),
    "alexandria": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med"], "alexandria"),
    "algiers": ("sea", ["north_sea", "iberia", "west_med"], "algiers"),
    "radès": ("sea", ["north_sea", "iberia", "west_med"], "radès"),
    "jeddah": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea"], "jeddah"),
    "jebel ali": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                          "bab_el_mandeb", "arabian_sea", "hormuz"], "jebel ali"),
    "dammam": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                       "bab_el_mandeb", "arabian_sea", "hormuz"], "dammam"),
    "hamad": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                      "bab_el_mandeb", "arabian_sea", "hormuz"], "hamad"),
    "shuwaikh": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                         "bab_el_mandeb", "arabian_sea", "hormuz"], "shuwaikh"),
    "khalifa bin salman": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                                   "bab_el_mandeb", "arabian_sea", "hormuz"], "khalifa bin salman"),
    "sohar": ("sea", ["north_sea", "iberia", "west_med", "central_med", "east_med", "suez", "red_sea",
                      "bab_el_mandeb", "arabian_sea"], "sohar"),
}


def locate(city: str | None, country: str | None, lat=None, lon=None) -> tuple[float, float] | None:
    try:
        if lat is not None and lon is not None and float(lat) == float(lat) and float(lon) == float(lon):
            return float(lat), float(lon)
    except (TypeError, ValueError):
        pass
    if city and str(city).strip().lower() in CITIES:
        return CITIES[str(city).strip().lower()]
    if country and country in COUNTRY_CENTROIDS:
        return COUNTRY_CENTROIDS[country]
    return None


def lane_path(port_or_border: str) -> dict | None:
    """Waypoints from Helmond to a main-leg destination, as [(lat, lon), ...]."""
    key = str(port_or_border or "").strip().lower()
    if key not in PORT_ROUTES:
        return None
    mode, chain, end = PORT_ROUTES[key]
    pts: list[tuple[float, float]] = [CITIES["helmond"]] if mode == "sea" else []
    for name in chain:
        pts.extend(WAYPOINTS[name])
    pts.append(CITIES[end])
    return {"mode": mode, "points": pts}


# ---------------------------------------------------------------- route graph for the map
# Sea lanes as a waypoint graph; the dashboard runs a shortest path between ports. Edges flagged
# "redsea" (Bab el-Mandeb and the southern Red Sea) are closed unless the Red Sea switch is on, so
# Asia-Europe traffic rounds the Cape of Good Hope. Coordinates are (lat, lon) and sit at sea.
SEA_NODES = {
    # North Europe and Atlantic coast
    "rtm": (51.95, 4.13), "dover": (51.0, 1.6), "channel": (49.9, -2.5), "ushant": (48.6, -5.6),
    "finisterre": (43.3, -9.9), "stvincent": (37.0, -9.8), "gib_w": (35.9, -6.6), "gib": (35.95, -5.6),
    # Mediterranean
    "alboran": (36.2, -2.5), "w_med": (37.6, 5.0), "sicily": (37.4, 11.3), "ionian": (35.5, 18.0),
    "otranto": (39.8, 18.9), "adriatic_s": (41.2, 19.1), "crete_s": (34.2, 26.0), "aegean_s": (36.8, 25.0),
    "aegean_n": (39.3, 24.8), "thessaloniki_app": (40.3, 23.0), "dardanelles": (40.2, 26.2), "marmara": (40.85, 28.3),
    "e_med": (32.2, 31.0), "levant": (34.0, 34.0), "mersin_app": (36.4, 34.6), "port_said": (31.3, 32.35),
    # Suez and Red Sea
    "suez": (29.9, 32.55), "red_n": (27.0, 34.6), "red_c": (21.5, 38.4), "red_s": (15.0, 41.8), "bab": (12.6, 43.4),
    # Gulf of Aden, Arabian Sea, Gulf
    "aden": (12.3, 50.0), "arabian_w": (15.5, 56.0), "ras_al_hadd": (22.6, 59.9), "gulf_of_oman": (24.4, 58.0),
    "hormuz": (26.5, 56.6), "gulf_e": (26.0, 54.8), "gulf_c": (26.6, 52.0), "gulf_w": (27.5, 50.5), "kuwait_app": (29.2, 48.6),
    "arabian_c": (14.0, 65.0), "laccadive": (9.5, 62.0), "india_s": (6.5, 77.0), "sri_lanka": (5.6, 81.0),
    # Bay of Bengal and East Asia
    "bengal": (15.0, 88.5), "chattogram_app": (21.0, 91.5), "andaman": (6.2, 93.0), "malacca_n": (5.9, 97.6),
    "malacca_s": (2.6, 101.3), "singapore": (1.25, 103.9), "anambas": (2.0, 104.8), "vietnam_s": (8.0, 107.0),
    "scs": (15.0, 111.8), "hong_kong": (22.0, 116.0), "taiwan_strait": (24.5, 119.9), "ecs": (27.5, 121.8),
    "ningbo_app": (29.8, 122.8), "yangtze": (31.5, 123.0), "yellow_sea": (34.5, 122.6),
    # Cape of Good Hope and West Africa
    "cape_1": (-2.0, 72.0), "cape_2": (-14.0, 62.0), "madagascar_s": (-27.5, 49.0), "cape_3": (-31.5, 38.0),
    "cape_4": (-35.5, 26.0), "agulhas": (-35.6, 19.8), "cape_w": (-34.2, 17.0), "namibia": (-29.0, 14.0),
    "angola": (-20.0, 10.0), "congo": (-8.0, 7.0), "guinea": (0.0, 0.0), "liberia": (3.5, -10.5),
    "sierra_leone": (8.0, -15.0), "dakar": (14.7, -18.2), "blanc": (21.0, -18.0), "canaries_w": (27.5, -19.0),
    "madeira": (33.5, -12.5),
}
SEA_CHAINS = [
    ["rtm", "dover", "channel", "ushant", "finisterre", "stvincent", "gib_w", "gib", "alboran", "w_med", "sicily",
     "ionian", "crete_s", "e_med", "port_said"],
    ["ionian", "otranto", "adriatic_s"],
    ["crete_s", "aegean_s", "aegean_n", "dardanelles", "marmara"], ["aegean_n", "thessaloniki_app"],
    ["e_med", "levant", "mersin_app"],
    ["port_said", "suez", "red_n", "red_c", "red_s", "bab", "aden"],
    ["aden", "arabian_w", "ras_al_hadd", "gulf_of_oman", "hormuz", "gulf_e", "gulf_c", "gulf_w", "kuwait_app"],
    ["aden", "laccadive", "india_s"], ["arabian_w", "arabian_c", "india_s"], ["arabian_c", "ras_al_hadd"],
    ["india_s", "sri_lanka", "andaman", "malacca_n", "malacca_s", "singapore", "anambas", "vietnam_s", "scs",
     "hong_kong", "taiwan_strait", "ecs", "ningbo_app", "yangtze", "yellow_sea"],
    ["sri_lanka", "bengal", "chattogram_app"],
    ["sri_lanka", "cape_1", "cape_2", "madagascar_s", "cape_3", "cape_4", "agulhas", "cape_w", "namibia", "angola",
     "congo", "guinea", "liberia", "sierra_leone", "dakar", "blanc", "canaries_w", "madeira", "stvincent"],
    ["madeira", "gib_w"], ["india_s", "cape_1"],
]
RED_SEA_EDGES = [("red_c", "red_s"), ("red_s", "bab")]
# Ports a sea leg can start or end at (keys of CITIES).
SEA_PORTS = ["rotterdam", "ambarlı", "mersin", "izmir", "alexandria", "casablanca", "tanger med", "algiers", "radès",
             "jebel ali", "dammam", "jeddah", "hamad", "shuwaikh", "khalifa bin salman", "sohar", "ningbo", "qingdao",
             "shanghai", "shenzhen", "chattogram", "durrës", "thessaloniki", "karachi"]
ROAD_NODES = {
    "helmond": (51.48, 5.66), "frankfurt": (50.11, 8.68), "munich": (48.14, 11.58), "salzburg": (47.80, 13.04),
    "vienna": (48.20, 16.37), "budapest": (47.50, 19.04), "ljubljana": (46.06, 14.51), "zagreb": (45.81, 15.98),
    "split": (43.51, 16.44), "dubrovnik": (42.65, 18.09), "podgorica": (42.43, 19.26), "tirana": (41.33, 19.82),
    "durrës": (41.32, 19.45), "skopje": (42.00, 21.43), "belgrade": (44.79, 20.45), "niš": (43.32, 21.90),
    "leskovac": (43.00, 21.95), "sofia": (42.70, 23.32), "kapıkule": (41.72, 26.36), "istanbul": (41.01, 28.98),
    "thessaloniki": (40.64, 22.94), "alexandroupoli": (40.85, 25.87),
}
ROAD_EDGES = [
    ("helmond", "frankfurt"), ("frankfurt", "munich"), ("munich", "salzburg"), ("munich", "vienna"),
    ("salzburg", "ljubljana"), ("ljubljana", "zagreb"), ("zagreb", "split"), ("split", "dubrovnik"),
    ("dubrovnik", "podgorica"), ("podgorica", "tirana"), ("tirana", "durrës"), ("tirana", "skopje"),
    ("skopje", "niš"), ("skopje", "sofia"), ("skopje", "thessaloniki"), ("niš", "leskovac"), ("leskovac", "skopje"),
    ("niš", "belgrade"), ("niš", "sofia"), ("belgrade", "budapest"), ("belgrade", "zagreb"), ("zagreb", "budapest"),
    ("budapest", "vienna"), ("sofia", "kapıkule"), ("kapıkule", "istanbul"), ("thessaloniki", "alexandroupoli"),
    ("alexandroupoli", "kapıkule"),
]
CITIES.setdefault("thessaloniki", (40.64, 22.94))


def route_graph() -> dict:
    """Sea and road graphs for the dashboard's shortest-path routing."""
    red = {tuple(sorted(e)) for e in RED_SEA_EDGES}
    sea_edges = []
    for chain in SEA_CHAINS:
        for a, b in zip(chain, chain[1:]):
            sea_edges.append([a, b, "redsea" if tuple(sorted((a, b))) in red else ""])
    return {
        "sea": {"nodes": SEA_NODES, "edges": sea_edges,
                "ports": {k: CITIES[k] for k in SEA_PORTS if k in CITIES}},
        "road": {"nodes": ROAD_NODES, "edges": [list(e) for e in ROAD_EDGES]},
    }
