import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import {
  loadPactEntryWarnings,
  pactEntryWarnings,
  reconcileMutualDefence,
  resolveTreatyDefenders,
  selectTreatyDefenders,
  attackedOnTurnOf,
  type DefencePact,
  type MutualDefenceContext,
} from "../treatyDefence";
import { mutualDefenceBasis } from "@/lib/constants/mutualDefence";
import { postureWarEntryNote } from "@/lib/constants/orgPosture";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockRejectedValue(new Error("no db in test")) }));

// ── Organization defs: built-ins from the real constants, customs from a table ──
const customDefs = new Map<string, { id: string; name: string; category: string }>();
const historySpy = vi.fn();
vi.mock("@/lib/internationalOrganizations/service", async () => {
  const constants = await vi.importActual<
    typeof import("@/lib/constants/internationalOrganizations")
  >("@/lib/constants/internationalOrganizations");
  return {
    loadOrganizationDef: (_db: Db, id: string) =>
      Promise.resolve(
        (constants.INTERNATIONAL_ORGANIZATIONS as Record<string, unknown>)[id] ??
          customDefs.get(id) ??
          null
      ),
    recordOrgHistoryEvent: (...a: unknown[]) => {
      historySpy(...a);
      return Promise.resolve();
    },
  };
});

// Every country in these tests has a government unless a test says otherwise.
let disabled = new Set<string>();
vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: () =>
    Promise.resolve(
      Object.fromEntries(
        ["US", "UK", "FR", "DE", "RU", "DD", "PL", "CN", "JP", "IT"].map((id) => [
          id,
          { enabledForPlayers: !disabled.has(id) },
        ])
      )
    ),
}));

let blocs: Record<string, string> = {};
vi.mock("@/lib/military/blocLookup", () => ({
  loadMilitaryBlocRollForPreset: () => Promise.resolve({ blocs, namesByBloc: {} }),
}));

const mobilizeSpy = vi.fn();
vi.mock("@/lib/nppAutonomy/autonomousWarCommands", () => ({
  mobilizeImmediateWarEntry: (...a: unknown[]) => {
    mobilizeSpy(...a);
    return Promise.resolve(1);
  },
}));

const notifySpy = vi.fn();
vi.mock("@/lib/notifications", () => ({
  createNotifications: (...a: unknown[]) => {
    notifySpy(...a);
    return Promise.resolve();
  },
}));
// World News: the in-game feed and the Discord news channel.
const newsSpy = vi.fn();
const discordNewsSpy = vi.fn();
vi.mock("@/lib/news", () => ({
  createSystemNewsPost: (...a: unknown[]) => {
    newsSpy(...a);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/discordWebhooks", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/discordWebhooks")>("@/lib/discordWebhooks");
  return {
    DISCORD_COLORS: actual.DISCORD_COLORS,
    sendNewsEvent: (...a: unknown[]) => {
      discordNewsSpy(...a);
      return Promise.resolve(undefined);
    },
  };
});
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: () => Promise.resolve(null),
}));

// ── A small in-memory Db: equality, $in, $nin and $ne on top-level fields ──────
type Doc = Record<string, unknown>;
function matches(doc: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, cond]) => {
    if (key.startsWith("$") || key.includes(".")) return true; // re-checked in JS by callers
    const value = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      const c = cond as Doc;
      if ("$in" in c) return (c.$in as unknown[]).includes(value);
      if ("$nin" in c) return !(c.$nin as unknown[]).includes(value);
      if ("$ne" in c) return value !== c.$ne;
      if ("$gt" in c) return (value as number) > (c.$gt as number);
      return true;
    }
    return value === cond;
  });
}

let store: Record<string, Doc[]>;
const updateSpy = vi.fn();
function fakeDb(): Db {
  return {
    collection: (name: string) => {
      const rows = () => store[name] ?? [];
      const cursor = (q: Doc) => {
        const found = rows().filter((d) => matches(d, q));
        return {
          toArray: async () => found,
          project: () => ({ toArray: async () => found }),
        };
      };
      return {
        findOne: async (q: Doc) => rows().find((d) => matches(d, q)) ?? null,
        find: (q: Doc = {}) => cursor(q),
        updateOne: async (...a: unknown[]) => {
          updateSpy(name, ...a);
          return { modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
}

function membership(organizationId: string, countryId: string, joinedTurn = 0): Doc {
  return { organizationId, countryId, joinedTurn, status: "active" };
}

function world(opts: { preset?: string; coldWarEndedTurn?: number } = {}) {
  store.gameState = [
    {
      _id: "current",
      conflictsEnabled: true,
      preset: opts.preset ?? "2019-default",
      ...(opts.coldWarEndedTurn != null ? { coldWarEndedTurn: opts.coldWarEndedTurn } : {}),
    },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  customDefs.clear();
  disabled = new Set();
  blocs = {};
  store = {
    gameState: [],
    organizationPostures: [],
    organizationMemberships: [],
    truces: [],
    conflicts: [],
  };
  // A player-founded security pact: DD founded it, the UK joined later.
  customDefs.set("ndp", { id: "ndp", name: "Northern Defence Pact", category: "security" });
  world();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("mutualDefenceBasis: the rule is data", () => {
  it("binds a security org at Article 5 and at no other posture", () => {
    expect(mutualDefenceBasis({ category: "security", posture: "article5" })).toBe("posture");
    for (const posture of ["reduced", "standard", "heightened"] as const) {
      expect(mutualDefenceBasis({ category: "security", posture })).toBeNull();
    }
  });

  it("never binds a non-defensive category, whatever its posture", () => {
    for (const category of ["political", "economic", "development"] as const) {
      expect(mutualDefenceBasis({ category, posture: "article5" })).toBeNull();
      expect(
        mutualDefenceBasis({ category, posture: "article5", standingMutualDefence: true })
      ).toBeNull();
    }
  });

  it("honours a standing charter on a bloc at every posture, and only on a bloc", () => {
    expect(
      mutualDefenceBasis({ category: "bloc", posture: "standard", standingMutualDefence: true })
    ).toBe("charter");
    expect(
      mutualDefenceBasis({ category: "security", posture: "standard", standingMutualDefence: true })
    ).toBeNull();
  });

  it("carries NATO and the Warsaw Pact as data, not as ids in the rule", () => {
    expect(INTERNATIONAL_ORGANIZATIONS.NATO.standingMutualDefence).toBe(true);
    expect(INTERNATIONAL_ORGANIZATIONS.WARSAW_PACT.standingMutualDefence).toBe(true);
  });
});

describe("postureWarEntryNote follows the same rule", () => {
  it("tells a security org at Article 5 that members are brought in", () => {
    const note = postureWarEntryNote({ category: "security", posture: "article5" });
    expect(note).toMatch(/brings every other member/);
    expect(note).not.toMatch(/[\u2014\u2013]/);
  });

  it("tells a security org below Article 5 that nobody is brought in", () => {
    expect(postureWarEntryNote({ category: "security", posture: "heightened" })).toMatch(
      /Only Article 5 commits members/
    );
  });

  it("tells a political org it has no clause at all", () => {
    expect(postureWarEntryNote({ category: "political", posture: "article5" })).toMatch(
      /no mutual-defence clause/
    );
  });

  it("tells a chartered bloc it is bound at any posture", () => {
    expect(
      postureWarEntryNote({ category: "bloc", posture: "standard", standingMutualDefence: true })
    ).toMatch(/charter binds its members in any posture/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
function pact(
  organizationId: string,
  members: Record<string, number>,
  basis: DefencePact["basis"] = "posture"
): DefencePact {
  return {
    organizationId,
    organizationName: organizationId,
    basis,
    memberJoinedTurn: new Map(Object.entries(members)),
  };
}
function ctx(
  pacts: DefencePact[],
  extra: Partial<MutualDefenceContext> = {}
): MutualDefenceContext {
  return {
    pacts,
    blocs: {},
    enabled: new Set(["US", "UK", "FR", "DE", "RU", "DD", "PL", "CN", "JP", "IT"]),
    ...extra,
  };
}

describe("selectTreatyDefenders: eligibility", () => {
  it("enrols the defender's pact mates on the defence, excluding both principals", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 10 })]),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out.map((d) => [d.countryId, d.organizationId])).toEqual([["UK", "ndp"]]);
  });

  it("never reads the attacker's alliances as a reason to march", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 0 }), pact("other", { RU: 0, CN: 0 })]),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out.map((d) => d.countryId)).toEqual(["UK"]);
  });

  it("does nothing when the attacker is a member of the same alliance", () => {
    expect(
      selectTreatyDefenders({
        context: ctx([pact("ndp", { DD: 0, UK: 0, RU: 0 })]),
        defender: "DD",
        attackers: ["RU"],
      })
    ).toEqual([]);
  });

  it("does nothing when the defender is not a member", () => {
    expect(
      selectTreatyDefenders({
        context: ctx([pact("ndp", { UK: 0, FR: 0 })]),
        defender: "DD",
        attackers: ["RU"],
      })
    ).toEqual([]);
  });

  it("keeps out a member with no government", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 0, FR: 0 })], { enabled: new Set(["DD", "FR"]) }),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out.map((d) => d.countryId)).toEqual(["FR"]);
  });

  it("keeps out a member that shares a bloc with the attacker", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 0, PL: 0 })], { blocs: { PL: "east", RU: "east" } }),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out.map((d) => d.countryId)).toEqual(["UK"]);
  });

  it("keeps out a member bound to the attacker by another binding alliance", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 0, FR: 0 }), pact("east", { RU: 0, FR: 0 })]),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out.map((d) => d.countryId)).toEqual(["UK"]);
  });

  it("skips a country already on either roster, so nobody is on both sides", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 0, FR: 0 })]),
      defender: "DD",
      attackers: ["RU"],
      conflict: {
        sideA: { label: "A", countries: ["RU", "FR"], kind: "coalition" },
        sideB: { label: "B", countries: ["DD"], kind: "state" },
      },
    });
    expect(out.map((d) => d.countryId)).toEqual(["UK"]);
  });

  it("does not apply the pact to a war the defender brought with it into the alliance", () => {
    expect(
      selectTreatyDefenders({
        context: ctx([pact("ndp", { DD: 60, UK: 0 })]),
        defender: "DD",
        attackers: ["RU"],
        attackedOnTurn: 50,
      })
    ).toEqual([]);
  });

  it("does pull in an ally that joined the alliance after the attack began", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("ndp", { DD: 0, UK: 70 })]),
      defender: "DD",
      attackers: ["RU"],
      attackedOnTurn: 50,
    });
    expect(out.map((d) => d.countryId)).toEqual(["UK"]);
  });

  it("names the first alliance once when a country is bound twice", () => {
    const out = selectTreatyDefenders({
      context: ctx([pact("NATO", { DD: 0, UK: 0 }, "charter"), pact("ndp", { DD: 0, UK: 0 })]),
      defender: "DD",
      attackers: ["RU"],
    });
    expect(out).toEqual([
      { countryId: "UK", organizationId: "NATO", organizationName: "NATO", basis: "charter" },
    ]);
  });
});

describe("attackedOnTurnOf", () => {
  it("uses the latest attacker's entry, defaulting to the war's start", () => {
    expect(attackedOnTurnOf({ startTurn: 10, joinTurns: [] }, ["RU"])).toBe(10);
    expect(
      attackedOnTurnOf(
        {
          startTurn: 10,
          joinTurns: [
            { countryId: "RU", turn: 10, control: 50 },
            { countryId: "CN", turn: 30, control: 50 },
          ],
        },
        ["RU", "CN"]
      )
    ).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("resolveTreatyDefenders: loaded from organization data", () => {
  it("NATO/Warsaw Pact regression: a Cold War bloc's charter binds with no posture set", async () => {
    world({ preset: "1953-default" });
    store.organizationMemberships = [
      membership("WARSAW_PACT", "RU"),
      membership("WARSAW_PACT", "DD"),
      membership("WARSAW_PACT", "PL"),
      membership("NATO", "US"),
    ];
    const out = await resolveTreatyDefenders(fakeDb(), {
      defender: "DD",
      attackers: ["US"],
      currentTurn: 100,
    });
    expect(out.map((d) => [d.countryId, d.organizationId, d.basis])).toEqual([
      ["RU", "WARSAW_PACT", "charter"],
      ["PL", "WARSAW_PACT", "charter"],
    ]);
  });

  it("a modern-world NATO without Article 5 guarantees nothing", async () => {
    store.organizationMemberships = [membership("NATO", "US"), membership("NATO", "UK")];
    expect(
      await resolveTreatyDefenders(fakeDb(), { defender: "UK", attackers: ["RU"], currentTurn: 1 })
    ).toEqual([]);
  });

  it("a modern-world NATO at Article 5 binds through the same rule as any pact", async () => {
    store.organizationPostures = [{ organizationId: "NATO", posture: "article5" }];
    store.organizationMemberships = [membership("NATO", "US"), membership("NATO", "UK")];
    const out = await resolveTreatyDefenders(fakeDb(), {
      defender: "UK",
      attackers: ["RU"],
      currentTurn: 1,
    });
    expect(out.map((d) => [d.countryId, d.basis])).toEqual([["US", "posture"]]);
  });

  it("the charter lapses once the Cold War is resolved in game", async () => {
    world({ preset: "1953-default", coldWarEndedTurn: 500 });
    store.organizationMemberships = [
      membership("WARSAW_PACT", "RU"),
      membership("WARSAW_PACT", "DD"),
    ];
    expect(
      await resolveTreatyDefenders(fakeDb(), {
        defender: "DD",
        attackers: ["US"],
        currentTurn: 600,
      })
    ).toEqual([]);
  });

  it("a player-founded security org at Article 5 pulls its members in", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD", 1088), membership("ndp", "UK", 1163)];
    const out = await resolveTreatyDefenders(fakeDb(), {
      defender: "DD",
      attackers: ["RU"],
      currentTurn: 1256,
    });
    expect(out).toEqual([
      {
        countryId: "UK",
        organizationId: "ndp",
        organizationName: "Northern Defence Pact",
        basis: "posture",
      },
    ]);
  });

  it("the same org at a non-Article 5 posture pulls nobody in", async () => {
    store.organizationMemberships = [membership("ndp", "DD"), membership("ndp", "UK")];
    for (const posture of ["reduced", "standard", "heightened"]) {
      store.organizationPostures = [{ organizationId: "ndp", posture }];
      expect(
        await resolveTreatyDefenders(fakeDb(), {
          defender: "DD",
          attackers: ["RU"],
          currentTurn: 1,
        })
      ).toEqual([]);
    }
  });

  it("a political org at Article 5 pulls nobody in", async () => {
    customDefs.set("forum", { id: "forum", name: "Forum", category: "political" });
    store.organizationPostures = [{ organizationId: "forum", posture: "article5" }];
    store.organizationMemberships = [membership("forum", "DD"), membership("forum", "UK")];
    expect(
      await resolveTreatyDefenders(fakeDb(), { defender: "DD", attackers: ["RU"], currentTurn: 1 })
    ).toEqual([]);
  });

  it("skips an ally holding a live truce with the attacker", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [
      membership("ndp", "DD"),
      membership("ndp", "UK"),
      membership("ndp", "FR"),
    ];
    store.truces = [{ _id: "RU__UK", countries: ["RU", "UK"], expiresTurn: 200 }];
    const out = await resolveTreatyDefenders(fakeDb(), {
      defender: "DD",
      attackers: ["RU"],
      currentTurn: 100,
    });
    expect(out.map((d) => d.countryId)).toEqual(["FR"]);
  });

  it("skips an ally already fighting the attacker in another war", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD"), membership("ndp", "UK")];
    store.conflicts = [
      {
        _id: "elsewhere",
        status: "active",
        sideA: { countries: ["RU"] },
        sideB: { countries: ["UK"] },
      },
    ];
    expect(
      await resolveTreatyDefenders(fakeDb(), { defender: "DD", attackers: ["RU"], currentTurn: 1 })
    ).toEqual([]);
  });

  it("returns nothing when the conflicts subsystem is off", async () => {
    store.gameState = [{ _id: "current", conflictsEnabled: false }];
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD"), membership("ndp", "UK")];
    expect(
      await resolveTreatyDefenders(fakeDb(), { defender: "DD", attackers: ["RU"], currentTurn: 1 })
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
function declaredWar(overrides: Doc = {}): Doc {
  return {
    _id: "war_ru_dd",
    name: "Russia-East Germany War",
    hostCountry: "DD",
    type: "interstate",
    status: "active",
    createdBy: "player",
    startTurn: 1256,
    control: 50,
    sideA: { label: "Russia", countries: ["RU"], kind: "state" },
    sideB: { label: "East Germany", countries: ["DD"], kind: "state" },
    ...overrides,
  };
}

describe("reconcileMutualDefence: the per-turn sweep", () => {
  beforeEach(() => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD", 1088), membership("ndp", "UK", 1163)];
  });

  it("puts an ally into a war declared before the posture was raised, on the defending side", async () => {
    const war = declaredWar();
    store.conflicts = [war];
    const result = await reconcileMutualDefence(fakeDb(), 1262);
    expect(result.entered).toBe(1);
    expect((war.sideB as { countries: string[] }).countries).toEqual(["DD", "UK"]);
    expect((war.sideA as { countries: string[] }).countries).toEqual(["RU"]);
    expect(war.treatyEntries).toEqual([
      {
        countryId: "UK",
        organizationId: "ndp",
        organizationName: "Northern Defence Pact",
        basis: "posture",
        defending: "DD",
        joinedTurn: 1262,
      },
    ]);
    // The same entry primitive as the bloc collective-defence resolution: a real
    // reserve commitment, and a joinTurns stamp that weariness and approval read.
    expect(mobilizeSpy).toHaveBeenCalledWith(expect.anything(), "UK", war._id, 1262, "ndp");
    expect(war.joinTurns).toEqual([{ countryId: "UK", turn: 1262, control: 50 }]);
    expect(historySpy).toHaveBeenCalledWith(
      expect.anything(),
      "UK",
      1262,
      expect.stringContaining("Northern Defence Pact collective defence invoked"),
      expect.anything()
    );
  });

  it("is idempotent: a second sweep enrols nobody and writes nothing", async () => {
    const war = declaredWar();
    store.conflicts = [war];
    await reconcileMutualDefence(fakeDb(), 1262);
    updateSpy.mockClear();
    mobilizeSpy.mockClear();
    const second = await reconcileMutualDefence(fakeDb(), 1263);
    expect(second.entered).toBe(0);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mobilizeSpy).not.toHaveBeenCalled();
    expect((war.sideB as { countries: string[] }).countries).toEqual(["DD", "UK"]);
  });

  it("pulls in a country that joined the alliance mid-war", async () => {
    store.organizationMemberships.push(membership("ndp", "FR", 1300));
    const war = declaredWar({
      sideB: { label: "East Germany", countries: ["DD", "UK"], kind: "coalition" },
      joinTurns: [{ countryId: "UK", turn: 1262, control: 50 }],
    });
    store.conflicts = [war];
    const result = await reconcileMutualDefence(fakeDb(), 1301);
    expect(result.entered).toBe(1);
    expect((war.sideB as { countries: string[] }).countries).toEqual(["DD", "UK", "FR"]);
  });

  it("does not drag back an ally that already left this war", async () => {
    store.conflicts = [declaredWar({ joinTurns: [{ countryId: "UK", turn: 1262, control: 50 }] })];
    expect((await reconcileMutualDefence(fakeDb(), 1300)).entered).toBe(0);
  });

  it("never defends the attacker: a member who declared gets no allies", async () => {
    // DD declared on RU; the war is hosted in RU. DD's pact must not come in.
    store.conflicts = [
      declaredWar({
        _id: "war_dd_ru",
        hostCountry: "RU",
        sideA: { label: "East Germany", countries: ["DD"], kind: "state" },
        sideB: { label: "Russia", countries: ["RU"], kind: "state" },
      }),
    ];
    expect((await reconcileMutualDefence(fakeDb(), 1300)).entered).toBe(0);
  });

  it("does nothing when the attacker is a member of the same alliance", async () => {
    store.organizationMemberships.push(membership("ndp", "RU", 1000));
    store.conflicts = [declaredWar()];
    expect((await reconcileMutualDefence(fakeDb(), 1262)).entered).toBe(0);
  });

  it("does nothing once the posture drops below Article 5", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "heightened" }];
    store.conflicts = [declaredWar()];
    expect((await reconcileMutualDefence(fakeDb(), 1262)).entered).toBe(0);
  });

  it("does not apply the pact to a war the defender brought into the alliance", async () => {
    store.organizationMemberships = [membership("ndp", "DD", 1300), membership("ndp", "UK", 1163)];
    store.conflicts = [declaredWar()];
    expect((await reconcileMutualDefence(fakeDb(), 1301)).entered).toBe(0);
  });

  it("leaves wars that no declaration opened alone", async () => {
    store.conflicts = [declaredWar({ createdBy: "event" })];
    expect((await reconcileMutualDefence(fakeDb(), 1262)).entered).toBe(0);
  });

  it("leaves a war awaiting terms alone", async () => {
    store.conflicts = [declaredWar({ status: "terms_pending" })];
    expect((await reconcileMutualDefence(fakeDb(), 1262)).entered).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("World News on pact entry", () => {
  beforeEach(() => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD", 1088), membership("ndp", "UK", 1163)];
  });

  it("posts one dispatch naming the country, the war and the alliance", async () => {
    store.conflicts = [declaredWar()];
    await reconcileMutualDefence(fakeDb(), 1262);
    expect(newsSpy).toHaveBeenCalledTimes(1);
    const [body, category, options] = newsSpy.mock.calls[0] as [string, string, { title: string }];
    expect(category).toBe("general");
    expect(options.title).toBe(
      "United Kingdom enters the Russia-East Germany War under the Northern Defence Pact"
    );
    expect(body).toContain("Northern Defence Pact");
    expect(body).toContain("United Kingdom");
    expect(body).not.toMatch(/[\u2014\u2013]/);
    expect(discordNewsSpy).toHaveBeenCalledTimes(1);
  });

  it("posts nothing for an entry that already exists, on any later sweep", async () => {
    // The ally is already on the roster with a treaty entry written before this
    // feature: nothing new happens, so nothing is announced.
    store.conflicts = [
      declaredWar({
        sideB: { label: "East Germany", countries: ["DD", "UK"], kind: "coalition" },
        joinTurns: [{ countryId: "UK", turn: 1261 }],
        treatyEntries: [
          { countryId: "UK", organizationId: "ndp", defending: "DD", joinedTurn: 1261 },
        ],
      }),
    ];
    const result = await reconcileMutualDefence(fakeDb(), 1262);
    expect(result.entered).toBe(0);
    expect(newsSpy).not.toHaveBeenCalled();
    expect(discordNewsSpy).not.toHaveBeenCalled();
    expect(notifySpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("pactEntryWarnings: what an applicant is told", () => {
  it("lists each live declared war a binding alliance is defending", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "article5" }];
    store.organizationMemberships = [membership("ndp", "DD", 1088), membership("ndp", "UK", 1163)];
    store.conflicts = [{ ...declaredWar(), conflictId: 12 }];
    const byOrg = await loadPactEntryWarnings(fakeDb());
    expect(byOrg.get("ndp")).toEqual([
      {
        organizationId: "ndp",
        conflictId: "war_ru_dd",
        conflictNumber: 12,
        conflictName: "Russia-East Germany War",
        defendingCountryId: "DD",
      },
    ]);
  });

  it("warns nobody when the alliance is below Article 5", async () => {
    store.organizationPostures = [{ organizationId: "ndp", posture: "heightened" }];
    store.organizationMemberships = [membership("ndp", "DD"), membership("ndp", "UK")];
    store.conflicts = [declaredWar()];
    expect((await loadPactEntryWarnings(fakeDb())).size).toBe(0);
  });

  it("uses the same firing rule as enrolment: no warning for an attacker-member or a late member", () => {
    const front = {
      conflict: declaredWar() as never,
      side: "B" as const,
      hosts: ["DD" as const],
      attackers: ["RU" as const],
      attackedOnTurn: 1256,
    };
    expect(pactEntryWarnings({ pacts: [pact("ndp", { DD: 0, RU: 0 })] }, [front]).size).toBe(0);
    expect(pactEntryWarnings({ pacts: [pact("ndp", { DD: 1300 })] }, [front]).size).toBe(0);
    expect(pactEntryWarnings({ pacts: [pact("ndp", { DD: 0 })] }, [front]).get("ndp")).toHaveLength(
      1
    );
  });
});
