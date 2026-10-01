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


# ---------------------------------------------------------------- supply side (supplier -> Helmond)
# Sea legs run east to west. The dashboard joins: supplier port -> Asia leg -> Suez or Cape -> Helmond.
SUPPLY_LEGS = {
    "yellow_sea": [(34.5, 122.6), (31.5, 123.0)],
    "east_asia": [(27.5, 121.8), (24.5, 119.9), (22.0, 116.0), (15.0, 111.8), (8.0, 107.0), (2.0, 104.8),
                  (1.25, 103.9), (2.6, 101.3), (5.9, 97.6), (5.6, 81.0), (6.5, 77.0)],
    "south_asia": [(21.0, 91.5), (15.0, 88.5), (5.6, 81.0), (6.5, 77.0)],
    "arabian_sea_to_aden": [(9.5, 62.0), (12.3, 50.0)],
    # Cape of Good Hope: south of Madagascar, round the Cape, up the West African coast, west of the Canaries
    "cape": [(-2.0, 72.0), (-14.0, 62.0), (-27.5, 49.0), (-31.5, 38.0), (-35.5, 26.0), (-35.6, 19.8),
             (-34.2, 17.0), (-29.0, 14.0), (-20.0, 10.0), (-8.0, 7.0), (0.0, 0.0), (3.5, -10.5), (8.0, -15.0),
             (14.7, -18.2), (21.0, -18.0), (27.5, -19.0), (33.5, -12.5), (37.0, -10.0), (43.3, -9.9)],
    "serbia_road": [(44.79, 20.45), (47.50, 19.04), (48.20, 16.37), (48.14, 11.58), (50.11, 8.68)],
    "adriatic_road": [(42.43, 19.26), (42.65, 18.09), (43.51, 16.44), (45.81, 15.98), (46.06, 14.51),
                      (47.80, 13.04), (48.14, 11.58), (50.11, 8.68)],
}


def supply_chains() -> dict:
    """Waypoint chains for supplier inbound lines on the dashboard map, all ending in Helmond."""
    rev = lambda *names: [pt for n in names for pt in reversed(WAYPOINTS[n])]  # noqa: E731
    helmond = [CITIES["helmond"]]
    europe_from_atlantic = rev("north_sea") + helmond
    return {
        "yellow_sea": SUPPLY_LEGS["yellow_sea"],
        "east_asia": SUPPLY_LEGS["east_asia"],
        "south_asia": SUPPLY_LEGS["south_asia"],
        "suez": SUPPLY_LEGS["arabian_sea_to_aden"]
                + rev("bab_el_mandeb", "red_sea", "suez", "east_med", "central_med", "west_med", "iberia", "north_sea")
                + helmond,
        "cape": SUPPLY_LEGS["cape"] + europe_from_atlantic,
        "serbia_road": SUPPLY_LEGS["serbia_road"] + helmond,
        "adriatic_road": SUPPLY_LEGS["adriatic_road"] + helmond,
    }
