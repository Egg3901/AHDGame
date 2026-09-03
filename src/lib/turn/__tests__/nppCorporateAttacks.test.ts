import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  selectAttackTarget,
  canAttack,
  runNppCorporateAttacks,
  formatNppSectorAttackDefenderMessage,
  ATTACK_COOLDOWN_TURNS,
  type AttackCandidate,
} from "../nppCorporateAttacks";

const AGGRESSIVE = { ambition: 85, stubbornness: 20, loyalty: 50 };
const CAUTIOUS = { ambition: 15, stubbornness: 15, loyalty: 50 };

function candidate(over: Partial<AttackCandidate> & { revenueAnchor: number }): AttackCandidate {
  const defenderId = new ObjectId();
  return {
    sector: {
      _id: new ObjectId(),
      stateId: "DC",
      sectorType: "technology",
      countryId: "US",
      revenue: over.revenueAnchor,
    },
    defender: {
      _id: defenderId,
      name: "Rival Inc",
      marketingStrength: 10,
      countryOwnerId: undefined,
      suspended: false,
      userId: new ObjectId(), // player-owned by default
      ceoVacant: false,
      ...(over.defender ?? {}),
    } as AttackCandidate["defender"],
    revenueAnchor: over.revenueAnchor,
  };
}

describe("selectAttackTarget (pure, owner-agnostic)", () => {
  const attackerId = new ObjectId();

  it("picks the highest-value rival sector (MS share × revenue)", () => {
    const small = candidate({ revenueAnchor: 100_000 });
    const big = candidate({ revenueAnchor: 900_000 });
    const chosen = selectAttackTarget(attackerId, 30, [small, big]);
    expect(chosen).toBe(big);
  });

  it("will target a player-owned corp (owner does not shield it)", () => {
    const playerCorp = candidate({ revenueAnchor: 500_000 });
    expect(playerCorp.defender.userId).toBeTruthy();
    expect(selectAttackTarget(attackerId, 50, [playerCorp])).toBe(playerCorp);
  });

  it("never targets own / state-owned / suspended / sub-threshold sectors", () => {
    const own = candidate({ revenueAnchor: 800_000 });
    (own.defender as { _id: ObjectId })._id = attackerId;
    const stateOwned = candidate({
      revenueAnchor: 800_000,
      defender: { countryOwnerId: "US" } as never,
    });
    const suspended = candidate({ revenueAnchor: 800_000, defender: { suspended: true } as never });
    const tiny = candidate({ revenueAnchor: 1_000 });
    expect(selectAttackTarget(attackerId, 50, [own, stateOwned, suspended, tiny])).toBeNull();
  });

  it("returns null when there are no candidates", () => {
    expect(selectAttackTarget(attackerId, 50, [])).toBeNull();
  });

  it("is owner-blind: revenue/MS decide, ownership never does (no-targeting invariant)", () => {
    // Two rivals, identical economics, differing ONLY in ownership. The bigger
    // sector must win regardless of which side is player-owned — proving the
    // owner flag does not enter the decision either way.
    const makePair = (playerIsBig: boolean) => {
      const big = candidate({ revenueAnchor: 800_000 });
      const small = candidate({ revenueAnchor: 200_000 });
      // userId distinguishes player-owned (set) from NPP-owned (null). selectAttackTarget
      // never reads it — that is exactly the invariant under test.
      (big.defender as { userId: ObjectId | null }).userId = playerIsBig ? new ObjectId() : null;
      (small.defender as { userId: ObjectId | null }).userId = playerIsBig ? null : new ObjectId();
      return { big, small };
    };
    const a = makePair(true);
    expect(selectAttackTarget(attackerId, 40, [a.small, a.big])).toBe(a.big);
    const b = makePair(false);
    expect(selectAttackTarget(attackerId, 40, [b.small, b.big])).toBe(b.big);
  });
});

describe("canAttack (pure aggression/cooldown/affordability gate)", () => {
  const base = {
    personality: AGGRESSIVE,
    lastAutoAttackTurn: undefined,
    currentTurn: 100,
    capitalAnchor: 1_000_000,
    attackCostAnchor: 50_000,
    marketingStrength: 30,
    msCost: 4,
  };

  it("allows an aggressive, funded, off-cooldown corp", () => {
    expect(canAttack(base)).toBe(true);
  });

  it("blocks a non-aggressive archetype", () => {
    expect(canAttack({ ...base, personality: CAUTIOUS })).toBe(false);
  });

  it("blocks while on cooldown, allows once elapsed", () => {
    expect(canAttack({ ...base, lastAutoAttackTurn: 100 - ATTACK_COOLDOWN_TURNS + 1 })).toBe(false);
    expect(canAttack({ ...base, lastAutoAttackTurn: 100 - ATTACK_COOLDOWN_TURNS })).toBe(true);
  });

  it("blocks when it cannot afford the cash cost", () => {
    expect(canAttack({ ...base, capitalAnchor: 10_000 })).toBe(false);
  });

  it("blocks when MS would drop below the reserve", () => {
    expect(canAttack({ ...base, marketingStrength: 5, msCost: 4 })).toBe(false);
  });
});

describe("formatNppSectorAttackDefenderMessage (suggestion #324)", () => {
  it("names attacker, amount, sector, and state, and says the $ is revenue", () => {
    const message = formatNppSectorAttackDefenderMessage({
      attackerName: "Attacker Corp",
      capturedAnchor: 123456,
      sectorLabel: "Technology",
      stateLabel: "California",
      plantsEnabled: false,
      capacityUnitsTaken: 0,
    });
    expect(message).toContain("Attacker Corp");
    expect(message).toContain("$123,456");
    expect(message).toContain("Technology");
    expect(message).toContain("California");
    expect(message).toContain("revenue");
  });

  it("clarifies the $ is NOT profit or sector value", () => {
    const message = formatNppSectorAttackDefenderMessage({
      attackerName: "Attacker Corp",
      capturedAnchor: 5000,
      sectorLabel: "Steel",
      stateLabel: "Ohio",
      plantsEnabled: false,
      capacityUnitsTaken: 0,
    });
    expect(message).toMatch(/not profit/i);
  });

  it("under plants reports capacity units with book value instead of revenue", () => {
    const message = formatNppSectorAttackDefenderMessage({
      attackerName: "Attacker Corp",
      capturedAnchor: 8000,
      sectorLabel: "Steel",
      stateLabel: "Ohio",
      plantsEnabled: true,
      capacityUnitsTaken: 12.5,
    });
    expect(message).toContain("12.5");
    expect(message).toContain("capacity units");
    expect(message).toContain("book value");
    expect(message).toContain("Steel");
    expect(message).toContain("Ohio");
    expect(message).not.toMatch(/of revenue/);
  });
});

describe("runNppCorporateAttacks (orchestrator)", () => {
  it("is a no-op when there are no NPP-run corps", async () => {
    const db = createMockDb();
    vi.mocked(db.collection("corporations").find).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    expect(await runNppCorporateAttacks(db as unknown as Db, 100, new Date())).toBe(0);
  });
});
