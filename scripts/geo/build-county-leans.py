#!/usr/bin/env python3
"""Build era county lean baselines: src/data/county-leans/{era}.json.

Each era's county PVI is the county's two-party Republican share minus the
national two-party Republican share (points, positive = right), weighted 75%
on the last presidential election before the era's start year and 25% on the
one before it. The 2027 era also folds in the 2025 Virginia and New Jersey
governor races (within-state county swing, one cycle of weight). The 2027
values are written back to `cookPVI` in src/data/counties/*.json, the
era-less default.

Sources (download, then pass the paths):
  --hist    Amlani & Algara, "Presidential Elections by County, 1868-2020",
            Harvard Dataverse doi:10.7910/DVN/DGUMFI, file
            dataverse_shareable_presidential_county_returns_1868_2020.Rdata
            (needs `pip install rdata pandas`)
  --y2024   tonmcg/US_County_Level_Election_Results_08-24,
            2024_US_County_Level_Presidential_Results.csv
  --nj2025 / --va2025
            Wikipedia raw wikitext (action=raw) of the 2025 New Jersey and
            Virginia gubernatorial election articles; the "By county" tables
            reproduce the certified state results.

Gaps: Alaska reports by state house district, so every borough takes the
statewide value from official totals. Counties with no vote in an era (DC
before 1964, Hawaii before statehood) borrow the next era's value. When a
major party is off a state's ballot (Alabama 1948), that year is dropped for
the state.
"""
import argparse
import collections
import csv
import glob
import json
import os
import re

import pandas as pd
import rdata

ERAS = {
    "1953": (1952, 1948), "1968": (1964, 1960), "1979": (1976, 1972),
    "1991": (1988, 1984), "1999": (1996, 1992), "2007": (2004, 2000),
    "2019": (2016, 2012), "2020": (2016, 2012), "2023": (2020, 2016),
    "2027": (2024, 2020),
}
# Official national two-party totals (D, R) where county sums undercount.
OFFICIAL = {2024: (75017613, 77302580), 2020: (81283501, 74223975)}
# Alaska official statewide totals (R, D).
AK = {
    1960: (30953, 29809), 1964: (22930, 44329), 1972: (55349, 32967),
    1976: (71555, 44058), 1984: (138377, 62007), 1988: (119251, 72584),
    1992: (102000, 78294), 1996: (122746, 80380), 2000: (167398, 79004),
    2004: (190889, 111025), 2012: (164676, 122640), 2016: (163387, 116454),
    2020: (189951, 153778), 2024: (184458, 140026),
}


def gov_rows(path, start, order):
    text = open(path).read()
    i = text.index(start)
    j = text.index("|}", i)
    out = []
    for blk in text[i:j].split("|-")[1:]:
        lines = [l for l in blk.split("\n") if l.startswith("|")]
        m = re.search(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]", blk)
        if not m:
            continue
        nums = [re.sub(r"[^\d]", "", l.split("|")[-1]) for l in lines[1:]]
        if len(nums) < 4:
            continue
        a, b = int(nums[0]), int(nums[2])
        d, r = (a, b) if order == "DR" else (b, a)
        out.append(((m.group(2) or m.group(1)).strip(), m.group(1), d, r))
    return out


def match_gov(rows, counties_file):
    cs = json.load(open(counties_file))["counties"]
    by = collections.defaultdict(list)
    for c in cs:
        by[c["name"].lower()].append(c["fips"])
    out = {}
    for label, target, d, r in rows:
        base = label.lower().removesuffix(" city").removesuffix(" county")
        cands = by.get(label.lower()) or by.get(base, [])
        if len(cands) > 1:
            is_county = "County" in target
            cands = [f for f in cands if (int(f[2:]) < 500) == is_county]
        if len(cands) != 1:
            raise SystemExit(f"unmatched 2025 locality {label!r}")
        out[cands[0]] = (d, r)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hist", required=True)
    ap.add_argument("--y2024", required=True)
    ap.add_argument("--nj2025", required=True)
    ap.add_argument("--va2025", required=True)
    args = ap.parse_args()

    conv = rdata.conversion.convert(rdata.parser.parse_file(args.hist), default_encoding="utf8")
    df = conv["pres_elections_release"]
    df = df[df.election_year >= 1948]
    data = collections.defaultdict(dict)
    for y, f, d, r in df[["election_year", "fips", "democratic_raw_votes", "republican_raw_votes"]].itertuples(index=False):
        if pd.isna(d) or pd.isna(r):
            continue
        data[int(y)][str(f).zfill(5)] = (float(d), float(r))
    for row in csv.DictReader(open(args.y2024)):
        data[2024][row["county_fips"].zfill(5)] = (float(row["votes_dem"]), float(row["votes_gop"]))

    counties = {}
    for f in sorted(glob.glob("src/data/counties/*.json")):
        for c in json.load(open(f))["counties"]:
            counties[c["fips"]] = True

    def nat(y):
        if y in OFFICIAL:
            d, r = OFFICIAL[y]
        else:
            d = sum(v[0] for v in data[y].values())
            r = sum(v[1] for v in data[y].values())
        return r / (d + r)

    def state_sums(y):
        s = collections.defaultdict(lambda: [0.0, 0.0])
        for f, (d, r) in data[y].items():
            s[f[:2]][0] += d
            s[f[:2]][1] += r
        return s

    out = {}
    for era, (y1, y0) in ERAS.items():
        n = {y1: nat(y1), y0: nat(y0)}
        ss = {y1: state_sums(y1), y0: state_sums(y0)}
        vals = {}
        for fips in counties:
            parts = []
            for y, w in ((y1, 0.75), (y0, 0.25)):
                sd, sr = ss[y].get(fips[:2], (0, 0))
                if sd == 0 or sr == 0:
                    continue
                v = data[y].get(fips)
                share = v[1] / (v[0] + v[1]) if v and v[0] + v[1] > 0 else sr / (sd + sr)
                parts.append(((share - n[y]) * 100, w))
            vals[fips] = (
                round(sum(p * w for p, w in parts) / sum(w for _, w in parts), 1) if parts else None
            )
        pairs = [(y, w) for y, w in ((y1, 0.75), (y0, 0.25)) if y in AK] or [(1964, 0.75), (1960, 0.25)]
        ak = sum((AK[y][0] / sum(AK[y]) - nat(y)) * 100 * w for y, w in pairs) / sum(w for _, w in pairs)
        for fips in counties:
            if fips.startswith("02"):
                vals[fips] = round(ak, 1)
        out[era] = vals

    order = list(ERAS)
    for i, era in enumerate(order):
        for f, v in out[era].items():
            if v is None:
                out[era][f] = next(out[e][f] for e in order[i + 1 :] if out[e][f] is not None)

    gov = {}
    gov.update(match_gov(gov_rows(args.nj2025, "=== By county ===", "DR"), "src/data/counties/NJ.json"))
    gov.update(
        match_gov(
            gov_rows(args.va2025, "=== By county and independent city ===", "RD"),
            "src/data/counties/VA.json",
        )
    )
    for sf in ("34", "51"):
        fs = [f for f in gov if f.startswith(sf)]
        s25 = sum(gov[f][1] for f in fs) / sum(sum(gov[f]) for f in fs)
        s24 = sum(data[2024][f][1] for f in fs) / sum(sum(data[2024][f]) for f in fs)
        for f in fs:
            c25 = gov[f][1] / sum(gov[f])
            c24 = data[2024][f][1] / sum(data[2024][f])
            out["2027"][f] = round(out["2027"][f] + ((c25 - s25) - (c24 - s24)) * 100 * 0.25, 1)

    os.makedirs("src/data/county-leans", exist_ok=True)
    for era, vals in out.items():
        with open(f"src/data/county-leans/{era}.json", "w") as fh:
            json.dump(dict(sorted(vals.items())), fh, separators=(",", ":"))
    for f in glob.glob("src/data/counties/*.json"):
        doc = json.load(open(f))
        for c in doc["counties"]:
            c["cookPVI"] = out["2027"][c["fips"]]
        with open(f, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"))
    print(f"wrote {len(out)} eras for {len(counties)} counties")


if __name__ == "__main__":
    main()
