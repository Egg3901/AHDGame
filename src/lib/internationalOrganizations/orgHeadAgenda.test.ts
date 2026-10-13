import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import {
  DIPLOMATIC_ACTIONS_PER_TURN,
  ORG_HEAD_AGENDA_ACTION_CAP,
  ORG_HEAD_AGENDA_ACTIONS_PER_TURN,
} from "@/lib/constants/internationalOrganizations";

vi.mock("@/lib/api/headOfGovernment", () => ({ getHeadOfGovernmentCharacterIds: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({ loadOrganizationDef: vi.fn() }));

const { getHeadOfGovernmentCharacterIds } = await import("@/lib/api/headOfGovernment");
const { loadOrganizationDef } = await import("@/lib/internationalOrganizations/service");
const {
  agendaRemainingFromRow,
  getOrgHeadAgendaRemaining,
  loadOrganizationHeads,
  loadOrgHeadAgendasForCharacter,
  resolveOrgProposalBudget,
  spendOrgHeadAgendaAction,
  spendOrgProposalBudget,
} = await import("./orgHeadAgenda");
const { getDiplomaticActionsRemaining } = await import("./diplomaticActions");

type Row = Record<string, unknown>;
const same = (a: unknown, b: unknown) => String(a) === String(b);
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return (cond as Row[]).some((f) => matches(row, f));
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      const c = cond as { $ne?: unknown; $nin?: unknown[] };
      if ("$ne" in c) return c.$ne === null ? value != null : !same(value, c.$ne);
      if (c.$nin) return !c.$nin.some((v) => same(v, value));
    }
    return same(value, cond);
  });
}

/** Stateful in-memory collections; the shared MockDb is stateless. */
function makeDb(seed: Record<string, Row[]> = {}): Db {
  const stores: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([name, rows]) => [name, [...rows]])
  );
  const collection = (name: string) => {
    const rows = (stores[name] ??= []);
    return {
      async findOne(filter: Row) {
        return rows.find((r) => matches(r, filter)) ?? null;
      },
      find(filter: Row) {
        return { toArray: async () => rows.filter((r) => matches(r, filter)) };
      },
      async updateOne(filter: Row, update: { $set: Row }, opts?: { upsert?: boolean }) {
        let row = rows.find((r) => matches(r, filter));
        if (!row) {
          if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0 };
          row = { _id: new ObjectId(), ...filter };
          rows.push(row);
        }
        Object.assign(row, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    };
  };
  return { collection } as unknown as Db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(new Map());
});

describe("agendaRemainingFromRow (lazy refresh)", () => {
  it("a head with no row starts with one turn of accrual", () => {
    expect(agendaRemainingFromRow(null, 10)).toBe(ORG_HEAD_AGENDA_ACTIONS_PER_TURN);
  });

  it("a current-turn row reports its balance", () => {
    expect(agendaRemainingFromRow({ turn: 10, remaining: 1 }, 10)).toBe(1);
    expect(agendaRemainingFromRow({ turn: 10, remaining: 0 }, 10)).toBe(0);
  });

  it("a stale row accrues the per-turn amount for every turn elapsed", () => {
    expect(agendaRemainingFromRow({ turn: 9, remaining: 0 }, 10)).toBe(2);
    expect(agendaRemainingFromRow({ turn: 9, remaining: 1 }, 10)).toBe(3);
  });

  it("never banks past the cap", () => {
    expect(agendaRemainingFromRow({ turn: 8, remaining: 1 }, 10)).toBe(ORG_HEAD_AGENDA_ACTION_CAP);
    expect(agendaRemainingFromRow({ turn: 1, remaining: 0 }, 100)).toBe(ORG_HEAD_AGENDA_ACTION_CAP);
    expect(agendaRemainingFromRow({ turn: 10, remaining: 99 }, 10)).toBe(
      ORG_HEAD_AGENDA_ACTION_CAP
    );
  });
});

describe("agenda pool (stateful)", () => {
  it("spends down within a turn and refuses when empty", async () => {
    const db = makeDb();
    const head = new ObjectId();
    expect((await spendOrgHeadAgendaAction(db, "UN", head, 10)).remaining).toBe(1);
    expect((await spendOrgHeadAgendaAction(db, "UN", head, 10)).remaining).toBe(0);
    expect(await spendOrgHeadAgendaAction(db, "UN", head, 10)).toEqual({
      ok: false,
      remaining: 0,
    });
  });

  it("refills by the per-turn amount on later turns, up to the cap", async () => {
    const db = makeDb();
    const head = new ObjectId();
    await spendOrgHeadAgendaAction(db, "UN", head, 10);
    await spendOrgHeadAgendaAction(db, "UN", head, 10);
    expect(await getOrgHeadAgendaRemaining(db, "UN", head, 11)).toBe(2);
    expect(await getOrgHeadAgendaRemaining(db, "UN", head, 12)).toBe(4);
    expect(await getOrgHeadAgendaRemaining(db, "UN", head, 50)).toBe(ORG_HEAD_AGENDA_ACTION_CAP);
  });

  it("keeps a separate pool per organisation and per holder", async () => {
    const db = makeDb();
    const head = new ObjectId();
    await spendOrgHeadAgendaAction(db, "UN", head, 10);
    expect(await getOrgHeadAgendaRemaining(db, "NATO", head, 10)).toBe(2);
    expect(await getOrgHeadAgendaRemaining(db, "UN", new ObjectId(), 10)).toBe(2);
  });
});

describe("loadOrganizationHeads", () => {
  it("reads elected heads from the leadership seat and skips vacancies", async () => {
    const sg = new ObjectId();
    const db = makeDb({
      organizationLeadership: [
        { organizationId: "UN", holderCharacterId: sg, holderCountryId: "SE" },
        { organizationId: "NATO", holderCharacterId: null, holderCountryId: null },
      ],
    });
    const heads = await loadOrganizationHeads(db);
    expect(heads).toEqual([{ organizationId: "UN", characterId: sg, countryId: "SE" }]);
  });

  it("derives a permanent-leadership head from the leader country's head of government", async () => {
    const pm = new ObjectId();
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(new Map([["UK", pm]]));
    const db = makeDb({
      // The stored placeholder for a permanent org is never read as the head.
      organizationLeadership: [
        {
          organizationId: "COMMONWEALTH",
          holderCharacterId: new ObjectId(),
          holderCountryId: "NG",
        },
      ],
      organizationMemberships: [{ organizationId: "COMMONWEALTH", countryId: "UK" }],
    });
    expect(await loadOrganizationHeads(db, { organizationId: "COMMONWEALTH" })).toEqual([
      { organizationId: "COMMONWEALTH", characterId: pm, countryId: "UK" },
    ]);
  });

  it("leaves a permanent seat vacant while the leader country is not a member", async () => {
    vi.mocked(getHeadOfGovernmentCharacterIds).mockResolvedValue(new Map([["UK", new ObjectId()]]));
    const db = makeDb({ organizationMemberships: [] });
    expect(await loadOrganizationHeads(db, { organizationId: "COMMONWEALTH" })).toEqual([]);
  });
});

describe("resolveOrgProposalBudget + spendOrgProposalBudget", () => {
  const base = { organizationId: "UN", countryId: "SE" as const, currentTurn: 10 };

  function dbWithHead(head: ObjectId, agendaRemaining?: number) {
    return makeDb({
      organizationLeadership: [
        { organizationId: "UN", holderCharacterId: head, holderCountryId: "SE" },
      ],
      orgHeadAgendaActions:
        agendaRemaining === undefined
          ? []
          : [{ organizationId: "UN", characterId: head, turn: 10, remaining: agendaRemaining }],
    });
  }

  it("charges the agenda pool first, then the country budget", async () => {
    const head = new ObjectId();
    const db = dbWithHead(head, 1);
    const args = {
      db,
      ...base,
      actorCharacterId: head,
      proposalType: "joint_statement" as const,
      countryAuthorized: true,
    };

    const first = await resolveOrgProposalBudget(args);
    expect(first).toMatchObject({ isOrgHead: true, source: "agenda", agendaRemaining: 1 });
    await spendOrgProposalBudget(db, first.source!, { ...base, characterId: head });

    const second = await resolveOrgProposalBudget(args);
    expect(second).toMatchObject({ source: "country", agendaRemaining: 0 });
    await spendOrgProposalBudget(db, second.source!, { ...base, characterId: head });
    expect(await getDiplomaticActionsRemaining(db, "SE", 10)).toBe(DIPLOMATIC_ACTIONS_PER_TURN - 1);
  });

  it("gives a head with no country authority nothing once the pool is spent", async () => {
    const head = new ObjectId();
    const budget = await resolveOrgProposalBudget({
      db: dbWithHead(head, 0),
      ...base,
      actorCharacterId: head,
      proposalType: "directive",
      countryAuthorized: false,
    });
    expect(budget).toMatchObject({ isOrgHead: true, source: null, countryRemaining: 0 });
  });

  it("does not treat a non-holder as head", async () => {
    const budget = await resolveOrgProposalBudget({
      db: dbWithHead(new ObjectId(), 4),
      ...base,
      actorCharacterId: new ObjectId(),
      proposalType: "directive",
      countryAuthorized: true,
    });
    expect(budget).toMatchObject({ isOrgHead: false, source: "country", agendaRemaining: 0 });
  });

  it("does not open the agenda pool for another organisation", async () => {
    const head = new ObjectId();
    const budget = await resolveOrgProposalBudget({
      db: dbWithHead(head, 4),
      ...base,
      organizationId: "NATO",
      actorCharacterId: head,
      proposalType: "directive",
      countryAuthorized: false,
    });
    expect(budget).toMatchObject({ isOrgHead: false, source: null });
  });

  it("keeps war resolutions on the country budget", async () => {
    const head = new ObjectId();
    const budget = await resolveOrgProposalBudget({
      db: dbWithHead(head, 4),
      ...base,
      actorCharacterId: head,
      proposalType: "declare_war",
      countryAuthorized: true,
    });
    expect(budget).toMatchObject({ isOrgHead: false, source: "country" });
  });
});

describe("loadOrgHeadAgendasForCharacter", () => {
  it("reports the office title and banked pool for each organisation headed", async () => {
    const head = new ObjectId();
    vi.mocked(loadOrganizationDef).mockResolvedValue({
      leadership: { title: "Secretary-General" },
    } as never);
    const db = makeDb({
      organizationLeadership: [
        { organizationId: "UN", holderCharacterId: head, holderCountryId: "SE" },
        { organizationId: "NATO", holderCharacterId: new ObjectId(), holderCountryId: "US" },
      ],
      orgHeadAgendaActions: [{ organizationId: "UN", characterId: head, turn: 9, remaining: 1 }],
    });
    expect(await loadOrgHeadAgendasForCharacter(db, head, 10)).toEqual([
      {
        organizationId: "UN",
        countryId: "SE",
        title: "Secretary-General",
        remaining: 3,
        cap: ORG_HEAD_AGENDA_ACTION_CAP,
        perTurn: ORG_HEAD_AGENDA_ACTIONS_PER_TURN,
      },
    ]);
  });
});
