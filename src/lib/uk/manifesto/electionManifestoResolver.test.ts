import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectId } from "mongodb";
import {
  isManifestoVoteEffectEnabled,
  deriveGroupLeans,
  resolveElectionManifestoMultipliers,
} from "./electionManifestoResolver";

const OLD = process.env.UK_MANIFESTO_VOTE_EFFECT;
afterEach(() => {
  if (OLD === undefined) delete process.env.UK_MANIFESTO_VOTE_EFFECT;
  else process.env.UK_MANIFESTO_VOTE_EFFECT = OLD;
});

const categories = [
  {
    groups: [
      { id: "wealth:low", defaultEconomicLean: -3, defaultSocialLean: -1 },
      { id: "wealth:high", defaultEconomicLean: 3, defaultSocialLean: 1 },
    ],
  },
];

describe("isManifestoVoteEffectEnabled", () => {
  it("is off unless the flag is exactly '1'", () => {
    delete process.env.UK_MANIFESTO_VOTE_EFFECT;
    expect(isManifestoVoteEffectEnabled()).toBe(false);
    process.env.UK_MANIFESTO_VOTE_EFFECT = "true";
    expect(isManifestoVoteEffectEnabled()).toBe(false);
    process.env.UK_MANIFESTO_VOTE_EFFECT = "1";
    expect(isManifestoVoteEffectEnabled()).toBe(true);
  });
});

describe("deriveGroupLeans", () => {
  it("prefers state group leans, falls back to defaults", () => {
    const demographics = { groups: { "wealth:low": { economicLean: -4, socialLean: -2 } } };
    const leans = deriveGroupLeans(categories, demographics);
    expect(leans).toEqual([
      { id: "wealth:low", economicLean: -4, socialLean: -2 }, // from state
      { id: "wealth:high", economicLean: 3, socialLean: 1 }, // default
    ]);
  });
  it("de-duplicates group ids", () => {
    const cats = [categories[0], categories[0]];
    expect(deriveGroupLeans(cats, { groups: {} })).toHaveLength(2);
  });
});

describe("resolveElectionManifestoMultipliers", () => {
  const groups = [
    { id: "wealth:low", economicLean: -4, socialLean: -1 },
    { id: "wealth:high", economicLean: 4, socialLean: 1 },
  ];
  const baseArgs = {
    countryId: "UK" as const,
    electionId: new ObjectId(),
    isGeneralElection: true,
    groups,
  };

  it("returns undefined when the flag is off (no DB read)", async () => {
    delete process.env.UK_MANIFESTO_VOTE_EFFECT;
    const find = vi.fn();
    const db = { collection: vi.fn().mockReturnValue({ find }) };
    expect(await resolveElectionManifestoMultipliers(db as never, baseArgs)).toBeUndefined();
    expect(db.collection).not.toHaveBeenCalled();
  });

  it("returns undefined for non-UK or non-general even when enabled", async () => {
    process.env.UK_MANIFESTO_VOTE_EFFECT = "1";
    const db = { collection: vi.fn() };
    expect(
      await resolveElectionManifestoMultipliers(db as never, {
        ...baseArgs,
        countryId: "US" as never,
      })
    ).toBeUndefined();
    expect(
      await resolveElectionManifestoMultipliers(db as never, {
        ...baseArgs,
        isGeneralElection: false,
      })
    ).toBeUndefined();
  });

  it("builds multipliers from LOCKED manifestos with real catalog pledges", async () => {
    process.env.UK_MANIFESTO_VOTE_EFFECT = "1";
    const toArray = vi.fn().mockResolvedValue([
      { party: "lab", lockedAt: new Date(), pledges: [{ catalogEntryId: "uk.nhs.universal" }] },
      { party: "con", lockedAt: null, pledges: [{ catalogEntryId: "uk.economy.soundMoney" }] }, // draft, ignored
    ]);
    const db = { collection: vi.fn().mockReturnValue({ find: () => ({ toArray }) }) };
    const map = await resolveElectionManifestoMultipliers(db as never, baseArgs);
    expect(map).toBeDefined();
    expect(Object.keys(map!)).toEqual(["lab"]); // con was a draft
    expect(map!.lab["wealth:low"]).toBeGreaterThan(1); // NHS pledge pleases low-wealth
  });

  it("returns undefined when there are no locked manifestos", async () => {
    process.env.UK_MANIFESTO_VOTE_EFFECT = "1";
    const toArray = vi.fn().mockResolvedValue([{ party: "lab", lockedAt: null, pledges: [] }]);
    const db = { collection: vi.fn().mockReturnValue({ find: () => ({ toArray }) }) };
    expect(await resolveElectionManifestoMultipliers(db as never, baseArgs)).toBeUndefined();
  });
});
