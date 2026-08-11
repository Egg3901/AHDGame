import { existsSync } from "node:fs";
import { ROSTER_BY_KEY } from "./alignmentRoster";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  INTERNATIONAL_ORGANIZATIONS,
  INTERNATIONAL_ORGANIZATION_ORDER,
  ORG_PROPOSAL_VOTING_TURNS,
  isBuiltInInternationalOrganizationId,
  isValidCustomOrganizationSlug,
  FOREIGN_AFFAIRS_POSITION_BY_COUNTRY,
} from "./internationalOrganizations";
import { COUNTRY_CONFIGS, ALL_COUNTRY_IDS } from "./countries";
import { getCabinetPositions } from "./cabinetMechanics";
import { CN_CABINET_POSITIONS } from "./cnCabinet";
import { IE_CABINET_POSITIONS } from "./ieCabinet";
import { NG_CABINET_POSITIONS } from "./ngCabinet";
import {
  isOrganizationFounded,
  resolveSeedRoster,
} from "@/lib/internationalOrganizations/founding";
import { getStartingYearForPreset } from "./turnTime";

describe("INTERNATIONAL_ORGANIZATIONS", () => {
  it("has EU, NATO, UN, COMMONWEALTH, WARSAW_PACT, NON_ALIGNED, COMECON", () => {
    expect(Object.keys(INTERNATIONAL_ORGANIZATIONS).sort()).toEqual([
      "COMECON",
      "COMMONWEALTH",
      "EU",
      "NATO",
      "NON_ALIGNED",
      "UN",
      "WARSAW_PACT",
    ]);
  });

  it("defines the Commonwealth: UK-led, UK+NG everywhere, never dissolved", () => {
    const cw = INTERNATIONAL_ORGANIZATIONS.COMMONWEALTH;
    expect(cw.foundingMembers).toEqual(["UK", "NG"]);
    expect(cw.foundingMembersByEra).toBeUndefined();
    expect(cw.foundedYear).toBe(1949);
    expect(cw.dissolvedYear).toBeUndefined();
    expect(cw.permanentLeadership).toEqual({ countryId: "UK" });
    expect(cw.category).toBe("political");
  });

  it("defines the Warsaw Pact: RU-led full Eastern bloc, 1952–1991 window", () => {
    const wp = INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT;
    expect(wp.foundingMembers).toEqual(["RU", "DD", "PL", "HU", "RO", "BG", "CS"]);
    // It now carries an era table: Albania signed in 1955 and had withdrawn by
    // 1968, so it belongs to a 1953 roster and not a 1979 one.
    expect(wp.foundingMembersByEra).toBeDefined();
    expect(wp.foundedYear).toBe(1952);
    expect(wp.dissolvedYear).toBe(1991);
    expect(wp.permanentLeadership).toEqual({ countryId: "RU" });
    expect(wp.category).toBe("security");
  });

  it("defines the Non-Aligned Movement: founded 1961, YU+NG, empty in modern presets", () => {
    const nam = INTERNATIONAL_ORGANIZATIONS.NON_ALIGNED;
    expect(nam.foundingMembers).toEqual(["YU", "NG"]);
    expect(nam.foundedYear).toBe(1961);
    expect(nam.dissolvedYear).toBeUndefined();
    // Rotating chair — elected, never a fixed country's head of government.
    expect(nam.permanentLeadership).toBeUndefined();
    expect(nam.category).toBe("political");
    // None of the countries in the 1991/2019/2023 presets were ever members.
    expect(nam.foundingMembersByEra).toEqual({
      "1991-default": [],
      "2019-default": [],
      "2023-default": [],
    });
  });

  it("orders the Non-Aligned Movement last among built-ins", () => {
    expect(INTERNATIONAL_ORGANIZATION_ORDER).toEqual([
      "EU",
      "NATO",
      "UN",
      "COMMONWEALTH",
      "WARSAW_PACT",
      "NON_ALIGNED",
      "COMECON",
    ]);
  });

  it("defines COMECON: RU-led Eastern-bloc economic body, 1949–1991 window", () => {
    const cc = INTERNATIONAL_ORGANIZATIONS.COMECON;
    expect(cc.foundedYear).toBe(1949);
    expect(cc.dissolvedYear).toBe(1991);
    expect(cc.permanentLeadership).toEqual({ countryId: "RU" });
    expect(cc.category).toBe("economic");
    // 1953 roster: Jan 1949 founders + DD (joined 1950). No Albania CountryId;
    // YU never a full member (Cominform expulsion 1948 / associate only 1964).
    const roster1953 = resolveSeedRoster(cc, "1953-default");
    expect([...roster1953].sort()).toEqual(["BG", "CS", "DD", "HU", "PL", "RO", "RU"]);
    expect(roster1953).not.toContain("YU");
    expect(roster1953).toHaveLength(7);
    // Dissolved 28 June 1991 — not seeded at presets starting at/after 1991.
    for (const preset of ["1991-default", "2019-default"] as const) {
      expect(
        isOrganizationFounded({
          def: cc,
          liveYear: getStartingYearForPreset(preset),
          hasMembers: false,
        })
      ).toBe(false);
    }
    // Still exists through the 1979 cold-war window.
    expect(
      isOrganizationFounded({
        def: cc,
        liveYear: getStartingYearForPreset("1979-default"),
        hasMembers: false,
      })
    ).toBe(true);
  });

  it("ships logo SVG files on disk for every built-in org", () => {
    for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
      const logoPath = INTERNATIONAL_ORGANIZATIONS[id].logoPath;
      expect(logoPath).toMatch(/^\/orgs\/.+\.svg$/);
      expect(existsSync(join(process.cwd(), "public", logoPath as string))).toBe(true);
    }
  });

  it("uses 24-turn voting windows for proposals", () => {
    expect(ORG_PROPOSAL_VOTING_TURNS).toBe(24);
  });

  it("declares correct founding membership", () => {
    expect(INTERNATIONAL_ORGANIZATIONS.EU.foundingMembers).toEqual(["DE", "IE"]);
    expect(INTERNATIONAL_ORGANIZATIONS.NATO.foundingMembers).toEqual(["US", "UK", "DE"]);
    expect(INTERNATIONAL_ORGANIZATIONS.UN.foundingMembers).toEqual(["US", "UK", "DE", "JP"]);
  });

  it("declares real-world founding years", () => {
    expect(INTERNATIONAL_ORGANIZATIONS.UN.foundedYear).toBe(1945);
    expect(INTERNATIONAL_ORGANIZATIONS.NATO.foundedYear).toBe(1949);
    expect(INTERNATIONAL_ORGANIZATIONS.EU.foundedYear).toBe(1993);
    expect(INTERNATIONAL_ORGANIZATIONS.COMECON.foundedYear).toBe(1949);
  });

  it("defines no EU era rosters — pre-1993 presets don't seed it; it founds empty mid-game", () => {
    expect(INTERNATIONAL_ORGANIZATIONS.EU.foundingMembersByEra).toBeUndefined();
  });

  it("includes non-aligned Yugoslavia in the 1953 UN roster", () => {
    // Founding UN member (1945); remained seated after the Tito–Stalin split.
    expect(INTERNATIONAL_ORGANIZATIONS.UN.foundingMembersByEra?.["1953-default"]).toContain("YU");
    // Never a NATO member — non-aligned posture.
    expect(INTERNATIONAL_ORGANIZATIONS.NATO.foundingMembersByEra?.["1953-default"]).not.toContain(
      "YU"
    );
  });

  it("references logo SVGs that exist under /public/orgs", () => {
    for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
      expect(INTERNATIONAL_ORGANIZATIONS[id].logoPath).toMatch(/^\/orgs\/.+\.svg$/);
    }
  });

  it("declares a leadership office for every org", () => {
    for (const id of INTERNATIONAL_ORGANIZATION_ORDER) {
      const def = INTERNATIONAL_ORGANIZATIONS[id];
      expect(def.leadership.title.length).toBeGreaterThan(0);
      expect(def.leadership.termTurns).toBeGreaterThan(0);
    }
  });

  it("seats NATO's whole 1953 alliance, not just the simulated countries", () => {
    // Membership is entity-wide, so the founders that exist only as background
    // entities belong here. NATO without Canada and the Benelux was an artifact
    // of the old CountryId-only roster.
    const roster = resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.NATO, "1953-default");
    expect([...roster].sort()).toEqual(
      ["BE", "CA", "DK", "FR", "GR", "IS", "IT", "LU", "NL", "NO", "PT", "TR", "UK", "US"].sort()
    );
    expect(roster).not.toContain("DE"); // acceded 9 May 1955
    // Spain acceded 1982; Austria, Finland and Ireland were neutral.
    for (const absent of ["ES", "AT", "FI", "IE"]) expect(roster).not.toContain(absent);
  });

  it("adds West Germany by 1979 and Spain by 1991", () => {
    const y79 = resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.NATO, "1979-default");
    expect(y79).toContain("DE");
    expect(y79).not.toContain("ES");
    expect(y79).toHaveLength(15);

    const y91 = resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.NATO, "1991-default");
    expect(y91).toContain("ES");
    expect(y91).toHaveLength(16);
  });

  it("never falls through to the bare founding list for a cold-war preset", () => {
    // A missing era entry silently seated only US/UK/DE — the bug the 1991
    // entry was added to fix, which 1979 then inherited.
    for (const preset of ["1953-default", "1979-default", "1991-default"]) {
      expect(resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.NATO, preset).length).toBeGreaterThan(
        INTERNATIONAL_ORGANIZATIONS.NATO.foundingMembers.length
      );
    }
  });

  it("seats Albania in the Warsaw Pact of 1953 but not of 1979", () => {
    // A founding signatory in 1955, it stopped participating after the 1961
    // Soviet-Albanian split and formally withdrew in September 1968.
    expect(resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT, "1953-default")).toContain(
      "AL"
    );
    expect(
      resolveSeedRoster(INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT, "1979-default")
    ).not.toContain("AL");
  });

  it("only seats entities the alignment roster actually models", () => {
    // A typo here would seed a member that no screen could name.
    for (const org of [INTERNATIONAL_ORGANIZATIONS.NATO, INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT]) {
      for (const preset of ["1953-default", "1979-default", "1991-default"]) {
        for (const id of resolveSeedRoster(org, preset)) {
          expect(
            ROSTER_BY_KEY[id as keyof typeof ROSTER_BY_KEY],
            `${org.id} ${preset} ${id}`
          ).toBeDefined();
        }
      }
    }
  });
});

describe("isBuiltInInternationalOrganizationId", () => {
  it("accepts known ids", () => {
    expect(isBuiltInInternationalOrganizationId("EU")).toBe(true);
    expect(isBuiltInInternationalOrganizationId("NATO")).toBe(true);
    expect(isBuiltInInternationalOrganizationId("UN")).toBe(true);
    expect(isBuiltInInternationalOrganizationId("COMECON")).toBe(true);
  });

  it("rejects unknown ids", () => {
    expect(isBuiltInInternationalOrganizationId("ASEAN")).toBe(false);
    expect(isBuiltInInternationalOrganizationId("")).toBe(false);
  });
});

describe("isValidCustomOrganizationSlug", () => {
  it("accepts well-formed slugs", () => {
    expect(isValidCustomOrganizationSlug("asean")).toBe(true);
    expect(isValidCustomOrganizationSlug("g7")).toBe(true);
    expect(isValidCustomOrganizationSlug("east-asia-pact")).toBe(true);
  });

  it("rejects built-in ids and malformed slugs", () => {
    expect(isValidCustomOrganizationSlug("EU")).toBe(false);
    expect(isValidCustomOrganizationSlug("UN")).toBe(false);
    // Case-insensitive: lowercase built-ins are rejected too (URLs resolve case-insensitively).
    expect(isValidCustomOrganizationSlug("eu")).toBe(false);
    expect(isValidCustomOrganizationSlug("nato")).toBe(false);
    expect(isValidCustomOrganizationSlug("commonwealth")).toBe(false);
    expect(isValidCustomOrganizationSlug("comecon")).toBe(false);
    // "warsaw_pact" fails the slug regex anyway (underscore), but the lowercase
    // id must also be rejected if the regex ever loosens.
    expect(isValidCustomOrganizationSlug("warsaw_pact")).toBe(false);
    expect(isValidCustomOrganizationSlug("a")).toBe(false);
    expect(isValidCustomOrganizationSlug("Has-Caps")).toBe(false);
    expect(isValidCustomOrganizationSlug("-leading")).toBe(false);
    expect(isValidCustomOrganizationSlug("trailing-")).toBe(false);
    expect(isValidCustomOrganizationSlug("with space")).toBe(false);
  });
});

describe("FOREIGN_AFFAIRS_POSITION_BY_COUNTRY", () => {
  it("maps every active country to a position id (or null)", () => {
    for (const id of Object.keys(COUNTRY_CONFIGS) as Array<keyof typeof COUNTRY_CONFIGS>) {
      expect(id in FOREIGN_AFFAIRS_POSITION_BY_COUNTRY).toBe(true);
    }
  });

  // Regression (#980): countries that define a real foreign-affairs cabinet seat
  // must map to it, not null — otherwise a player foreign minister is never
  // recognized and only the head-of-government fallback can vote/act.
  it.each([
    ["CN", "minister_of_foreign_affairs", CN_CABINET_POSITIONS],
    ["IE", "minister_for_foreign_affairs", IE_CABINET_POSITIONS],
    ["NG", "minister_of_foreign_affairs", NG_CABINET_POSITIONS],
  ] as const)(
    "maps %s foreign-affairs seat to its cabinet position id",
    (country, seatId, positions) => {
      expect(positions.some((p) => p.id === seatId)).toBe(true);
      expect(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[country]).toBe(seatId);
    }
  );

  // The three cases above are a hand-written list, and #980 recurred underneath it:
  // RU, DD, PL, CS, HU, RO, BG and YU all define `minister_of_foreign_affairs` and
  // all still mapped to null, so their foreign ministers were unrecognized for as
  // long as the pinned three stayed green. These two tests are derived rather than
  // listed, so a ninth country cannot go quiet the same way.

  /**
   * Left on the head-of-government fallback on purpose, not by omission. Both are
   * sub-national, neither can be a belligerent, and the diplomatic surfaces for a
   * devolved administration are unverified — see the map's own comment.
   */
  const DELIBERATE_FALLBACK: readonly string[] = ["SCO", "WAL"];

  it("names the real seat for every country whose cabinet defines one", () => {
    const wrong: string[] = [];
    for (const country of ALL_COUNTRY_IDS) {
      if (DELIBERATE_FALLBACK.includes(country)) continue;
      const seat = getCabinetPositions(country).find((p) =>
        /foreign|external/i.test(`${p.id} ${p.name}`)
      );
      // `minister_of_foreign_trade` sits in the same cabinets and matches loosely;
      // the portfolio we want is affairs, never trade.
      const affairs = getCabinetPositions(country).find(
        (p) => /foreign|external/i.test(`${p.id} ${p.name}`) && !/trade/i.test(p.id)
      );
      if (!seat || !affairs) continue;
      if (FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[country] !== affairs.id) {
        wrong.push(
          `${country}: expected "${affairs.id}", got ${JSON.stringify(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[country])}`
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never maps a country to a seat its own cabinet does not define", () => {
    // A seat id that is not in the country's cabinet can never match a cabinetMembers
    // row, so requireForeignMinister would silently fall back forever.
    for (const country of ALL_COUNTRY_IDS) {
      const seat = FOREIGN_AFFAIRS_POSITION_BY_COUNTRY[country];
      if (!seat) continue;
      const ids = getCabinetPositions(country).map((p) => p.id);
      expect(ids, `${country} seat "${seat}"`).toContain(seat);
    }
  });

  it("never points a country at a trade portfolio", () => {
    for (const seat of Object.values(FOREIGN_AFFAIRS_POSITION_BY_COUNTRY)) {
      if (seat) expect(seat).not.toMatch(/trade/i);
    }
  });
});
