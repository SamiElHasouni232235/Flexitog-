"""Build RFQ v3.0 test fixtures from the bundled v3.0 template.

Writes into tests/fixtures/:
  rfq_v30_dummy_reconstructed.xlsx  a dummy provider fill whose prices follow from the expected values of Test 1
                                    (uniform M1 prices S 100, M 500, L 1,000, XL 3,000, XXL 6,000; M2 C20 3,000 and
                                    P5 1,500; M3 clearance 100, free-zone entry 50 and exit 20; warehouse A in Dubai,
                                    free zone, with W05 10, W07 300, W09 0.75, W11 1.5, W12 8, W15 500, W16 + W17 4,500,
                                    W19 1,000; M5 to L01 to L04 S 20, M 60, L 150; M6 "Test consolidation hub").
                                    It stands in for "FlexiTog RFQ MENA-TR v3.0 - Dummy provider test fill.xlsx" until
                                    that file is in tests/fixtures.
  rfq_v30_input_errors.xlsx         the same fill with "incl" in m2.B01 price and "tbc" in m4.A.W05.
Each file is filled through the input cells the template's Export formulas point at, then recalculated by
LibreOffice (headless), so the Export sheet carries cached values and the template's own input check, as a file
saved in Excel does.

Run:  python tools/build_rfq_v30_fixtures.py
"""
from __future__ import annotations

import datetime
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from flexitog.dashboard import ASSETS, rfq_sources  # noqa: E402

TEMPLATE = ASSETS / "rfq" / "FlexiTog_RFQ_MENA-TR_v3.0.xlsx"
OUT = ROOT / "tests" / "fixtures"
SIZE_PRICE = {"S": 100, "M": 500, "L": 1000, "XL": 3000, "XXL": 6000}
LOAD_PRICE = {"P1": 400, "P5": 1500, "C20": 3000, "C40": 5000}
GCC = ("L01", "L02", "L03", "L04")


def dummy_values(template_values: dict) -> dict:
    v = {f"module.M{i}.offered": "Yes" for i in range(1, 7)}
    for k, x in template_values.items():
        p = k.split(".")
        if k.startswith("m1.") and k.endswith(".size"):
            t = p[1]
            v[f"m1.{t}.service"] = "Express" if x in ("S", "M") else "Air freight"
            v[f"m1.{t}.price_eur"] = SIZE_PRICE[x]
            v[f"m1.{t}.transit_days"] = 3
        if k.startswith("m2.") and k.endswith(".load"):
            b = p[1]
            v[f"m2.{b}.mode"] = "Sea" if x.startswith("C") else "Road"
            v[f"m2.{b}.price_eur"] = LOAD_PRICE[x]
            v[f"m2.{b}.transit_days"] = 14 if x.startswith("C") else 6
        if k.startswith("m5.") and k.endswith(".lane") and x in GCC:
            d, size = p[1], template_values[f"m5.{p[1]}.size"]
            v[f"m5.{d}.warehouse"] = "A"
            v[f"m5.{d}.price_eur"] = {"S": 20, "M": 60, "L": 150}[size]
            v[f"m5.{d}.transit_days"] = 1
            v[f"m5.{d}.next_day"] = "Yes"
    for i in range(1, 10):
        L = f"L{i:02d}"
        v.update({f"m3.{L}.clearance_eur": 100, f"m3.{L}.fz_entry_eur": 50, f"m3.{L}.fz_exit_eur": 20, f"m3.{L}.deposit": "No", f"m3.{L}.clearance_days": 2})
    v.update({"m4.A.W01": "Dubai, UAE", "m4.A.W02": "Free zone", "m4.A.W03": "Saudi Arabia, UAE, Kuwait, Qatar", "m4.A.W04": "Shared",
              "m4.A.W05": 10, "m4.A.W06": 5, "m4.A.W07": 300, "m4.A.W08": 450, "m4.A.W09": 0.75, "m4.A.W11": 1.5, "m4.A.W12": 8,
              "m4.A.W13": 0.2, "m4.A.W14": 5, "m4.A.W15": 500, "m4.A.W16": 3000, "m4.A.W17": 1500, "m4.A.W18": 12, "m4.A.W19": 1000})
    v.update({"m6.O01": "Test consolidation hub", "m6.O02": "Weekly consolidated air to a hub in Dubai, then road to the GCC.",
              "m6.O03": "UAE, Saudi Arabia", "m6.O04": 4, "m6.O05": "No",
              "m6.P1.desc": "Hub handling", "m6.P1.unit": "per shipment", "m6.P1.price_eur": 15,
              "m6.P2.desc": "Air consolidation", "m6.P2.unit": "per kg", "m6.P2.price_eur": 1.2})
    v.update({"q.Q01.answer": "Dummy Logistics B.V.", "q.Q02.answer": "Test Person", "q.Q03.answer": "test@dummy.example", "q.Q04.answer": "+31 40 000 0000",
              "q.Q05.answer": datetime.datetime(2027, 12, 31), "q.Q06.answer": 0.25, "q.Q06.comment": "Fuel at the 2027 annual index", "q.Q07.answer": "None",
              "q.Q08.answer": 30, "q.Q09.answer": datetime.time(16, 0), "q.Q10.answer": "Yes from regional stock", "q.Q11.answer": 2,
              "q.Q12.answer": "Guaranteed", "q.Q13.answer": 0.96, "q.Q14.answer": 0.004, "q.Q15.answer": "Both", "q.Q16.answer": "Both",
              "q.Q17.answer": "Yes", "q.Q18.answer": "Yes", "q.Q19.answer": "ISO 9001 and AEO", "q.Q20.answer": "All 9 countries",
              "q.Q21.answer": "All 9 countries", "q.Q22.answer": "Some (list in Comment)", "q.Q23.answer": "All 9 countries",
              "q.Q24.answer": "All 9 countries", "q.Q25.answer": "Some (list in Comment)", "q.Q26.answer": "Yes against a fee", "q.Q27.answer": 0.003, "q.Q28.answer": "Yes"})
    return v


def fill(values: dict, out: Path) -> None:
    src = rfq_sources(TEMPLATE)
    wb = openpyxl.load_workbook(TEMPLATE)
    for k, x in values.items():
        if k not in src:
            raise KeyError(f"{k} has no input cell in the template")
        sheet, cell = src[k]
        wb[sheet][cell] = x
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / out.name
        wb.save(raw)
        conv = Path(tmp) / "conv"
        subprocess.run(["soffice", "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", str(conv), str(raw)],
                       check=True, capture_output=True, timeout=180)
        shutil.copy(conv / out.name, out)


def main() -> None:
    tv = {r[0]: r[1] for r in openpyxl.load_workbook(TEMPLATE, data_only=True)["Export"].iter_rows(min_row=2, values_only=True)}
    v = dummy_values(tv)
    fill(v, OUT / "rfq_v30_dummy_reconstructed.xlsx")
    bad = dict(v, **{"m2.B01.price_eur": "incl", "m4.A.W05": "tbc"})
    fill(bad, OUT / "rfq_v30_input_errors.xlsx")
    for f in ("rfq_v30_dummy_reconstructed.xlsx", "rfq_v30_input_errors.xlsx"):
        ws = openpyxl.load_workbook(OUT / f, data_only=True)["Export"]
        check = next(r[1] for r in ws.iter_rows(min_row=2, values_only=True) if r[0] == "meta.input_check")
        print(f, "| input check:", check)


if __name__ == "__main__":
    main()
