import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import {
  defaultRulesetForParty,
  getOrSeedPartyLeadership,
  historyEntry,
  leadershipDocId,
  partyFamilyKeyFor,
  pushHistoryEntry,
} from "./leadershipStore";
import { DEFAULT_CON_RULESET, DEFAULT_LAB_RULESET } from "./leadershipRemoval";
import { createFakeLeadershipDb } from "./leadershipTestDb";
import type { PoliticalParty } from "@/lib/db/types";

function party(overrides: Partial<PoliticalParty> = {}): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId: 2,
    countryId: "UK",
    name: "Conservative Party",
    abbreviation: "CON",
    color: "#0087DC",
    economicPosition: 2,
    socialPosition: 2,
    chairId: null,
    viceChairId: null,
    treasurerId: null,
    committeeIds: [],
    memberCount: 0,
    isDefault: true,
    createdBy: null,
    treasury: 0,
    nationalTaxRate: 0,
    politicalStrength: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as PoliticalParty;
}

describe("partyFamilyKeyFor", () => {
  it("maps abbreviations across presets", () => {
    expect(partyFamilyKeyFor({ abbreviation: "LAB", name: "Labour Party" }).family).toBe("lab");
    expect(partyFamilyKeyFor({ abbreviation: "con", name: "Conservative Party" }).family).toBe(
      "con"
    );
  });

  it("falls back to name matching for renamed parties", () => {
    expect(partyFamilyKeyFor({ abbreviation: "X", name: "Labour Party" }).family).toBe("lab");
    expect(partyFamilyKeyFor({ abbreviation: "X", name: "Tory Reform" }).family).toBe("con");
  });

  it("treats anything else as other", () => {
    expect(partyFamilyKeyFor({ abbreviation: "SNP", name: "Scottish National Party" }).family).toBe(
      "other"
    );
  });
});

describe("defaultRulesetForParty", () => {
  it("seeds CON and LAB starting configs", () => {
    const con = defaultRulesetForParty({ abbreviation: "CON", name: "Conservative Party" });
    expect(con.family).toBe("con");
    expect(con.ruleset).toEqual({ ...DEFAULT_CON_RULESET });
    expect(con.ruleset.electorate).toBe("mps");

    const lab = defaultRulesetForParty({ abbreviation: "LAB", name: "Labour Party" });
    expect(lab.family).toBe("lab");
    expect(lab.ruleset).toEqual({ ...DEFAULT_LAB_RULESET });
    expect(lab.ruleset.electorate).toBe("members");
  });

  it("copies the defaults so callers cannot mutate the shared config", () => {
    const con = defaultRulesetForParty({ abbreviation: "CON", name: "x" });
    con.ruleset.triggerThresholdPct = 0.99;
    expect(DEFAULT_CON_RULESET.triggerThresholdPct).toBe(0.15);
  });
});

describe("getOrSeedPartyLeadership", () => {
  it("persists CON defaults with the 1922 Committee on first touch", async () => {
    const db = createFakeLeadershipDb();
    const now = new Date();
    const doc = await getOrSeedPartyLeadership(db, "UK", party(), now, 100);
    expect(doc._id).toBe(leadershipDocId("UK", "2"));
    expect(doc.ruleset).toEqual({ ...DEFAULT_CON_RULESET });
    expect(doc.committeeName).toBe("1922 Committee");
    expect(doc.activeChallengeId).toBeNull();
    expect(doc.lastSurvivalTurn).toBeNull();
    expect(doc.history).toHaveLength(1);
    expect(doc.history[0].kind).toBe("seeded");

    const stored = await db.collection("ukPartyLeadership").findOne({ _id: doc._id });
    expect(stored?.ruleset).toEqual({ ...DEFAULT_CON_RULESET });
  });

  it("persists LAB defaults with the NEC", async () => {
    const db = createFakeLeadershipDb();
    const doc = await getOrSeedPartyLeadership(
      db,
      "UK",
      party({ sequentialId: 1, abbreviation: "LAB", name: "Labour Party" }),
      new Date(),
      100
    );
    expect(doc.ruleset).toEqual({ ...DEFAULT_LAB_RULESET });
    expect(doc.committeeName).toBe("National Executive Committee");
  });

  it("keeps committee-amended rules on later reads (no reseed clobber)", async () => {
    const db = createFakeLeadershipDb();
    const p = party();
    const first = await getOrSeedPartyLeadership(db, "UK", p, new Date(), 100);
    await db
      .collection("ukPartyLeadership")
      .updateOne(
        { _id: first._id },
        { $set: { ruleset: { ...first.ruleset, removalMajorityPct: 0.6 } } }
      );
    const second = await getOrSeedPartyLeadership(db, "UK", p, new Date(), 101);
    expect(second.ruleset.removalMajorityPct).toBe(0.6);
    expect(second.history).toHaveLength(1);
  });
});

describe("pushHistoryEntry", () => {
  it("bounds the trail at the cap, dropping the oldest first", async () => {
    const { LEADERSHIP_HISTORY_CAP } = await import("./rules");
    let history = [historyEntry(1, "seeded", "seed")];
    for (let turn = 2; turn <= LEADERSHIP_HISTORY_CAP + 10; turn++) {
      history = pushHistoryEntry(history, historyEntry(turn, "challengeBacked", `back ${turn}`));
    }
    expect(history).toHaveLength(LEADERSHIP_HISTORY_CAP);
    expect(history[0].detail).toBe(`back ${11}`);
    expect(history[history.length - 1].detail).toBe(`back ${LEADERSHIP_HISTORY_CAP + 10}`);
  });
});
