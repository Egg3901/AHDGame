import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  resolveSelfDealing,
  selfDealingFavorabilityPenalty,
  selfDealingDisclosure,
  MATERIAL_STAKE_SHARE,
  SELF_DEALING_BASE_PENALTY,
  SELF_DEALING_MAX_PENALTY,
} from "./defenceSelfDealing";

const MINISTER_USER = new ObjectId();
const MINISTER_CHAR = new ObjectId();
const OTHER_USER = new ObjectId();
const OTHER_CHAR = new ObjectId();

const corp = (over: Record<string, unknown> = {}) =>
  ({ userId: OTHER_USER, totalShares: 1_000, shareholders: [], ...over }) as never;

describe("resolveSelfDealing", () => {
  it("finds nothing on an arm's length award", () => {
    const r = resolveSelfDealing({
      corp: corp(),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBeNull();
    expect(r.stakeShare).toBe(0);
  });

  it("catches a minister awarding to a corporation they own", () => {
    const r = resolveSelfDealing({
      corp: corp({ userId: MINISTER_USER }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBe("owner");
  });

  // `userId` stays the APPOINTING owner while a caretaker runs the corporation, so installing
  // one cannot launder the relationship.
  it("still catches an owner who has installed a caretaker CEO", () => {
    const r = resolveSelfDealing({
      corp: corp({
        userId: MINISTER_USER,
        caretakerCeo: { underlyingUserId: MINISTER_USER },
      }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBe("owner");
  });

  it("catches a material shareholding short of ownership", () => {
    const r = resolveSelfDealing({
      corp: corp({ shareholders: [{ characterId: MINISTER_CHAR, shares: 200 }] }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBe("shareholding");
    expect(r.stakeShare).toBeCloseTo(0.2, 9);
  });

  // A token holding is not a conflict. Flagging every award where the minister happens to own
  // a handful of shares would make the disclosure meaningless, which is worse than no
  // disclosure at all.
  it("ignores a holding below the material threshold", () => {
    const shares = Math.floor(1_000 * MATERIAL_STAKE_SHARE) - 1;
    const r = resolveSelfDealing({
      corp: corp({ shareholders: [{ characterId: MINISTER_CHAR, shares }] }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBeNull();
  });

  it("does not attribute another character's holding to the minister", () => {
    const r = resolveSelfDealing({
      corp: corp({ shareholders: [{ characterId: OTHER_CHAR, shares: 900 }] }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.basis).toBeNull();
    expect(r.stakeShare).toBe(0);
  });

  it("sums a character's positions rather than reading only the first", () => {
    const r = resolveSelfDealing({
      corp: corp({
        shareholders: [
          { characterId: MINISTER_CHAR, shares: 30 },
          { characterId: OTHER_CHAR, shares: 500 },
          { characterId: MINISTER_CHAR, shares: 40 },
        ],
      }),
      ministerUserId: MINISTER_USER,
      ministerCharacterId: MINISTER_CHAR,
    });
    expect(r.stakeShare).toBeCloseTo(0.07, 9);
    expect(r.basis).toBe("shareholding");
  });

  it("reads an admin with no character as arm's length rather than throwing", () => {
    const r = resolveSelfDealing({ corp: corp(), ministerUserId: null, ministerCharacterId: null });
    expect(r.basis).toBeNull();
  });
});

describe("selfDealingFavorabilityPenalty", () => {
  const tranche = 1_000_000;

  it("charges almost nothing for a token order", () => {
    const p = selfDealingFavorabilityPenalty({ contractValue: 1, tranche });
    expect(p).toBeCloseTo(SELF_DEALING_BASE_PENALTY, 1);
  });

  it("scales with the share of the national tranche the order takes", () => {
    const small = selfDealingFavorabilityPenalty({ contractValue: tranche * 0.1, tranche });
    const large = selfDealingFavorabilityPenalty({ contractValue: tranche * 0.33, tranche });
    expect(large).toBeGreaterThan(small);
  });

  // Scrutiny, not execution: one award must not be able to end a character outright.
  it("is capped", () => {
    const p = selfDealingFavorabilityPenalty({ contractValue: tranche * 100, tranche });
    expect(p).toBeLessThanOrEqual(SELF_DEALING_MAX_PENALTY);
  });

  it("survives a tranche of zero without dividing by it", () => {
    const p = selfDealingFavorabilityPenalty({ contractValue: 5_000, tranche: 0 });
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeCloseTo(SELF_DEALING_BASE_PENALTY, 1);
  });
});

describe("selfDealingDisclosure", () => {
  it("names the minister, the interest, and the money", () => {
    const text = selfDealingDisclosure({
      basis: "shareholding",
      ministerName: "Ivan Petrov",
      corporationName: "Uralvagon",
      countryName: "the Soviet Union",
      lots: 250,
      value: 2_500_000,
      stakeShare: 0.34,
    });
    expect(text).toContain("Ivan Petrov");
    expect(text).toContain("34.0% of Uralvagon");
    expect(text).toContain("250");
    expect(text).toContain("2,500,000");
  });
});
