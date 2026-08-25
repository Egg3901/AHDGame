import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STATE_ADJACENCY, adjacentStates } from "./stateAdjacency";
import type { CountryId } from "./countries";
import { states1953 } from "@/lib/seeds/reference/states1953";
import { atRegions } from "@/lib/seeds/at/atRegions";
import { balRegions } from "@/lib/seeds/bal/balRegions";
import { bgRegions } from "@/lib/seeds/bg/bgRegions";
import { blrRegions } from "@/lib/seeds/blr/blrRegions";
import { brRegions } from "@/lib/seeds/br/brRegions";
import { cnRegions } from "@/lib/seeds/cn/cnRegions";
import { csRegions } from "@/lib/seeds/cs/csRegions";
import { ddRegions } from "@/lib/seeds/dd/ddRegions";
import { deRegions } from "@/lib/seeds/de/deRegions";
import { esRegions } from "@/lib/seeds/es/esRegions";
import { fiRegions } from "@/lib/seeds/fi/fiRegions";
import { frRegions } from "@/lib/seeds/fr/frRegions";
import { grRegions } from "@/lib/seeds/gr/grRegions";
import { huRegions } from "@/lib/seeds/hu/huRegions";
import { ieRegions } from "@/lib/seeds/ie/ieRegions";
import { itRegions } from "@/lib/seeds/it/itRegions";
import { jpRegions } from "@/lib/seeds/jp/jpRegions";
import { ngRegions } from "@/lib/seeds/ng/ngRegions";
import { plRegions } from "@/lib/seeds/pl/plRegions";
import { roRegions } from "@/lib/seeds/ro/roRegions";
import { ruRegions } from "@/lib/seeds/ru/ruRegions";
import { scoRegions } from "@/lib/seeds/sco/scoRegions";
import { seRegions } from "@/lib/seeds/se/seRegions";
import { trRegions } from "@/lib/seeds/tr/trRegions";
import { uaRegions } from "@/lib/seeds/ua/uaRegions";
import { ukRegions } from "@/lib/seeds/uk/ukRegions";
import { walRegions } from "@/lib/seeds/wal/walRegions";
import { yuRegions } from "@/lib/seeds/yu/yuRegions";

const COUNTRY_REGIONS: Readonly<Record<CountryId, readonly { _id: string }[]>> = {
  US: states1953,
  UK: ukRegions,
  DE: deRegions,
  JP: jpRegions,
  IE: ieRegions,
  BR: brRegions,
  CN: cnRegions,
  NG: ngRegions,
  HU: huRegions,
  PL: plRegions,
  RO: roRegions,
  YU: yuRegions,
  BG: bgRegions,
  BLR: blrRegions,
  UKR: uaRegions,
  CS: csRegions,
  BAL: balRegions,
  RU: ruRegions,
  FR: frRegions,
  IT: itRegions,
  ES: esRegions,
  SE: seRegions,
  TR: trRegions,
  GR: grRegions,
  AT: atRegions,
  FI: fiRegions,
  DD: ddRegions,
  SCO: scoRegions,
  WAL: walRegions,
};

const ALL_COUNTRIES = Object.keys(COUNTRY_REGIONS) as CountryId[];

const DELIBERATE_DISCONNECTED_REGIONS: Partial<Record<CountryId, readonly string[]>> = {
  US: ["HI"],
  RU: ["MOL"],
};

describe("STATE_ADJACENCY", () => {
  describe("symmetry invariant", () => {
    // For every (country, A, B), B ∈ adjacency[A] must imply A ∈ adjacency[B].
    // A broken symmetry would mean the picker offers an inconsistent set
    // of states from different chair home-state perspectives.
    for (const country of ALL_COUNTRIES) {
      it(`is symmetric for ${country}`, () => {
        const map = STATE_ADJACENCY[country];
        const broken: Array<{ from: string; to: string }> = [];
        for (const [from, neighbors] of Object.entries(map)) {
          for (const to of neighbors) {
            const reverse = map[to];
            if (!reverse || !reverse.includes(from)) {
              broken.push({ from, to });
            }
          }
        }
        expect(broken).toEqual([]);
      });
    }
  });

  describe("no self-edges", () => {
    // adjacency[X] must not include X itself — the caller prepends the
    // home state separately so it doesn't appear twice in the picker.
    for (const country of ALL_COUNTRIES) {
      it(`has no self-edges for ${country}`, () => {
        const map = STATE_ADJACENCY[country];
        for (const [from, neighbors] of Object.entries(map)) {
          expect(neighbors).not.toContain(from);
        }
      });
    }
  });

  describe("seed vocabulary", () => {
    for (const country of ALL_COUNTRIES) {
      it(`covers exactly the seeded IDs for ${country}`, () => {
        const expected = COUNTRY_REGIONS[country].map((region) => region._id).sort();
        expect(Object.keys(STATE_ADJACENCY[country]).sort()).toEqual(expected);
      });

      it(`references only seeded IDs for ${country}`, () => {
        const seeded = new Set(COUNTRY_REGIONS[country].map((region) => region._id));
        for (const [from, neighbors] of Object.entries(STATE_ADJACENCY[country])) {
          expect(seeded.has(from), from).toBe(true);
          for (const to of neighbors) {
            expect(seeded.has(to), `${from} -> ${to}`).toBe(true);
          }
        }
      });
    }
  });

  describe("connectivity invariant", () => {
    for (const country of ALL_COUNTRIES) {
      it(`is connected for ${country} apart from documented exceptions`, () => {
        const map = STATE_ADJACENCY[country];
        const disconnected = new Set(DELIBERATE_DISCONNECTED_REGIONS[country] ?? []);
        const connectedIds = Object.keys(map).filter((id) => !disconnected.has(id));
        const start = connectedIds[0]!;
        const seen = new Set<string>([start]);
        const queue = [start];

        while (queue.length > 0) {
          for (const next of map[queue.pop()!] ?? []) {
            if (!disconnected.has(next) && !seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          }
        }

        expect([...seen].sort()).toEqual(connectedIds.sort());
        for (const region of disconnected) {
          expect(map[region]).toEqual([]);
        }
      });
    }
  });

  describe("known US adjacencies", () => {
    it("CA borders AZ, NV, OR", () => {
      expect([...adjacentStates("US", "CA")].sort()).toEqual(["AZ", "NV", "OR"]);
    });
    it("NY borders CT, MA, NJ, PA, VT", () => {
      expect([...adjacentStates("US", "NY")].sort()).toEqual(["CT", "MA", "NJ", "PA", "VT"]);
    });
    it("TX borders AR, LA, NM, OK", () => {
      expect([...adjacentStates("US", "TX")].sort()).toEqual(["AR", "LA", "NM", "OK"]);
    });
    it("HI is standalone (no neighbors)", () => {
      expect(adjacentStates("US", "HI")).toEqual([]);
    });
    it("AK borders WA by sea-border convention", () => {
      expect(adjacentStates("US", "AK")).toContain("WA");
    });
    it("MI borders WI via Lake Michigan", () => {
      expect(adjacentStates("US", "MI")).toContain("WI");
      expect(adjacentStates("US", "WI")).toContain("MI");
    });
  });

  describe("known UK adjacencies", () => {
    it("LON borders SEE and EAE", () => {
      expect([...adjacentStates("UK", "LON")].sort()).toEqual(["EAE", "SEE"]);
    });
    it("NIR borders SCO and NWE via sea ferries", () => {
      expect([...adjacentStates("UK", "NIR")].sort()).toEqual(["NWE", "SCO"]);
    });
    it("WAL does NOT border NIR (no direct ferry)", () => {
      expect(adjacentStates("UK", "WAL")).not.toContain("NIR");
      expect(adjacentStates("UK", "NIR")).not.toContain("WAL");
    });
  });

  describe("known DE adjacencies", () => {
    it("BE (Berlin) is enclaved within BB only", () => {
      expect(adjacentStates("DE", "BE")).toEqual(["BB"]);
    });
    it("BY borders BW, HE, TH, SN", () => {
      expect([...adjacentStates("DE", "BY")].sort()).toEqual(["BW", "HE", "SN", "TH"]);
    });
    it("SL only borders RP", () => {
      expect(adjacentStates("DE", "SL")).toEqual(["RP"]);
    });
  });

  describe("known JP adjacencies", () => {
    it("HOK borders TOH via Tsugaru Strait", () => {
      expect(adjacentStates("JP", "HOK")).toEqual(["TOH"]);
    });
    it("KYU only borders CGK via Kanmon Strait", () => {
      expect(adjacentStates("JP", "KYU")).toEqual(["CGK"]);
    });
  });

  describe("known CN adjacencies", () => {
    it("DB (Dongbei) borders HB (Huabei) only", () => {
      expect(adjacentStates("CN", "DB")).toEqual(["HB"]);
    });
    it("HZ (Huazhong) is the most connected macro-region", () => {
      expect([...adjacentStates("CN", "HZ")].sort()).toEqual(["HB", "HD", "HN", "XB", "XN"]);
    });
  });

  describe("known RU adjacencies", () => {
    it("FEA (Far East) only borders ESB (East Siberia)", () => {
      expect(adjacentStates("RU", "FEA")).toEqual(["ESB"]);
    });
    it("MOL (Moldova) is an exclave: its only neighbours left RU", () => {
      // The Moldavian SSR bordered the Ukrainian SSR and Romania only, and
      // Ukraine is its own country now.
      expect(adjacentStates("RU", "MOL")).toEqual([]);
    });
    it("KAZ (Kazakhstan) borders CAS, URA, VOL, WSB", () => {
      expect([...adjacentStates("RU", "KAZ")].sort()).toEqual(["CAS", "URA", "VOL", "WSB"]);
    });
    it("TRA borders CAS via the Baku–Krasnovodsk Caspian ferry", () => {
      expect(adjacentStates("RU", "TRA")).toContain("CAS");
      expect(adjacentStates("RU", "CAS")).toContain("TRA");
    });
    it("has no edges to the republics that became their own countries", () => {
      for (const region of Object.keys(STATE_ADJACENCY.RU)) {
        for (const gone of ["UKR", "BEL", "BLT"]) {
          expect(adjacentStates("RU", region), `${region} -> ${gone}`).not.toContain(gone);
        }
      }
    });
  });

  describe("known DD adjacencies", () => {
    it("BEO (East Berlin) is enclaved within BB only", () => {
      expect(adjacentStates("DD", "BEO")).toEqual(["BB"]);
    });
    it("TH borders SN and ST", () => {
      expect([...adjacentStates("DD", "TH")].sort()).toEqual(["SN", "ST"]);
    });
    it("MV only borders BB (SH/NI neighbors are West German)", () => {
      expect(adjacentStates("DD", "MV")).toEqual(["BB"]);
    });
    it("matches the DE map restricted to the shared eastern-Länder codes", () => {
      // DD reuses the modern eastern-Länder codes (see ddRegions.ts), so for
      // every pair of shared codes, the two maps must agree on whether they
      // border. BEO is DD-exclusive and excluded from the comparison.
      const shared = ["BB", "MV", "SN", "ST", "TH"];
      for (const a of shared) {
        for (const b of shared) {
          if (a === b) continue;
          expect(adjacentStates("DD", a).includes(b)).toBe(adjacentStates("DE", a).includes(b));
        }
      }
    });
  });

  describe("RU coverage", () => {
    it("includes exactly the 14 ruRegions seed IDs", () => {
      const expected = ruRegions.map((r) => r._id);
      expect(Object.keys(STATE_ADJACENCY.RU).sort()).toEqual([...expected].sort());
    });
    it("is fully connected apart from the documented MOL exclave", () => {
      // MOL lost its only neighbour when Ukraine became its own country, so the
      // RU graph is one connected body plus Moldova. Any OTHER stranded region
      // is a data error.
      const { MOL: _mol, ...map }: Record<string, readonly string[]> = STATE_ADJACENCY.RU;
      const start = Object.keys(map)[0]!;
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        for (const next of map[queue.pop()!] ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].sort()).toEqual(Object.keys(map).sort());
    });
  });

  describe("DD coverage", () => {
    it("includes exactly the 6 ddRegions seed IDs", () => {
      const expected = ddRegions.map((r) => r._id);
      expect(Object.keys(STATE_ADJACENCY.DD).sort()).toEqual([...expected].sort());
    });
    it("is fully connected (no stranded region)", () => {
      const map = STATE_ADJACENCY.DD;
      const start = Object.keys(map)[0]!;
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        for (const next of map[queue.pop()!] ?? []) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].sort()).toEqual(Object.keys(map).sort());
    });
  });

  describe("unknown state IDs", () => {
    it("returns [] rather than throwing for missing state", () => {
      expect(adjacentStates("US", "ZZ")).toEqual([]);
    });
  });

  describe("US coverage", () => {
    it("includes all 50 states + DC (51 keys)", () => {
      const count = Object.keys(STATE_ADJACENCY.US).length;
      expect(count).toBe(51);
    });
  });

  describe("UK coverage", () => {
    it("includes all 12 UK regions", () => {
      const expected = [
        "LON",
        "SEE",
        "SWE",
        "EAE",
        "EMI",
        "WMI",
        "YHU",
        "NWE",
        "NEE",
        "SCO",
        "WAL",
        "NIR",
      ];
      expect(Object.keys(STATE_ADJACENCY.UK).sort()).toEqual([...expected].sort());
    });
  });

  describe("DE coverage", () => {
    it("includes all 16 Bundesländer", () => {
      const expected = [
        "BW",
        "BY",
        "BE",
        "BB",
        "BRE",
        "HH",
        "HE",
        "MV",
        "NI",
        "NW",
        "RP",
        "SL",
        "SN",
        "ST",
        "SH",
        "TH",
      ];
      expect(Object.keys(STATE_ADJACENCY.DE).sort()).toEqual([...expected].sort());
    });
  });

  describe("pre-existing map regression", () => {
    const expectedHashes = {
      US: "e3651f06d9a6dd0dbd46d3ce2451254238ff17d773ce7f4990a193eeec6da0fe",
      UK: "d8faf3c50af27363e2928f5023013390c6f8f7173a532cab2340d5ca33527962",
      DE: "b90125507666e35479502e98f1133036829ce08beb19118a3e61bdce26d3a057",
      JP: "f37d5e2c92001b8e1bded1cdda618cd0fc38b493d6526491e45ed5ef65f64a18",
      CN: "9dba610303f1f4d0743da4fe109d2de5bbcf4b4f24b89ccda064864280449e67",
      RU: "bba4abddee750c284631e8479eae5f49bba1d4d2ac4b0d0f445248917dd9a6a9",
      DD: "057f20ed1076098b4999facbb4c46d506e73caa091baa07ad99ed9ef81bfdc8c",
    } as const;

    for (const [country, expectedHash] of Object.entries(expectedHashes)) {
      it(`keeps the serialized ${country} map byte-unchanged`, () => {
        const actualHash = createHash("sha256")
          .update(JSON.stringify(STATE_ADJACENCY[country as keyof typeof expectedHashes]))
          .digest("hex");
        expect(actualHash).toBe(expectedHash);
      });
    }
  });
});
