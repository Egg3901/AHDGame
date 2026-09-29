import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { applyUnionLawProvision, isUnionsBanned } from "@/lib/labour/unionLaws";
import { organizeUnderground } from "@/lib/unions/commands/organizeUnderground";
import { processUndergroundTurn } from "@/lib/turn/unions/undergroundTurn";
import {
  loadUndergroundStrengthByCountrySector,
  undergroundOutputFactor,
} from "@/lib/unions/undergroundEffects";
import {
  UNION_BAN_STRIKE_TEMPLATE_KEY,
  UNION_BAN_STRIKE_DURATION_TURNS,
} from "@/lib/crises/unionBanStrikeCopy";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { POST as enforce } from "@/app/api/country/[code]/union-enforcement/route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/events/substrate/rng", () => ({ seededRoll: () => 1 }));

function post(action: Record<string, unknown>) {
  return enforce(
    new Request("http://localhost/api/country/US/union-enforcement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }),
    { params: Promise.resolve({ code: "US" }) }
  );
}

describe("union ban lifecycle", () => {
  it("runs ban, drives, exposure, enforcement, crisis resistance, replay, and repeal on persisted state", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const unionId = new ObjectId();
    const leaderId = new ObjectId();
    const allyId = new ObjectId();
    const thirdId = new ObjectId();
    const executiveId = new ObjectId();
    const union: Union = {
      _id: unionId,
      countryId: "US",
      sectorType: "manufacturing",
      name: "US Manufacturing Workers",
      ownerId: leaderId,
      treasury: 1000,
      strength: 20,
      approval: 70,
      suspended: false,
      lastUndergroundRaidTurn: null,
      lastCalledStrikeTurn: null,
      demandedWageLevel: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Union;
    const leader = {
      _id: leaderId,
      name: "Leader",
      countryId: "US",
      actions: 10,
    } as Character;
    const ally = { ...leader, _id: allyId, name: "Ally" } as Character;
    const third = { ...leader, _id: thirdId, name: "Third" } as Character;
    const executive = {
      ...leader,
      _id: executiveId,
      name: "President",
      currentOffice: { type: "president" },
    } as Character;
    memory.seed("gameState", [{ _id: "current", currentTurn: 42 }]);
    memory.seed("federalBudget", [{ _id: getNationalBudgetId("US"), countryId: "US" }]);
    memory.seed("unions", [union]);
    memory.seed("characters", [leader, ally, third, executive]);
    memory.seed("crises", [
      {
        _id: new ObjectId(),
        templateKey: UNION_BAN_STRIKE_TEMPLATE_KEY,
        countryIds: ["US"],
        status: "active",
        durationTurns: UNION_BAN_STRIKE_DURATION_TURNS,
      },
    ]);
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "executive", character: executive },
    } as never);

    await applyUnionLawProvision(db, "US", { type: "union_law", bias: 0, banAction: "ban" });
    expect(await isUnionsBanned(db, "US")).toBe(true);
    expect((await memory.collection("unions").findOne({ _id: unionId }))?.suspended).toBe(true);

    const bannedUnion = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    const first = await organizeUnderground(db, leader, bannedUnion, "mass");
    const second = await organizeUnderground(db, ally, bannedUnion, "mass");
    const thirdDrive = await organizeUnderground(db, third, bannedUnion, "mass");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(thirdDrive.ok).toBe(true);
    expect((await organizeUnderground(db, leader, bannedUnion, "mass")).ok).toBe(false);
    const active = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(active.treasury).toBe(1000);
    expect(active.undergroundStrength).toBeGreaterThanOrEqual(15);
    expect(active.heat).toBeGreaterThanOrEqual(30);
    const crisis = await memory
      .collection("crises")
      .findOne({ templateKey: UNION_BAN_STRIKE_TEMPLATE_KEY });
    expect(crisis?.durationTurns).toBe(UNION_BAN_STRIKE_DURATION_TURNS + 1);
    const strengths = await loadUndergroundStrengthByCountrySector(db, new Set(["US"]));
    expect(undergroundOutputFactor(strengths.get("US:manufacturing") ?? 0)).toBeLessThan(1);

    const turn = await processUndergroundTurn(db, 42, new Set(["US"]));
    expect(turn.newlyExposed).toBe(1);
    const exposed = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(exposed.exposedUntilTurn).toBe(47);
    expect((await processUndergroundTurn(db, 42, new Set(["US"]))).newlyExposed).toBe(0);
    expect(await db.collection<Union>("unions").findOne({ _id: unionId })).toEqual(exposed);

    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "leader", character: leader },
    } as never);
    expect((await post({ action: "raid", unionId: unionId.toString() })).status).toBe(403);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "executive", character: executive },
    } as never);
    expect((await post({ action: "posture", posture: "crackdown" })).status).toBe(200);
    expect((await post({ action: "investigate", unionId: unionId.toString() })).status).toBe(200);
    const raid = await post({ action: "raid", unionId: unionId.toString() });
    expect(raid.status, JSON.stringify(await raid.json())).toBe(200);
    expect((await post({ action: "raid", unionId: unionId.toString() })).status).toBe(409);
    const raided = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(raided.undergroundStrength).toBeLessThan(exposed.undergroundStrength!);
    expect(raided.treasury).toBeLessThan(1000);
    expect(raided.undergroundFinesSeized).toBeGreaterThan(0);

    // Mongo matches an absent field against `{ field: null }`; this strict
    // in-memory adapter needs that legacy organizer field seeded explicitly.
    await memory
      .collection("unionOrganizers")
      .updateOne({ unionId, characterId: leaderId }, { $set: { lastProsecutedTurn: null } });
    const prosecution = await post({
      action: "prosecute",
      unionId: unionId.toString(),
      characterId: leaderId.toString(),
    });
    expect(prosecution.status, JSON.stringify(await prosecution.json())).toBe(200);
    await memory
      .collection("gameState")
      .updateOne({ _id: "current" }, { $set: { currentTurn: 43 } });
    const barredUnion = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect((await organizeUnderground(db, leader, barredUnion, "quiet")).status).toBe(403);

    await applyUnionLawProvision(db, "US", { type: "union_law", bias: 0, banAction: "repeal_ban" });
    const restored = (await db.collection<Union>("unions").findOne({ _id: unionId }))!;
    expect(await isUnionsBanned(db, "US")).toBe(false);
    expect(restored.suspended).toBe(false);
    expect(restored.strength).toBeGreaterThan(20);
    expect(restored.undergroundStrength).toBeUndefined();
    expect((await post({ action: "investigate", unionId: unionId.toString() })).status).toBe(409);
    expect((await organizeUnderground(db, leader, restored, "quiet")).status).toBe(403);
  });
});
