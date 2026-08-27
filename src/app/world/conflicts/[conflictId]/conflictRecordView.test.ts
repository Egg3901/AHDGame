import { describe, it, expect } from "vitest";
import {
  buildRecordExtras,
  casualtiesBySide,
  declarationOutcome,
  forceReadiness,
  recoveringCount,
  type RecordExtrasInput,
} from "./conflictRecordView";
// From the leaf, not through the view module: the projection the panel shows and
// the drift the tick applies have to be the same constant or the test proves nothing.
import { READINESS_DRIFT_STEP } from "@/lib/military/readinessDrift";
import type { MilitaryUnit } from "@/lib/db/types/militaryUnit";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";

const THEATER = "front-1";

function unit(over: Record<string, unknown> = {}): MilitaryUnit {
  return {
    _id: "u1",
    countryId: "US",
    branchId: "army",
    domain: "ground",
    name: "1st Armored",
    type: "Armored Division",
    icon: "tank",
    basePower: 92,
    personnel: 15000,
    upkeepBase: 180,
    posture: "standard",
    techTier: 2,
    vet: 1,
    xp: 0,
    readiness: 70,
    equipment: { firepower: 1, protection: 1, support: 1 },
    drill: null,
    theaterId: THEATER,
    assignedGeneralId: null,
    createdTurn: 1,
    ...over,
  } as unknown as MilitaryUnit;
}

/** A resolved report: US (side A) declared on CN (side B). */
function report(over: Record<string, unknown> = {}): BattleReportDoc {
  return {
    _id: "r1",
    theaterId: THEATER,
    declarerCountry: "US",
    targetCountry: "CN",
    turn: 41,
    result: {
      theaterId: THEATER,
      theaterName: "Front",
      verdict: "Victory",
      win: true,
      margin: 20,
      rounds: [],
      retreat: null,
      attacker: {
        country: "US",
        power: 4444,
        loss: 300,
        unitResults: [
          {
            id: "u1",
            name: "1st Armored",
            role: "line",
            dom: "ground",
            type: "Armored Division",
            casualties: 300,
            readiness: 60,
            xp: 5,
            promo: false,
          },
        ],
      },
      defender: {
        country: "CN",
        power: 9999,
        loss: 900,
        unitResults: [
          {
            id: "e1",
            name: "88th Guards",
            role: "line",
            dom: "ground",
            type: "Rifle Division",
            casualties: 900,
            readiness: 40,
            xp: 3,
            promo: false,
          },
        ],
      },
    },
    ...over,
  } as unknown as BattleReportDoc;
}

const input = (over: Partial<RecordExtrasInput> = {}): RecordExtrasInput => ({
  tier: "public",
  ownSide: null,
  theaterId: THEATER,
  sideACountries: ["US"],
  sideBCountries: ["CN"],
  units: [unit(), unit({ _id: "e1", countryId: "CN", name: "88th Guards" })],
  reports: [report()],
  ...over,
});

describe("buildRecordExtras — public tier", () => {
  it("exposes no forces at all", () => {
    const x = buildRecordExtras(input());
    expect(x.ownForces).toBeUndefined();
    expect(x.enemyBand).toBeUndefined();
  });

  // The report document carries the enemy roster and both powers; the PAYLOAD must
  // not, because whatever is in the props is in the HTML.
  it("leaks no roster or power onto any engagement", () => {
    const x = buildRecordExtras(input());
    expect(x.battles[0].rosters).toBeUndefined();
    expect(JSON.stringify(x)).not.toMatch(/88th Guards|1st Armored/);
    expect(JSON.stringify(x)).not.toMatch(/9999|4444/);
  });

  it("still reports the verdict and both loss totals", () => {
    const b = buildRecordExtras(input()).battles[0];
    expect(b.verdict).toBe("Victory");
    expect(b.attackerLosses).toEqual([{ country: "US", loss: 300 }]);
    expect(b.defenderLosses).toEqual([{ country: "CN", loss: 900 }]);
  });
});

describe("buildRecordExtras — command tier", () => {
  const cmd = () => buildRecordExtras(input({ tier: "command", ownSide: "A" }));

  it("lists the viewer's own forces at the front", () => {
    const own = cmd().ownForces;
    expect(own).toHaveLength(1);
    expect(own![0]).toMatchObject({ name: "1st Armored", type: "Armored Division" });
    expect(own![0].strengthPct).toBeGreaterThan(0);
  });

  it("reads the enemy as a coarse band, never a number", () => {
    const x = cmd();
    expect(typeof x.enemyBand).toBe("string");
    expect(JSON.stringify(x)).not.toMatch(/9999/);
  });

  it("unlocks the viewer's own roster on an engagement but not the enemy's", () => {
    const rosters = cmd().battles[0].rosters;
    expect(rosters).toHaveLength(1);
    expect(rosters![0].country).toBe("US");
    expect(rosters![0].units[0].name).toBe("1st Armored");
    expect(JSON.stringify(rosters)).not.toMatch(/88th Guards/);
  });

  it("gives side B the mirror view", () => {
    const x = buildRecordExtras(input({ tier: "command", ownSide: "B" }));
    expect(x.ownForces![0].name).toBe("88th Guards");
    expect(x.battles[0].rosters![0].country).toBe("CN");
    expect(JSON.stringify(x.battles[0].rosters)).not.toMatch(/1st Armored/);
  });
});

describe("buildRecordExtras — archive tier", () => {
  const arc = () => buildRecordExtras(input({ tier: "archive", ownSide: null }));

  it("opens both rosters and both strengths", () => {
    const rosters = arc().battles[0].rosters;
    expect(rosters).toHaveLength(2);
    expect(rosters!.map((r) => r.country).sort()).toEqual(["CN", "US"]);
    expect(rosters!.find((r) => r.country === "US")!.power).toBe(4444);
    expect(rosters!.find((r) => r.country === "CN")!.power).toBe(9999);
  });

  // A resolved war has returned its units to reserve, so there is no live order of
  // battle to show — the history lives in the reports instead.
  it("shows no live order of battle", () => {
    expect(arc().ownForces).toBeUndefined();
    expect(arc().enemyBand).toBeUndefined();
  });
});

describe("buildRecordExtras — engagements", () => {
  it("skips a no-contact report, which has no result", () => {
    const x = buildRecordExtras(input({ reports: [report({ result: null })] }));
    expect(x.battles).toHaveLength(0);
  });

  // An offensive that met nothing and still moved the line IS how the front got
  // where it is. Dropping it left a war won by walkover with an empty history
  // beside territory that had plainly changed hands.
  it("keeps an unopposed advance, which moved the front without an engagement", () => {
    const x = buildRecordExtras(
      input({
        reports: [report({ result: null, noContact: true, unopposedAdvance: true })],
      })
    );
    expect(x.battles).toHaveLength(1);
    expect(x.battles[0]).toMatchObject({
      verdict: "Unopposed advance",
      unopposed: true,
      attackerLosses: [],
      defenderLosses: [],
    });
    // Nobody fought, so there is no roster to unlock at any tier.
    expect(x.battles[0].rosters).toBeUndefined();
  });

  it("states ground moved from side A's side, and null when the report predates it", () => {
    // control is side B's share, so a FALL is a side A gain.
    const gained = buildRecordExtras(
      input({ reports: [report({ controlBefore: 70, controlAfter: 64 })] })
    );
    expect(gained.battles[0].groundPct).toBe(6);

    const lost = buildRecordExtras(
      input({ reports: [report({ controlBefore: 64, controlAfter: 70 })] })
    );
    expect(lost.battles[0].groundPct).toBe(-6);

    expect(buildRecordExtras(input()).battles[0].groundPct).toBeNull();
  });
});

describe("casualtiesBySide", () => {
  it("folds per-country totals onto the two rosters", () => {
    expect(casualtiesBySide({ US: 300, UK: 120, CN: 900 }, ["US", "UK"], ["CN"])).toEqual({
      A: 420,
      B: 900,
    });
  });

  // A country that has since signed a separate peace leaves its reports on file.
  // Folding it into whichever side it used to fight for would overstate that
  // side's dead for the rest of the war.
  it("counts a country in neither roster on neither side", () => {
    expect(casualtiesBySide({ US: 300, FR: 5000 }, ["US"], ["CN"])).toEqual({ A: 300, B: 0 });
  });

  it("reports zero for a war nobody has died in", () => {
    expect(casualtiesBySide({}, ["US"], ["CN"])).toEqual({ A: 0, B: 0 });
  });
});

describe("forceReadiness", () => {
  const u = (readiness: number, posture = "standard") => ({ readiness, posture }) as never;

  it("has nothing to say about an empty force", () => {
    expect(forceReadiness([])).toBeNull();
  });

  // The projection mirrors driftReadiness: ±4 per turn toward the posture's
  // baseline. Inventing a rate would promise recovery the tick never delivers.
  it("projects recovery at the turn processor's own drift step", () => {
    expect(forceReadiness([u(60)])).toEqual({
      readiness: 60,
      recovery: { perTurn: READINESS_DRIFT_STEP, turnsToFull: 3 },
    });
  });

  it("promises nothing to a force already at its posture's baseline", () => {
    expect(forceReadiness([u(72)])).toEqual({ readiness: 72, recovery: null });
    expect(forceReadiness([u(95, "alert")])).toEqual({ readiness: 95, recovery: null });
  });

  it("averages across a mixed force, baselines included", () => {
    // Readiness 60/80 → 70; baselines standard 72 / forward 84 → 78.
    expect(forceReadiness([u(60, "standard"), u(80, "forward")])).toEqual({
      readiness: 70,
      recovery: { perTurn: 4, turnsToFull: 2 },
    });
  });

  it("falls back to the standard baseline for an unrecognised posture", () => {
    expect(forceReadiness([u(60, "improvised")])).toEqual({
      readiness: 60,
      recovery: { perTurn: 4, turnsToFull: 3 },
    });
  });

  // The projection and the tick read the SAME baseline. If arrears suppress the real
  // target and this kept quoting the unsuppressed one, the record would promise a
  // recovery that never arrives — the exact thing the block above exists to prevent.
  it("projects against the arrears-suppressed baseline, not the nominal one", () => {
    // 40 is below BOTH the nominal 72 and the fully-suppressed 47, so both sides still
    // recover — but the starved force recovers to a lower ceiling and gets there sooner.
    const funded = forceReadiness([u(40)], 0);
    const starved = forceReadiness([u(40)], 1);
    expect(funded!.recovery!.turnsToFull).toBe(8);
    expect(starved!.recovery!.turnsToFull).toBe(2);
  });

  it("promises nothing to a force already above its suppressed baseline", () => {
    // 60 is below the nominal 72 but above the fully-suppressed target, so the honest
    // answer is "no recovery" rather than a gain the tick will not deliver.
    expect(forceReadiness([u(60)], 1)).toEqual({ readiness: 60, recovery: null });
  });

  it("defaults to no arrears so existing callers are unchanged", () => {
    expect(forceReadiness([u(60)])).toEqual(forceReadiness([u(60)], 0));
  });
});

describe("recoveringCount", () => {
  const u = (readiness: number, posture = "standard") => ({ readiness, posture }) as never;

  it("counts formations below their posture baseline", () => {
    expect(recoveringCount([u(60), u(72), u(90)])).toBe(1);
  });

  // 60 is below the nominal 72 but above the fully-suppressed 47, so a starved force
  // is NOT recovering — it is already at its floor.
  it("does not count formations that arrears have already floored", () => {
    expect(recoveringCount([u(60)], 0)).toBe(1);
    expect(recoveringCount([u(60)], 1)).toBe(0);
  });

  it("defaults to no arrears", () => {
    expect(recoveringCount([u(60)])).toBe(recoveringCount([u(60)], 0));
  });

  it("is zero for an empty force", () => {
    expect(recoveringCount([])).toBe(0);
  });
});

/**
 * The offensive list showed "resolved T448" — that the turn processor reached the
 * declaration, not what it did with it. Paired with `buildRecordExtras` dropping
 * no-contact reports, a player who took ground unopposed saw a front that claimed
 * never to have been contested and a history that said nothing at all.
 */
describe("declarationOutcome", () => {
  const res = (win: boolean, verdict: string) =>
    ({ result: { win, verdict } }) as unknown as Parameters<typeof declarationOutcome>[0];

  it("names the verdict and who prevailed", () => {
    expect(declarationOutcome(res(true, "Decisive Victory"), "resolved")).toEqual({
      label: "Decisive Victory",
      declarerWon: true,
    });
    expect(declarationOutcome(res(false, "Rout"), "resolved")).toEqual({
      label: "Rout",
      declarerWon: false,
    });
  });

  it("calls an unopposed advance what it is — a win", () => {
    const report = { result: null, noContact: true, unopposedAdvance: true };
    expect(declarationOutcome(report, "resolved")).toEqual({
      label: "unopposed advance",
      declarerWon: true,
    });
  });

  // Nobody home AND the front did not move: it happened, but it settled nothing, so
  // it must not be coloured as either side's result.
  it("takes no side on a no-contact that moved nothing", () => {
    const report = { result: null, noContact: true, unopposedAdvance: false };
    expect(declarationOutcome(report, "resolved")).toEqual({
      label: "no contact",
      declarerWon: null,
    });
  });

  it("reports fizzled and pending without inventing a result", () => {
    expect(declarationOutcome(null, "fizzled")).toEqual({ label: "fizzled", declarerWon: null });
    expect(declarationOutcome(null, "pending")).toEqual({ label: "pending", declarerWon: null });
  });

  // An ally who joined someone else's push is not the principal of the merged
  // offensive, so no report is keyed to them. Say only what is known.
  it("falls back to 'resolved' when no report matched", () => {
    expect(declarationOutcome(null, "resolved")).toEqual({
      label: "resolved",
      declarerWon: null,
    });
  });
});

/**
 * The live T420 report (6a8fb6a1715ff52ed01059ce): DD and RU attacked US together.
 * The side result named DD alone and carried the coalition's 16,299 dead, so the war
 * log read "DD 16,299" when DD lost 5,360 and RU lost 10,939.
 */
function coalitionReport(over: Record<string, unknown> = {}): BattleReportDoc {
  const u = (id: string, name: string, country: string, casualties: number) => ({
    id,
    name,
    country,
    role: "line",
    dom: "ground",
    type: "Rifle Division",
    casualties,
    readiness: 50,
    xp: 4,
    promo: false,
  });
  return {
    _id: "rc",
    theaterId: THEATER,
    declarerCountry: "DD",
    targetCountry: "US",
    attackers: ["DD", "RU"],
    defenders: ["US"],
    turn: 420,
    result: {
      theaterId: THEATER,
      theaterName: "Front",
      verdict: "Victory",
      win: true,
      margin: 20,
      rounds: [],
      retreat: null,
      attacker: {
        country: "DD",
        power: 5000,
        loss: 16299,
        unitResults: [
          u("d1", "1. Mot-Schützendivision", "DD", 5360),
          u("r1", "3rd Guards Tank", "RU", 10939),
        ],
        contingents: [
          { country: "DD", power: 1650, loss: 5360 },
          { country: "RU", power: 3350, loss: 10939 },
        ],
      },
      defender: {
        country: "US",
        power: 2000,
        loss: 2313,
        unitResults: [u("a1", "3rd Infantry", "US", 2313)],
        contingents: [{ country: "US", power: 2000, loss: 2313 }],
      },
    },
    ...over,
  } as unknown as BattleReportDoc;
}

const coalitionInput = (over: Partial<RecordExtrasInput> = {}): RecordExtrasInput => ({
  tier: "public",
  ownSide: null,
  theaterId: THEATER,
  sideACountries: ["DD", "RU"],
  sideBCountries: ["US"],
  units: [],
  reports: [coalitionReport()],
  ...over,
});

describe("buildRecordExtras — coalition attribution", () => {
  it("names every belligerent's own dead, not the principal's flag on all of them", () => {
    const b = buildRecordExtras(coalitionInput()).battles[0];
    expect(b.attackerLosses).toEqual([
      { country: "DD", loss: 5360 },
      { country: "RU", loss: 10939 },
    ]);
    expect(b.defenderLosses).toEqual([{ country: "US", loss: 2313 }]);
  });

  it("falls back to the principal on a report written before contingents existed", () => {
    const legacy = coalitionReport();
    // Strip what the pre-coalition documents never carried.
    delete (legacy.result!.attacker as unknown as Record<string, unknown>).contingents;
    delete (legacy.result!.defender as unknown as Record<string, unknown>).contingents;
    const b = buildRecordExtras(coalitionInput({ reports: [legacy] })).battles[0];
    expect(b.attackerLosses).toEqual([{ country: "DD", loss: 16299 }]);
    expect(b.defenderLosses).toEqual([{ country: "US", loss: 2313 }]);
  });

  it("gives an allied non-principal its own roster at command tier", () => {
    // RU fought this battle and is on side A, but DD is the principal. Filtering
    // rosters by the side's scalar country handed RU nothing at all.
    const x = buildRecordExtras(
      coalitionInput({ tier: "command", ownSide: "A", sideACountries: ["RU"] })
    );
    const rosters = x.battles[0].rosters!;
    expect(rosters.map((r) => r.country)).toEqual(["RU"]);
    expect(rosters[0].units[0].name).toBe("3rd Guards Tank");
    expect(JSON.stringify(rosters)).not.toMatch(/3rd Infantry/);
  });

  it("splits the archive tier's rosters per nation, each with its own strength", () => {
    const x = buildRecordExtras(coalitionInput({ tier: "archive", ownSide: null }));
    const rosters = x.battles[0].rosters!;
    expect(rosters.map((r) => r.country)).toEqual(["DD", "RU", "US"]);
    expect(rosters.find((r) => r.country === "RU")!.power).toBe(3350);
    expect(x.battles[0].rostersWithheld).toBe(false);
  });

  it("flags the enemy roster as withheld at command tier even when own side has two", () => {
    // The old renderer inferred "withheld" from a roster count of 1, which a
    // two-nation coalition breaks: it would show both allies and claim nothing
    // was hidden.
    const x = buildRecordExtras(
      coalitionInput({ tier: "command", ownSide: "A", sideACountries: ["DD", "RU"] })
    );
    expect(x.battles[0].rosters!.map((r) => r.country)).toEqual(["DD", "RU"]);
    expect(x.battles[0].rostersWithheld).toBe(true);
  });
});

describe("buildRecordExtras - enemy band and naval reach", () => {
  /** A defender whose force at the front is mostly hulls. */
  const navalInput = (seaAccess: boolean | undefined) =>
    input({
      tier: "command",
      ownSide: "A",
      seaAccess,
      units: [
        unit({ _id: "own1", countryId: "US", domain: "ground", type: "Armored Division" }),
        unit({ _id: "cn1", countryId: "CN", domain: "naval", type: "Carrier Strike Group" }),
        unit({ _id: "cn2", countryId: "CN", domain: "naval", type: "Frigate Squadron" }),
        unit({ _id: "cn3", countryId: "CN", domain: "naval", type: "Frigate Squadron" }),
      ],
    });

  it("reads an enemy fleet as weaker at a front it cannot reach", () => {
    // The war room's odds come from battleForecast and are reach-aware. If this page
    // kept reading raw power, the two surfaces would disagree about the same fleet.
    const coastal = buildRecordExtras(navalInput(true)).enemyBand;
    const inland = buildRecordExtras(navalInput(false)).enemyBand;
    expect(coastal).toBeDefined();
    expect(inland).toBeDefined();
    expect(inland).not.toBe(coastal);
  });

  it("still produces a band when the caller omits sea access", () => {
    // Older callers pass nothing; that must degrade to the inland read, not throw.
    expect(buildRecordExtras(navalInput(undefined)).enemyBand).toBeDefined();
  });
});
