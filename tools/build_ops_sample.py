"""Write flexitog/assets/data/ops_sample.json: the sample data of the operations overview.

One file holds every fixture the overview uses until the Odoo exports are uploaded, plus the facts Odoo has no
field for yet (pick time per line, relabeling progress, certificate expiry dates). Dates are day offsets from
the day the page opens (0 = today, -1 = yesterday), so the sample never goes stale. SKUs come from the
built-in products. Every number here is invented and the overview labels it "sample".

Run:  python tools/build_ops_sample.py
"""
from __future__ import annotations

import json
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "flexitog" / "assets" / "data" / "ops_sample.json"

# SKU -> (Odoo product category, base units shipped per month)
SKUS = {
    "FT-JKT-100": ("All / Freezer wear", 420), "FT-TRS-100": ("All / Freezer wear", 300), "FT-OVR-100": ("All / Freezer wear", 160),
    "RW-PRK-100": ("All / Freezer wear", 260), "RW-VST-100": ("All / Freezer wear", 210), "RW-GLV-100": ("All / Freezer wear", 900),
    "FT-JKT-200": ("All / Chiller wear", 380), "GF-TRS-200": ("All / Chiller wear", 240), "GF-BAL-100": ("All / Chiller wear", 520),
    "GF-SOC-100": ("All / Chiller wear", 1100), "RW-BOT-100": ("All / PPE and safety", 150), "GF-GLV-200": ("All / PPE and safety", 1300),
}
# days of cover the sample aims at per zone: chiller sits under the 21-day warning on purpose
COVER = {"Freezer": 38, "Chiller": 16, "PPE": 52}
COUNTRIES = ["NL", "DE", "BE", "FR", "GB", "DK", "SE", "PL", "TR", "MA", "AE", "SA"]


def main() -> None:
    rnd = random.Random(2026)
    move_lines, quants, counts, pickings = [], [], [], []
    # outgoing move lines for the last 13 months, a few per SKU per month, seasonal peak in winter
    for sku, (cat, base) in SKUS.items():
        for m in range(13):
            season = 1.0 + 0.35 * (1 if (10 - m) % 12 in (0, 1, 2, 11) else 0)
            total = base * season * rnd.uniform(0.85, 1.15)
            for k in range(6):
                day = -(m * 30 + rnd.randint(0, 29))
                if day > 0:
                    continue
                move_lines.append({"sku": sku, "quantity": round(total / 6), "dayOffset": day, "time": f"{rnd.randint(7, 16):02d}:{rnd.choice(['05', '20', '35', '50'])}",
                                   "picking_code": "outgoing", "picking": f"HLM/OUT/{rnd.randint(1000, 9999)}"})
    # stock on hand: days of cover near the zone target
    for sku, (cat, base) in SKUS.items():
        zone = "Freezer" if "Freezer" in cat else "Chiller" if "Chiller" in cat else "PPE"
        on_hand = base / 30 * COVER[zone] * rnd.uniform(0.9, 1.1)
        locs = rnd.randint(2, 3)
        for i in range(locs):
            quants.append({"sku": sku, "category": cat, "location": f"HLM/Stock/{zone[0]}-{rnd.randint(1, 12):02d}-{rnd.randint(1, 8):02d}", "quantity": round(on_hand / locs)})
    # location counts: this month and last month, a few with a difference
    loc_names = sorted({q["location"] for q in quants})
    for month, n, misses in ((0, 46, 2), (1, 52, 4)):
        for i in range(n):
            loc = loc_names[i % len(loc_names)]
            sys_q = rnd.randint(20, 400)
            day = -rnd.randint(0, 27) if month == 0 else -rnd.randint(31, 58)
            counts.append({"location": f"{loc}-{i // len(loc_names)}", "sku": rnd.choice(list(SKUS)), "dayOffset": day,
                           "system_quantity": sys_q, "counted_quantity": sys_q - (rnd.randint(1, 6) if i < misses else 0)})
    # dock slots from three days ago to nine days ahead
    seq = {"inbound": 2100, "outbound": 5400, "quality": 300}
    prefix = {"inbound": "IN", "outbound": "OUT", "quality": "QC"}
    for day in range(-3, 10):              # the overview drops days that fall on a Saturday or Sunday
        for _ in range(rnd.randint(6, 9)):
            kind = rnd.choices(["inbound", "outbound", "quality"], [4, 6, 1.4])[0]
            seq[kind] += 1
            start = rnd.randint(12, 34) * 30   # 06:00 to 17:00
            pickings.append({"name": f"HLM/{prefix[kind]}/{seq[kind]:05d}", "slot_type": kind,
                             "picking_type_code": {"inbound": "incoming", "outbound": "outgoing", "quality": "internal"}[kind],
                             "dayOffset": day, "start": f"{start // 60:02d}:{start % 60:02d}", "slot_minutes": rnd.choice([30, 45, 60, 60, 90]),
                             "dock": f"Dock {rnd.randint(1, 4)}", "state": "done" if day < 0 else "assigned",
                             "partner_country": rnd.choice(COUNTRIES) if kind == "outbound" else "CN" if kind == "inbound" and rnd.random() < .5 else "NL"})
    data = {
        "note": "Sample data for the operations overview. Invented numbers, labelled sample in the UI. Dates are day offsets from today.",
        "pickTime": {"minutesPerLine": 1.8, "lastMonth": 2.1, "targetMinutes": 2.0, "scaleMaxMinutes": 4.0},
        "relabeling": {"what": "RefrigiWear cartons relabelled to FlexiTog EU labels", "done": 1840, "total": 2600},
        "certificates": [
            {"sku": "FT-JKT-100", "document": "EN 342:2017 type examination certificate", "fact": "rated to -50°C", "expiresInDays": 18},
            {"sku": "FT-OVR-100", "document": "EN 342:2017 type examination certificate", "fact": "rated to -50°C", "expiresInDays": 41},
            {"sku": "RW-BOT-100", "document": "EN ISO 20345:2022 certificate", "fact": "S3 safety footwear", "expiresInDays": 63},
            {"sku": "GF-GLV-200", "document": "EN 388:2016+A1:2018 certificate", "fact": "cut resistance level C", "expiresInDays": 96},
            {"sku": "FT-TRS-100", "document": "EN 342:2017 type examination certificate", "fact": "rated to -50°C", "expiresInDays": 124},
            {"sku": "RW-GLV-100", "document": "EN 511:2006 certificate", "fact": "convective cold level 2", "expiresInDays": 151},
        ],
        "moveLines": move_lines, "quants": quants, "counts": counts, "pickings": pickings,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(OUT, len(move_lines), "move lines,", len(quants), "quants,", len(counts), "counts,", len(pickings), "slots")


if __name__ == "__main__":
    main()
