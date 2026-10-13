import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { DiplomaticActionBudget } from "@/lib/db/types/diplomaticAction";
import {
  DIPLOMATIC_ACTIONS_PER_TURN,
  ORG_HEAD_AGENDA_ACTIONS_PER_TURN,
} from "@/lib/constants/internationalOrganizations";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/requireForeignMinister", () => ({ requireForeignMinister: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/countryAccess", () => ({ isCountryEnabledForPlayers: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/service", () => ({
  loadOrganizationDef: vi.fn(),
  isMember: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));
vi.mock("@/lib/internationalOrganizations/commands/proposeLegislation", () => ({
  proposeOrganizationLegislation: vi.fn(),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
const { requireForeignMinister } = await import("@/lib/api/requireForeignMinister");
const { isCountryEnabledForPlayers } = await import("@/lib/countryAccess");
const { loadOrganizationDef, isMember } = await import("@/lib/internationalOrganizations/service");
const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
const { proposeOrganizationLegislation } =
  await import("@/lib/internationalOrganizations/commands/proposeLegislation");
const { getDiplomaticActionsRemaining } =
  await import("@/lib/internationalOrganizations/diplomaticActions");
const { getOrgHeadAgendaRemaining } =
  await import("@/lib/internationalOrganizations/orgHeadAgenda");

/**
 * Stateful in-memory collections (the shared MockDb is stateless): the
 * `diplomaticActions` and `orgHeadAgendaActions` budgets, plus a seeded
 * `organizationLeadership` for the head lookup. Filters match plain equality,
 * `$ne: null` and `$nin`, which is all the budget paths use.
 */
type Row = Record<string, unknown>;
function same(a: unknown, b: unknown): boolean {
  return String(a) === String(b);
}
function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === "object" && !(cond instanceof ObjectId)) {
      const c = cond as { $ne?: unknown; $nin?: unknown[] };
      if ("$ne" in c) return c.$ne === null ? value != null : !same(value, c.$ne);
      if (c.$nin) return !c.$nin.some((v) => same(v, value));
    }
    return same(value, cond);
  });
}
function makeDb(
  seed: DiplomaticActionBudget[] = [],
  extra: { leadership?: Row[]; agenda?: Row[] } = {}
): Db {
  const stores: Record<string, Row[]> = {
    diplomaticActions: [...(seed as unknown as Row[])],
    orgHeadAgendaActions: [...(extra.agenda ?? [])],
    organizationLeadership: [...(extra.leadership ?? [])],
  };
  const collection = (name: string) => {
    const rows = (stores[name] ??= []);
    return {
      async findOne(filter: Row) {
        const row = rows.find((r) => matches(r, filter));
        return row ? { ...row } : null;
      },
      find(filter: Row) {
        return { toArray: async () => rows.filter((r) => matches(r, filter)) };
      },
      async updateOne(
        filter: Row,
        update: { $set?: Row; $setOnInsert?: Row },
        opts?: { upsert?: boolean }
      ) {
        let row = rows.find((r) => matches(r, filter));
        if (!row) {
          if (!opts?.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          row = { _id: new ObjectId(), ...filter, ...update.$setOnInsert, ...update.$set };
          rows.push(row);
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
        }
        if (update.$set) Object.assign(row, update.$set);
        return { matchedCount: 1, modifiedCount: update.$set ? 1 : 0, upsertedCount: 0 };
      },
    };
  };
  return { collection } as unknown as Db;
}

function authAsDeForeignMinister() {
  const characterId = new ObjectId();
  vi.mocked(requireAuthWithCharacter).mockResolvedValue({
    ok: true,
    user: { userId: new ObjectId().toString(), character: { _id: characterId, name: "Klaus FM" } },
  } as never);
  vi.mocked(requireForeignMinister).mockResolvedValue({
    ok: true,
    auth: {
      countryId: "DE",
      positionId: "foreign_minister",
      characterId,
      characterName: "Klaus FM",
    },
  } as never);
  return characterId;
}

function request(
  body: Record<string, unknown> = { type: "free_trade_agreement", parties: ["DE", "IE"] }
) {
  return new Request("http://localhost/api/country/de/international-organizations/EU/legislation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ code: "de", orgId: "EU" }) };

describe("legislation propose — diplomatic budget gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "EU", name: "European Union" } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(200);
    vi.mocked(proposeOrganizationLegislation).mockResolvedValue({
      ok: true,
      legislationId: new ObjectId().toString(),
    } as never);
    authAsDeForeignMinister();
  });

  it("rejects when no diplomatic actions remain", async () => {
    const db = makeDb([
      {
        _id: new ObjectId(),
        countryId: "DE",
        turn: 200,
        remaining: 0,
        updatedAt: new Date(),
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/legislation/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "No diplomatic actions remaining this turn." })
    );
    expect(proposeOrganizationLegislation).not.toHaveBeenCalled();
  });

  it("decrements the budget on a successful proposal", async () => {
    const db = makeDb();
    vi.mocked(getDb).mockResolvedValue(db);

    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/legislation/route");
    const res = await POST(request(), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(proposeOrganizationLegislation).toHaveBeenCalledTimes(1);
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(
      DIPLOMATIC_ACTIONS_PER_TURN - 1
    );
  });
});

describe("legislation propose — organisation head agenda pool", () => {
  const directive = { type: "directive", directiveKey: "common_market" };

  function authAsDeNonMinister() {
    const characterId = new ObjectId();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        character: { _id: characterId, name: "Helga President" },
      },
    } as never);
    vi.mocked(requireForeignMinister).mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    } as never);
    return characterId;
  }

  function seat(organizationId: string, characterId: ObjectId, countryId = "DE") {
    return { organizationId, holderCharacterId: characterId, holderCountryId: countryId };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isCountryEnabledForPlayers).mockResolvedValue(true);
    vi.mocked(loadOrganizationDef).mockResolvedValue({ id: "EU", name: "European Union" } as never);
    vi.mocked(isMember).mockResolvedValue(true);
    vi.mocked(getCurrentTurn).mockResolvedValue(200);
    vi.mocked(proposeOrganizationLegislation).mockResolvedValue({
      ok: true,
      legislationId: new ObjectId().toString(),
    } as never);
  });

  async function post(db: Db, body: Record<string, unknown> = directive) {
    vi.mocked(getDb).mockResolvedValue(db);
    const { POST } =
      await import("@/app/api/country/[code]/international-organizations/[orgId]/legislation/route");
    return POST(request(body), params);
  }

  it("lets a head who is not the foreign minister table a directive from the agenda pool", async () => {
    const headId = authAsDeNonMinister();
    const db = makeDb([], { leadership: [seat("EU", headId)] });

    const res = await post(db);

    expect(res.status).toBe(200);
    expect(vi.mocked(proposeOrganizationLegislation).mock.calls[0]![0].actor.characterId).toBe(
      headId
    );
    expect(await getOrgHeadAgendaRemaining(db, "EU", headId, 200)).toBe(
      ORG_HEAD_AGENDA_ACTIONS_PER_TURN - 1
    );
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);
  });

  it("spends the agenda pool before the country budget, then falls back", async () => {
    const headId = authAsDeForeignMinister();
    const db = makeDb([], {
      leadership: [seat("EU", headId)],
      agenda: [{ organizationId: "EU", characterId: headId, turn: 200, remaining: 1 }],
    });

    expect((await post(db)).status).toBe(200);
    expect(await getOrgHeadAgendaRemaining(db, "EU", headId, 200)).toBe(0);
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(DIPLOMATIC_ACTIONS_PER_TURN);

    expect((await post(db)).status).toBe(200);
    expect(await getOrgHeadAgendaRemaining(db, "EU", headId, 200)).toBe(0);
    expect(await getDiplomaticActionsRemaining(db, "DE", 200)).toBe(
      DIPLOMATIC_ACTIONS_PER_TURN - 1
    );
  });

  it("rejects a head-only actor once the agenda pool is empty", async () => {
    const headId = authAsDeNonMinister();
    const db = makeDb([], {
      leadership: [seat("EU", headId)],
      agenda: [{ organizationId: "EU", characterId: headId, turn: 200, remaining: 0 }],
    });

    const res = await post(db);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual(
      expect.objectContaining({ error: "No agenda actions remaining." })
    );
    expect(proposeOrganizationLegislation).not.toHaveBeenCalled();
  });

  it("refuses a non-minister who heads a different organisation", async () => {
    const headId = authAsDeNonMinister();
    const db = makeDb([], { leadership: [seat("NATO", headId)] });

    expect((await post(db)).status).toBe(403);
    expect(proposeOrganizationLegislation).not.toHaveBeenCalled();
  });

  it("refuses a non-minister with no leadership seat", async () => {
    authAsDeNonMinister();
    const db = makeDb([], { leadership: [seat("EU", new ObjectId())] });

    expect((await post(db)).status).toBe(403);
  });

  it("keeps war resolutions off the agenda pool", async () => {
    const headId = authAsDeNonMinister();
    const db = makeDb([], { leadership: [seat("EU", headId)] });

    const res = await post(db, { type: "join_conflict", theaterId: "theater-1", side: "A" });

    expect(res.status).toBe(403);
    expect(proposeOrganizationLegislation).not.toHaveBeenCalled();
  });

  it("only treats the head as sitting for their own member country", async () => {
    const headId = authAsDeNonMinister();
    const db = makeDb([], { leadership: [seat("EU", headId, "FR")] });

    expect((await post(db)).status).toBe(403);
  });
});
