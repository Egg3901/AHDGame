import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { CountryId } from "@/lib/constants/countries";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { commandEconomySoeSectors } from "@/lib/constants/commandEconomy";
import { NPP_CAPITAL_STATES } from "@/lib/admin/spawnNppCorporation";
import { generateCountryOwnedSeedData } from "./budgets";
import { getStateResourceCapacity } from "./stateResourceCapacity";

/**
 * The seeded country-owned corporations ARE each country's primary National
 * Corporation (the absorption target for nationalizations). The multi-NatCorp
 * model relies on `isPrimaryNationalCorporation`; the live backfill migration
 * sets it on existing data, but a fresh seed/reset must set it too — otherwise
 * a brand-new world has no primary-flagged NatCorp (mislabeled "split-off" in
 * the State Enterprises roster, wrong split/merge routing).
 */
describe("generateCountryOwnedSeedData", () => {
  const ukStates = [
    { id: "LON", population: 9_000_000, gdp: 500_000_000_000, countryId: "UK" },
    { id: "MAN", population: 2_800_000, gdp: 100_000_000_000, countryId: "UK" },
  ];

  it("flags every seeded country National Corporation as the primary", () => {
    const data = generateCountryOwnedSeedData(ukStates, "2019-default");
    expect(data.length).toBeGreaterThan(0);
    for (const entry of data) {
      expect(entry.corporation.isPrimaryNationalCorporation).toBe(true);
      expect(entry.corporation.countryOwnerId).toBeTruthy();
    }
  });

  it("seeds a primary NatCorp for every supported country", () => {
    const data = generateCountryOwnedSeedData(ukStates, "2019-default");
    const countries = new Set(data.map((e) => e.corporation.countryOwnerId));
    const expected: CountryId[] = ["US", "UK", "JP", "DE", "IE", "BR", "CN"];
    for (const c of expected) {
      expect(countries.has(c)).toBe(true);
    }
  });

  // Regression for #3288: the USSR is a command economy with no player
  // corporations, so unless the state owns producing sectors it is an economic
  // ghost (0 corps / 0 sectors → no commodity supply). It must seed a primary
  // National Corporation that OWNS producing sectors across its regions.
  describe("USSR (RU) state enterprise — issue #3288", () => {
    const ruStates = [
      { id: "CEN", population: 30_000_000, gdp: 400_000, countryId: "RU" },
      { id: "URA", population: 20_000_000, gdp: 250_000, countryId: "RU" },
    ];

    it("seeds a primary RU National Corporation that owns producing sectors", () => {
      const data = generateCountryOwnedSeedData(ruStates, "1979-default");
      const ru = data.filter((e) => e.corporation.countryOwnerId === "RU");
      expect(ru.length).toBeGreaterThan(0);

      const ruCorp = ru[0];
      expect(ruCorp.corporation.isPrimaryNationalCorporation).toBe(true);
      // Owns producing sectors in every region → generates commodity supply.
      expect(ruCorp.sectors.length).toBeGreaterThan(0);
      expect(ruCorp.sectors.every((s) => s.revenue > 0)).toBe(true);
      // Sector types are drawn from the commanding heights, one per (region, type).
      const sectorTypes = new Set(ruCorp.sectors.map((s) => s.sectorType));
      expect(sectorTypes.has("energy")).toBe(true);
      expect(sectorTypes.has("manufacturing")).toBe(true);
    });

    it("does not emit an RU corp when no RU states are supplied", () => {
      const data = generateCountryOwnedSeedData(ukStates, "2019-default");
      expect(data.some((e) => e.corporation.countryOwnerId === "RU")).toBe(false);
    });
  });

  // Command Economy v2 (P0): with `commandEconomyEnabled` the single RU National
  // Corp splits into one SOE per commanding-height sector.
  describe("multiple SOEs when commandEconomyEnabled (v2 P0)", () => {
    const ruStates = [
      { id: "CEN", population: 30_000_000, gdp: 400_000, countryId: "RU" },
      { id: "URA", population: 20_000_000, gdp: 250_000, countryId: "RU" },
    ];

    it("flag OFF → a single RU corp owning all commanding-heights sectors (unchanged)", () => {
      const off = generateCountryOwnedSeedData(ruStates, "1979-default", false);
      const ru = off.filter((e) => e.corporation.countryOwnerId === "RU");
      expect(ru).toHaveLength(1);
      expect(ru[0].corporation.isPrimaryNationalCorporation).toBe(true);
      expect(ru[0].corporation.soe).toBeUndefined();
      expect(ru[0].sectors.length).toBeGreaterThan(0);
    });

    it("flag ON → one SOE per sector, each carrying a SoeState overlay", () => {
      const on = generateCountryOwnedSeedData(ruStates, "1979-default", true);
      const ru = on.filter((e) => e.corporation.countryOwnerId === "RU");

      const soes = ru.filter((e) => e.corporation.soe);
      // >0 SOEs per command country (the P0 requirement).
      expect(soes.length).toBeGreaterThan(1);

      // Exactly one primary corp (the sovereign issuer), with no producing sectors.
      const primaries = ru.filter((e) => e.corporation.isPrimaryNationalCorporation);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].sectors).toHaveLength(0);
      expect(primaries[0].corporation.soe).toBeUndefined();

      // Each SOE: single assigned sector, owns producing sectors, plan target set.
      for (const soe of soes) {
        const st = soe.corporation.soe!;
        expect(soe.corporation.isPrimaryNationalCorporation).toBe(false);
        expect(soe.corporation.assignedSectorTypes).toEqual([st.sector]);
        expect(soe.sectors.length).toBeGreaterThan(0);
        expect(soe.sectors.every((s) => s.sectorType === st.sector)).toBe(true);
        expect(st.planTarget).toBeGreaterThan(0);
        expect(st.output).toBe(st.planTarget); // starts on-plan
        expect(st.directorId).toBeNull();
      }

      // Stable, unique, deterministic corp ids across reseeds.
      const ids = soes.map((e) => e.corporation._id.toHexString());
      expect(new Set(ids).size).toBe(ids.length);
      const again = generateCountryOwnedSeedData(ruStates, "1979-default", true)
        .filter((e) => e.corporation.countryOwnerId === "RU" && e.corporation.soe)
        .map((e) => e.corporation._id.toHexString());
      expect(again).toEqual(ids);
    });
  });

  // Command Economy v2 (#3496): CN gets the same per-sector SOE split as RU, but
  // ONLY in its fully-command era (First-Five-Year-Plan, marketization < 30) —
  // because CN, unlike the player-less USSR, is a market-capable country whose
  // dual-track / market eras get their producing supply from player + market
  // corps. The command-era split must not double-count or clobber that.
  describe("CN command-era multi-SOE (v2, #3496)", () => {
    const cnStates = [
      { id: "DB", population: 110_000_000, gdp: 300_000, countryId: "CN" },
      { id: "HB", population: 170_000_000, gdp: 350_000, countryId: "CN" },
      { id: "HD", population: 150_000_000, gdp: 340_000, countryId: "CN" },
      { id: "HZ", population: 100_000_000, gdp: 250_000, countryId: "CN" },
      { id: "HN", population: 80_000_000, gdp: 180_000, countryId: "CN" },
      { id: "XN", population: 90_000_000, gdp: 190_000, countryId: "CN" },
      { id: "XB", population: 50_000_000, gdp: 120_000, countryId: "CN" },
    ];
    const cnSoeSectorCount = commandEconomySoeSectors("CN").length;

    it("has a non-empty CN SOE sector set to split into", () => {
      expect(cnSoeSectorCount).toBeGreaterThan(0);
    });

    it("flag ON + command era (1953) → CN splits into one SOE per commanding-height sector", () => {
      const data = generateCountryOwnedSeedData(cnStates, "1953-default", true);
      const cn = data.filter((e) => e.corporation.countryOwnerId === "CN");
      const soes = cn.filter((e) => e.corporation.soe);

      // >0 SOEs (the issue's core requirement) — one per CN command sector.
      expect(soes.length).toBeGreaterThan(0);
      expect(soes.length).toBe(cnSoeSectorCount);

      // The bare sovereign issuer stays the single primary, with no producing sectors.
      const primaries = cn.filter((e) => e.corporation.isPrimaryNationalCorporation);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].corporation.soe).toBeUndefined();
      expect(primaries[0].sectors).toHaveLength(0);

      for (const soe of soes) {
        const st = soe.corporation.soe!;
        expect(soe.corporation.isPrimaryNationalCorporation).toBe(false);
        expect(soe.corporation.assignedSectorTypes).toEqual([st.sector]);
        expect(soe.corporation.liquidCurrencyCode).toBe("CNY");
        expect(soe.sectors.length).toBeGreaterThan(0);
        expect(soe.sectors.every((s) => s.sectorType === st.sector && s.revenue > 0)).toBe(true);
        expect(st.planTarget).toBeGreaterThan(0);
        expect(st.output).toBe(st.planTarget); // starts on-plan
        expect(st.directorId).toBeNull();
      }

      // Deterministic + stable across reseeds.
      const ids = soes.map((e) => e.corporation._id.toHexString());
      expect(new Set(ids).size).toBe(ids.length);
      const again = generateCountryOwnedSeedData(cnStates, "1953-default", true)
        .filter((e) => e.corporation.countryOwnerId === "CN" && e.corporation.soe)
        .map((e) => e.corporation._id.toHexString());
      expect(again).toEqual(ids);
    });

    it("does not clobber the CN sovereign issuer (disjoint ids, issuer preserved)", () => {
      const data = generateCountryOwnedSeedData(cnStates, "1953-default", true);
      const cn = data.filter((e) => e.corporation.countryOwnerId === "CN");
      const issuer = cn.find((e) => e.corporation.isPrimaryNationalCorporation)!;
      const soeIds = new Set(
        cn.filter((e) => e.corporation.soe).map((e) => e.corporation._id.toHexString())
      );
      expect(soeIds.has(issuer.corporation._id.toHexString())).toBe(false);
      // Issuer keeps its bond-issuer identity (financial, no producing sectors).
      expect(issuer.corporation.type).toBe("financial");
      expect(issuer.sectors).toHaveLength(0);
    });

    it("routes iron states to iron mining and skips extraction in empty-capacity states", () => {
      const logs: string[] = [];
      const data = generateCountryOwnedSeedData(
        [...cnStates, { id: "EMPTY", population: 1_000_000, gdp: 10_000, countryId: "CN" }],
        "1953-default",
        true,
        (message) => logs.push(message)
      );
      const extraction = data.find(
        (entry) =>
          entry.corporation.countryOwnerId === "CN" &&
          entry.corporation.soe?.sector === "extraction"
      );
      expect(extraction).toBeDefined();

      const strategiesByState = Object.fromEntries(
        extraction!.sectors.map((sector) => [sector.stateId, sector.strategyId])
      );
      for (const stateId of ["DB", "HB", "HZ", "XN"]) {
        expect(strategiesByState[stateId], stateId).toBe("iron_mining");
      }
      for (const stateId of ["HD", "HN", "XB"]) {
        expect(strategiesByState[stateId], stateId).toBe("coal_mining");
      }
      expect(strategiesByState.EMPTY).toBeUndefined();

      const capacity = getStateResourceCapacity("1953-default");
      expect(
        extraction!.sectors.every(
          (sector) => Object.keys(capacity[`CN:${sector.stateId}`]?.resources ?? {}).length > 0
        )
      ).toBe(true);
      expect(logs).toContain(
        "[CN] skipping extraction SOE sector in EMPTY: no seeded resource capacity for preset 1953-default"
      );
    });

    it("flag ON but dual-track era (1979) → CN keeps the bare issuer, no command SOE stack", () => {
      const data = generateCountryOwnedSeedData(cnStates, "1979-default", true);
      const cn = data.filter((e) => e.corporation.countryOwnerId === "CN");
      expect(cn.filter((e) => e.corporation.soe)).toHaveLength(0);
      expect(cn).toHaveLength(1);
      expect(cn[0].corporation.isPrimaryNationalCorporation).toBe(true);
      expect(cn[0].sectors).toHaveLength(0);
    });

    it("flag OFF in the command era → byte-identical bare issuer (no SOEs)", () => {
      const off = generateCountryOwnedSeedData(cnStates, "1953-default", false);
      const cn = off.filter((e) => e.corporation.countryOwnerId === "CN");
      expect(cn).toHaveLength(1);
      expect(cn[0].corporation.soe).toBeUndefined();
      expect(cn[0].corporation.isPrimaryNationalCorporation).toBe(true);
      expect(cn[0].sectors).toHaveLength(0);

      // Identical to the pre-#3496 default call shape (no preset/flag args).
      const legacy = generateCountryOwnedSeedData(cnStates, "2019-default").filter(
        (e) => e.corporation.countryOwnerId === "CN"
      );
      expect(legacy).toHaveLength(1);
      expect(legacy[0].corporation.soe).toBeUndefined();
      expect(legacy[0].sectors).toHaveLength(0);
    });
  });

  // Command-economy seed-gap fix: DD/PL/HU/CS/BG/RO are Warsaw-Pact command
  // economies through 1953/1979 (MARKETIZATION_SCHEDULE, all under
  // COMMAND_CEILING), but previously had NO producing corporate objects — DD's
  // only "corporation" was its bare bond-issuer shell, and the other five had
  // no country-owned corp at all. Their actual output existed only as
  // `unownedSectors` documents: no corporations, no CEO seats, nothing a
  // player could run/nationalize/privatize. This regression-guards the fix:
  // each of the six now resolves a non-empty SOE sector set AND the seed path
  // (`generateCountryOwnedSeedData`, the function every per-country budget
  // seeder calls) builds real corporations + owned `corporateSectors` for them.
  describe("Warsaw-Pact satellite SOEs (command-economy seed-gap fix)", () => {
    const WARSAW_PACT_STATES: Record<string, { id: string; population: number; gdp: number }[]> = {
      DD: [
        { id: "BEO", population: 1_190_000, gdp: 5_200 },
        { id: "MV", population: 2_120_000, gdp: 3_900 },
      ],
      PL: [
        { id: "PL_MAZ", population: 5_000_000, gdp: 40_000 },
        { id: "PL_SLK", population: 4_500_000, gdp: 38_000 },
      ],
      HU: [
        { id: "HU_BUD", population: 1_800_000, gdp: 20_000 },
        { id: "HU_NOR", population: 1_500_000, gdp: 15_000 },
      ],
      CS: [
        { id: "CS_PRG", population: 1_100_000, gdp: 18_000 },
        { id: "CS_BOH", population: 3_000_000, gdp: 25_000 },
      ],
      BG: [
        { id: "BG_SOF", population: 800_000, gdp: 8_000 },
        { id: "BG_THR", population: 1_200_000, gdp: 6_000 },
      ],
      RO: [
        { id: "RO_BUC", population: 1_200_000, gdp: 10_000 },
        { id: "RO_MOL", population: 2_500_000, gdp: 9_000 },
      ],
      // Not a Warsaw-Pact member (Tito's Yugoslavia was expelled from Cominform
      // in 1948), but shares the same command-economy seed-gap fix — see
      // COMMAND_ECONOMY_SOE_SECTORS.YU / WARSAW_PACT_SOE_SPEC's YU entry.
      YU: [
        { id: "YU_SRB", population: 4_000_000, gdp: 30_000 },
        { id: "YU_CRO", population: 3_200_000, gdp: 22_000 },
      ],
    };

    for (const countryId of ["DD", "PL", "HU", "CS", "BG", "RO", "YU"] as const) {
      const statesForCountry = WARSAW_PACT_STATES[countryId].map((s) => ({
        ...s,
        countryId,
      }));
      const soeSectorCount = commandEconomySoeSectors(countryId).length;

      it(`${countryId}: has a non-empty SOE sector set`, () => {
        expect(soeSectorCount).toBeGreaterThan(0);
      });

      it(`${countryId}: flag ON + command era (1953) → builds one SOE corp per sector, each owning producing sectors`, () => {
        const data = generateCountryOwnedSeedData(statesForCountry, "1953-default", true);
        const entries = data.filter((e) => e.corporation.countryOwnerId === countryId);
        const soes = entries.filter((e) => e.corporation.soe);

        expect(soes.length).toBe(soeSectorCount);
        for (const soe of soes) {
          const st = soe.corporation.soe!;
          expect(soe.corporation.isPrimaryNationalCorporation).toBe(false);
          expect(soe.corporation.assignedSectorTypes).toEqual([st.sector]);
          expect(soe.sectors.length).toBeGreaterThan(0);
          expect(soe.sectors.every((s) => s.sectorType === st.sector && s.revenue > 0)).toBe(true);
          expect(st.planTarget).toBeGreaterThan(0);
          expect(st.output).toBe(st.planTarget);
          expect(st.directorId).toBeNull();
        }

        // Deterministic + stable across reseeds (same ids every run).
        const ids = soes.map((e) => e.corporation._id.toHexString());
        expect(new Set(ids).size).toBe(ids.length);
        const again = generateCountryOwnedSeedData(statesForCountry, "1953-default", true)
          .filter((e) => e.corporation.countryOwnerId === countryId && e.corporation.soe)
          .map((e) => e.corporation._id.toHexString());
        expect(again).toEqual(ids);
      });

      it(`${countryId}: flag OFF → no SOE corporations (feature-gated)`, () => {
        const data = generateCountryOwnedSeedData(statesForCountry, "1953-default", false);
        const entries = data.filter((e) => e.corporation.countryOwnerId === countryId);
        expect(entries.filter((e) => e.corporation.soe)).toHaveLength(0);
      });

      it(`${countryId}: no state supplied → no SOE corporations emitted`, () => {
        const data = generateCountryOwnedSeedData(ukStates, "1953-default", true);
        const entries = data.filter((e) => e.corporation.countryOwnerId === countryId);
        // DD (unlike the other five) always emits its bare bond-issuer shell
        // via `sovereignIssuerSpec`, independent of state supply — the shell
        // is a legitimate separate entity (see the double-count test below),
        // so assert on the absence of SOEs specifically for DD.
        if (countryId === "DD") {
          expect(entries.filter((e) => e.corporation.soe)).toHaveLength(0);
        } else {
          expect(entries).toHaveLength(0);
        }
      });
    }

    it("DD's bond-issuer shell is not double-counted as a producing SOE", () => {
      const data = generateCountryOwnedSeedData(
        WARSAW_PACT_STATES.DD.map((s) => ({ ...s, countryId: "DD" as const })),
        "1953-default",
        true
      );
      const dd = data.filter((e) => e.corporation.countryOwnerId === "DD");
      const shell = dd.find((e) => e.corporation.isPrimaryNationalCorporation);
      expect(shell).toBeDefined();
      // The bond-issuer shell stays a bare, non-producing issuer identity.
      expect(shell!.corporation.soe).toBeUndefined();
      expect(shell!.sectors).toHaveLength(0);

      // Every SOE is a distinct, disjoint corp id from the shell.
      const soeIds = new Set(
        dd.filter((e) => e.corporation.soe).map((e) => e.corporation._id.toHexString())
      );
      expect(soeIds.size).toBeGreaterThan(0);
      expect(soeIds.has(shell!.corporation._id.toHexString())).toBe(false);
    });

    it("sector-count scale is sane: extraction only covers states with seeded capacity", () => {
      const capacity = getStateResourceCapacity("1953-default");
      for (const countryId of ["DD", "PL", "HU", "CS", "BG", "RO", "YU"] as const) {
        const data = generateCountryOwnedSeedData(
          WARSAW_PACT_STATES[countryId].map((s) => ({ ...s, countryId })),
          "1953-default",
          true
        );
        const soes = data.filter(
          (e) => e.corporation.countryOwnerId === countryId && e.corporation.soe
        );
        expect(soes).toHaveLength(CORPORATION_TYPES.length);
        const sectorCount = soes.reduce((n, e) => n + e.sectors.length, 0);
        const capacityStateCount = WARSAW_PACT_STATES[countryId].filter(
          (state) => Object.keys(capacity[`${countryId}:${state.id}`]?.resources ?? {}).length > 0
        ).length;
        expect(sectorCount).toBe(
          (CORPORATION_TYPES.length - 1) * WARSAW_PACT_STATES[countryId].length + capacityStateCount
        );
      }
    });
  });

  // Reunification coverage (ticket #1271): when DD absorbs the FRG, the
  // acceded Laender arrive with live owner DD but geology still keyed under
  // DE. The extraction SOE must cover them through the previous owner's key —
  // otherwise the Nationalized Org owns extraction only in the east while the
  // reconcile drains the west's unowned twin, and western mining belongs to
  // nobody.
  describe("absorbed-region extraction coverage (ticket #1271)", () => {
    const ddStates = [
      { id: "SN", population: 4_000_000, gdp: 30_000, countryId: "DD" },
      { id: "MV", population: 2_120_000, gdp: 3_900, countryId: "DD" },
      // Absorbed FRG Land: live owner DD, deposits keyed DE:NW.
      { id: "NW", population: 15_000_000, gdp: 120_000, countryId: "DD" },
      // No owner lists this region anywhere: still skipped.
      { id: "NOWHERE", population: 1_000_000, gdp: 5_000, countryId: "DD" },
    ];

    it("covers absorbed regions through the previous owner's capacity key", () => {
      const data = generateCountryOwnedSeedData(ddStates, "1953-default", true);
      const extraction = data.find(
        (e) => e.corporation.countryOwnerId === "DD" && e.corporation.soe?.sector === "extraction"
      );
      expect(extraction).toBeDefined();
      const covered = new Set(extraction!.sectors.map((s) => s.stateId));
      expect(covered.has("SN")).toBe(true);
      expect(covered.has("MV")).toBe(true);
      expect(covered.has("NW")).toBe(true);
      expect(covered.has("NOWHERE")).toBe(false);
    });

    it("gives extraction the same coverage as every other SOE sector", () => {
      // The symptom side of the bug, and the assertion that would have caught
      // it from the outside: extraction is the ONE sector type filtered per
      // state, so a regression in that filter shows up as sixteen sector types
      // covering every region and the seventeenth covering fewer. Asserted over
      // states that all carry deposits, so full parity is the correct answer.
      const depositStates = ddStates.filter((s) => s.id !== "NOWHERE");
      const data = generateCountryOwnedSeedData(depositStates, "1953-default", true);
      const soes = data.filter((e) => e.corporation.countryOwnerId === "DD" && e.corporation.soe);
      expect(soes.length).toBeGreaterThan(1);
      for (const entry of soes) {
        expect(
          entry.sectors.length,
          `${entry.corporation.soe?.sector} should cover every region`
        ).toBe(depositStates.length);
      }
    });
  });

  // Market-economy state enterprises (corporate-sector seed-gap fix): FR/IT/
  // SE/TR/GR/AT/FI are market democracies promoted from the abstract
  // sphere-macro tier to full-autonomous (seedEconTierRosters.ts /
  // ECON_TIER_ROSTER_COUNTRIES, #3253) but never given a matching corporate
  // seed — a 646-turn 1953 sandbox world showed FR at 5, IT at 1, and
  // SE/TR/GR/AT/FI at exactly 0 `corporateSectors` rows. ES is deliberately
  // excluded here (2026-07-28 owner decision demoted it to sphere-macro for
  // 1953-default — see the "Spain (ES)" describe block below and
  // DORMANT_MARKET_STATE_ENTERPRISE_SPECS in ./budgets.ts).
  describe("market-economy state enterprises (corporate-sector seed-gap fix)", () => {
    const MARKET_STATES: Record<string, { id: string; population: number; gdp: number }[]> = {
      FR: [
        { id: "FR_IDF", population: 8_000_000, gdp: 2_000_000 },
        { id: "FR_NOR", population: 3_000_000, gdp: 1_200_000 },
      ],
      IT: [
        { id: "IT_LAZ", population: 4_500_000, gdp: 2_800_000 },
        { id: "IT_NW", population: 6_000_000, gdp: 3_500_000 },
      ],
      SE: [
        { id: "SE_STH", population: 1_200_000, gdp: 5_000 },
        { id: "SE_GOT", population: 700_000, gdp: 3_000 },
      ],
      TR: [
        { id: "TR_ANK", population: 900_000, gdp: 2_500 },
        { id: "TR_IST", population: 1_100_000, gdp: 3_500 },
      ],
      GR: [
        { id: "GR_ATT", population: 1_800_000, gdp: 15_000 },
        { id: "GR_MAC", population: 1_200_000, gdp: 9_000 },
      ],
      AT: [
        { id: "AT_VIE", population: 1_700_000, gdp: 25_000 },
        { id: "AT_STK", population: 1_100_000, gdp: 15_000 },
      ],
      FI: [
        { id: "FI_UUS", population: 900_000, gdp: 250_000 },
        { id: "FI_SW", population: 600_000, gdp: 150_000 },
      ],
    };

    for (const countryId of ["FR", "IT", "SE", "TR", "GR", "AT", "FI"] as const) {
      it(`${countryId}: seeds a non-empty, real-firm-grounded state enterprise`, () => {
        const data = generateCountryOwnedSeedData(
          MARKET_STATES[countryId].map((s) => ({ ...s, countryId })),
          "1953-default"
        );
        const entries = data.filter((e) => e.corporation.countryOwnerId === countryId);
        expect(entries.length).toBeGreaterThan(0);

        const corp = entries[0];
        expect(corp.corporation.isNationalized).toBe(true);
        expect(corp.corporation.isPrimaryNationalCorporation).toBe(true);
        expect(corp.sectors.length).toBeGreaterThan(0);
        expect(corp.sectors.every((s) => s.revenue > 0)).toBe(true);
      });

      it(`${countryId}: does not seed a state enterprise outside the 1953 preset`, () => {
        const data = generateCountryOwnedSeedData(
          MARKET_STATES[countryId].map((s) => ({ ...s, countryId })),
          "2019-default"
        );
        expect(data.some((e) => e.corporation.countryOwnerId === countryId)).toBe(false);
      });

      it(`${countryId}: emits nothing when no states of that country are supplied`, () => {
        const data = generateCountryOwnedSeedData(ukStates, "1953-default");
        expect(data.some((e) => e.corporation.countryOwnerId === countryId)).toBe(false);
      });
    }
  });

  // Spain (ES): demoted from full-autonomous to sphere-macro for 1953-default
  // ONLY (owner decision, 2026-07-28) — Franco's dictatorship never holds a
  // legislative election in this preset (see worldEntityManifest.ts).
  // seedMacroCountries.ts's own invariant is that sphere-macro entities seed
  // ZERO corporations/corporateSectors, so unlike its former FR/IT/SE/TR/GR/
  // AT/FI siblings above, ES must NOT get a state-enterprise corp seeded for
  // 1953-default even though its authored INI spec still exists (dormant —
  // see DORMANT_MARKET_STATE_ENTERPRISE_SPECS in ./budgets.ts).
  describe("Spain (ES): sphere-macro for 1953 — no state enterprise seeded", () => {
    const esStates = [
      { id: "ES_MAD", population: 2_000_000, gdp: 22_000, countryId: "ES" },
      { id: "ES_CAT", population: 3_200_000, gdp: 30_000, countryId: "ES" },
    ];

    it("emits no ES-owned corporation for 1953-default", () => {
      const data = generateCountryOwnedSeedData(esStates, "1953-default");
      expect(data.some((e) => e.corporation.countryOwnerId === "ES")).toBe(false);
    });

    it("emits no ES-owned corporation outside 1953-default either", () => {
      const data = generateCountryOwnedSeedData(esStates, "2019-default");
      expect(data.some((e) => e.corporation.countryOwnerId === "ES")).toBe(false);
    });
  });

  // The guard that would have caught the original defect: every full-
  // autonomous 1953 country whose organic corporate-formation path
  // (NPP_CAPITAL_STATES) is disabled MUST get a non-empty seed, because the
  // seed is its ONLY route to ever owning a corporate sector — NPP/player
  // corps never spawn there (spawnNppCorporation.ts requires a configured
  // capital state). Countries WITH a configured capital state are exempt: a
  // bare (0-sector) seed is fine for them because organic growth carries
  // their corporate economy instead (this is also why JP/DE/UK/IE/US/NG/BR
  // show large corporateSectors counts in a played-out world despite seeding
  // ~0 — that growth is organic, not seeded).
  describe("full-autonomous 1953 countries never seed a zero corporate-sector economy", () => {
    const FULL_AUTONOMOUS_1953: CountryId[] = [
      "US",
      "UK",
      "JP",
      "DE",
      "IE",
      "BR",
      "CN",
      "NG", // organic-growth countries (populated NPP_CAPITAL_STATES)
      "RU",
      "DD",
      "PL",
      "HU",
      "CS",
      "BG",
      "RO",
      "YU", // command-economy SOEs
      "FR",
      "IT",
      "SE",
      "TR",
      "GR",
      "AT",
      "FI", // market-economy state enterprises (ES excluded — sphere-macro for 1953, see above)
    ];

    const STATE_FIXTURE: Record<string, { id: string; gdp: number }[]> = {
      US: [{ id: "DC", gdp: 500_000 }],
      UK: [{ id: "LON", gdp: 500_000 }],
      JP: [{ id: "KAN", gdp: 500_000 }],
      DE: [{ id: "BE", gdp: 500_000 }],
      IE: [{ id: "DUB", gdp: 500_000 }],
      BR: [{ id: "DF", gdp: 500_000 }],
      CN: [{ id: "BJ", gdp: 500_000 }],
      NG: [{ id: "NORTH_CENTRAL", gdp: 500_000 }],
      RU: [{ id: "CEN", gdp: 400_000 }],
      DD: [{ id: "BEO", gdp: 5_200 }],
      PL: [{ id: "PL_MAZ", gdp: 40_000 }],
      HU: [{ id: "HU_BUD", gdp: 20_000 }],
      CS: [{ id: "CS_PRG", gdp: 18_000 }],
      BG: [{ id: "BG_SOF", gdp: 8_000 }],
      RO: [{ id: "RO_BUC", gdp: 10_000 }],
      YU: [{ id: "YU_SRB", gdp: 30_000 }],
      FR: [{ id: "FR_IDF", gdp: 2_000_000 }],
      IT: [{ id: "IT_LAZ", gdp: 2_800_000 }],
      SE: [{ id: "SE_STH", gdp: 5_000 }],
      TR: [{ id: "TR_ANK", gdp: 2_500 }],
      GR: [{ id: "GR_ATT", gdp: 15_000 }],
      AT: [{ id: "AT_VIE", gdp: 25_000 }],
      FI: [{ id: "FI_UUS", gdp: 250_000 }],
    };

    for (const countryId of FULL_AUTONOMOUS_1953) {
      const hasOrganicGrowth = (NPP_CAPITAL_STATES[countryId] ?? "") !== "";
      const label = hasOrganicGrowth
        ? "organic-growth country — seed may legitimately be empty"
        : "no organic growth — the seed is its only path to a corporate sector";

      it(`${countryId} (${label})`, () => {
        const states = STATE_FIXTURE[countryId].map((s) => ({
          ...s,
          countryId,
          population: 1,
        }));
        const data = generateCountryOwnedSeedData(states, "1953-default", true);
        const totalSectors = data
          .filter((e) => e.corporation.countryOwnerId === countryId)
          .reduce((n, e) => n + e.sectors.length, 0);

        if (hasOrganicGrowth) {
          // No assertion on the count either way — 0 is fine (organic growth
          // carries it), a seeded amount is also fine.
          expect(totalSectors).toBeGreaterThanOrEqual(0);
        } else {
          // This is the regression: every one of these MUST seed at least one
          // owned sector per state, and not an absurd multiple of it either
          // (guards the fix from overcorrecting into a duplicate-seeding bug).
          // Eastern-bloc full SOE stack = one sector per CorporationType per state.
          expect(totalSectors).toBeGreaterThanOrEqual(states.length);
          expect(totalSectors).toBeLessThanOrEqual(states.length * CORPORATION_TYPES.length);
        }
      });
    }
  });
});

// ── The seeders' own call site, not just the generator ────────────────────────
//
// generateCountryOwnedSeedData defaults `preset` to "2019-default", and the
// market-state-enterprise block is gated on "1953-default". Every one of the
// eight market democracies called it with a single argument, so the gate never
// fired and all eight seeded zero sectors — while the generator's own unit
// tests passed, because they pass the preset explicitly.
//
// This asserts the CALL SITE, which is where the bug actually lived.
describe("budget seeders pass their preset through to the corp seeder", () => {
  const MARKET_STATE_ENTERPRISE_SEEDERS = [
    "seedAtBudgets",
    "seedEsBudgets",
    "seedFiBudgets",
    "seedFrBudgets",
    "seedGrBudgets",
    "seedItBudgets",
    "seedSeBudgets",
    "seedTrBudgets",
  ];

  it.each(MARKET_STATE_ENTERPRISE_SEEDERS)(
    "%s forwards preset to generateCountryOwnedSeedData",
    (seeder) => {
      const src = readFileSync(`src/lib/admin/seed/${seeder}.ts`, "utf8");
      const call = src.match(/generateCountryOwnedSeedData\(([^)]*)\)/);
      expect(call, `${seeder} never calls generateCountryOwnedSeedData`).toBeTruthy();
      expect(
        call![1].includes("preset"),
        `${seeder} calls generateCountryOwnedSeedData without preset — the ` +
          `1953 market-state-enterprise seed will silently produce nothing`
      ).toBe(true);
    }
  );
});
