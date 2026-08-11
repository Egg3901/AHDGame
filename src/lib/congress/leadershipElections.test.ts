import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { buildChamberLeadershipContext } from "@/lib/congress/leadership/rolePolicy";
import { isLeadershipElectionClosed } from "./leadershipElections";

vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({
    currentTurn: 100,
    effectiveNow: new Date("2026-05-30T12:00:00Z"),
    lastTurnProcessed: new Date("2026-05-30T12:00:00Z"),
    isActive: true,
    pausedAt: null,
  }),
}));

describe("isLeadershipElectionClosed — turn-based with endsAt fallback", () => {
  const now = new Date("2026-05-30T12:00:00Z");
  it("uses endsOnTurn when present: closed iff currentTurn >= endsOnTurn", () => {
    expect(
      isLeadershipElectionClosed({ endsOnTurn: 50, endsAt: new Date("2000-01-01") }, 49, now)
    ).toBe(false);
    expect(
      isLeadershipElectionClosed({ endsOnTurn: 50, endsAt: new Date("2100-01-01") }, 50, now)
    ).toBe(true);
  });
  it("freezes during pause: same currentTurn → same result regardless of real time", () => {
    const el = { endsOnTurn: 50, endsAt: new Date("2000-01-01") };
    expect(isLeadershipElectionClosed(el, 40, new Date("2030-01-01"))).toBe(false);
  });
  it("falls back to endsAt when endsOnTurn absent (pre-backfill docs)", () => {
    expect(isLeadershipElectionClosed({ endsAt: new Date("2026-05-30T13:00:00Z") }, 40, now)).toBe(
      false
    );
    expect(isLeadershipElectionClosed({ endsAt: new Date("2026-05-30T11:00:00Z") }, 40, now)).toBe(
      true
    );
  });
});

vi.mock("@/lib/db/partyMap", () => ({ getPartyMap: vi.fn().mockResolvedValue(new Map()) }));
vi.mock("@/lib/congress/houseComposition", () => ({ getHouseComposition: vi.fn() }));
vi.mock("@/lib/congress/senateComposition", () => ({ getSenateComposition: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { leadership: 0 },
}));

describe("triggerLeadershipElectionsAfterChamberVote", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();

    for (const name of [
      "congressLeaders",
      "electedOfficials",
      "characters",
      "houseLeadershipElections",
      "houseLeadershipNominations",
      "speakerElections",
      "speakerNominations",
      "senateLeadershipElections",
      "senateLeadershipNominations",
    ]) {
      db.collection(name);
    }

    db.collectionMocks["houseLeadershipElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["speakerElections"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["senateLeadershipElections"]!.findOne.mockResolvedValue(null);
  });

  it("auto-nominates a Speaker incumbent even when their party is no longer in the majority bloc", async () => {
    const incumbentId = new ObjectId();
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: { partySlugs: new Set(["MAJ"]), displayName: "Majority Bloc" },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      return (query as { role?: string }).role === "speaker_of_the_house"
        ? {
            role: "speaker_of_the_house",
            characterId: incumbentId,
            characterName: "Out Of Bloc Speaker",
            party: "OPP",
          }
        : null;
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "house",
      characterId: incumbentId,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentId,
      party: "OPP",
      homeState: "CA",
    });

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "house", new Date());

    expect(db.collectionMocks["speakerNominations"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ nomineeId: incumbentId, status: { $in: ["open", "voting"] } }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          nomineeId: incumbentId,
          nomineeParty: "OPP",
          nominatedByName: "Incumbent",
        }),
      }),
      { upsert: true }
    );
  });

  it("auto-nominates a Pro Tempore incumbent even when their party is no longer in the majority bloc", async () => {
    const incumbentId = new ObjectId();
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    vi.mocked(getSenateComposition).mockResolvedValue({
      majorityBloc: { partySlugs: new Set(["MAJ"]), displayName: "Majority Bloc" },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      return (query as { role?: string }).role === "president_pro_tempore"
        ? {
            role: "president_pro_tempore",
            characterId: incumbentId,
            characterName: "Out Of Bloc Pro Tempore",
            party: "OPP",
          }
        : null;
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "senate",
      characterId: incumbentId,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentId,
      party: "OPP",
      homeState: "AL",
    });

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "senate", new Date());

    expect(db.collectionMocks["senateLeadershipNominations"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "pro_tempore",
        nomineeId: incumbentId,
        status: { $in: ["open", "voting"] },
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          nomineeId: incumbentId,
          nomineeParty: "OPP",
          nominatedByName: "Incumbent",
          role: "pro_tempore",
        }),
      }),
      { upsert: true }
    );
  });

  it("does not auto-nominate a House Majority Leader incumbent from a coalition partner", async () => {
    const incumbentId = new ObjectId();
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 220,
      },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      return (query as { role?: string }).role === "majority_leader_house"
        ? {
            role: "majority_leader_house",
            characterId: incumbentId,
            characterName: "Coalition Partner Leader",
            party: "ALLY",
          }
        : null;
    });
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      officeType: "house",
      characterId: incumbentId,
    });
    db.collectionMocks["characters"]!.findOne.mockResolvedValue({
      _id: incumbentId,
      party: "ALLY",
      homeState: "TX",
    });

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "house", new Date());

    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("reopens the Senate Majority Leader race when the dominant majority party differs from the incumbent", async () => {
    const incumbentId = new ObjectId();
    const { getSenateComposition } = await import("@/lib/congress/senateComposition");
    vi.mocked(getSenateComposition).mockResolvedValue({
      majorityBloc: {
        partySlugs: new Set(["MAJ", "ALLY"]),
        displayName: "Unity Coalition",
        dominantPartySlug: "MAJ",
        dominantPartySeats: 54,
      },
      majorityParty: "MAJ",
      composition: [{ party: "MAJ" }, { party: "ALLY" }, { party: "OPP" }],
    } as never);

    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      return (query as { role?: string }).role === "majority_leader_senate"
        ? {
            role: "majority_leader_senate",
            characterId: incumbentId,
            characterName: "Coalition Partner Majority Leader",
            party: "ALLY",
          }
        : null;
    });

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "senate", new Date());

    expect(db.collectionMocks["senateLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "majority_leader" },
      expect.objectContaining({
        $set: expect.objectContaining({ _id: "majority_leader", status: "voting" }),
      }),
      { upsert: true }
    );
  });

  it("does not reopen House Speaker/Leader/Whip races when control hasn't changed (e.g. an unrelated single-seat special election resolved)", async () => {
    const speakerId = new ObjectId();
    const majLeaderId = new ObjectId();
    const minLeaderId = new ObjectId();
    const majWhipId = new ObjectId();
    const minWhipId = new ObjectId();
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: { partySlugs: new Set(["MAJ"]), displayName: "Majority Bloc" },
      majorityParty: "MAJ",
      minorityParty: "OPP",
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);

    const incumbentsByRole: Record<string, { characterId: ObjectId; party: string }> = {
      speaker_of_the_house: { characterId: speakerId, party: "MAJ" },
      majority_leader_house: { characterId: majLeaderId, party: "MAJ" },
      minority_leader_house: { characterId: minLeaderId, party: "OPP" },
      majority_whip_house: { characterId: majWhipId, party: "MAJ" },
      minority_whip_house: { characterId: minWhipId, party: "OPP" },
    };
    db.collectionMocks["congressLeaders"]!.findOne.mockImplementation(async (query) => {
      const role = (query as { role?: string }).role;
      const incumbent = role ? incumbentsByRole[role] : undefined;
      return incumbent ? { role, characterName: "Incumbent", ...incumbent } : null;
    });

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "house", new Date());

    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["houseLeadershipNominations"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["speakerElections"]!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks["speakerNominations"]!.updateOne).not.toHaveBeenCalled();
  });

  it("reopens the House Minority Leader race when the incumbent's seat is vacant", async () => {
    const { getHouseComposition } = await import("@/lib/congress/houseComposition");
    vi.mocked(getHouseComposition).mockResolvedValue({
      majorityBloc: { partySlugs: new Set(["MAJ"]), displayName: "Majority Bloc" },
      majorityParty: "MAJ",
      minorityParty: "OPP",
      composition: [{ party: "MAJ" }, { party: "OPP" }],
    } as never);

    // No incumbent recorded for any role — every role is currently vacant.
    db.collectionMocks["congressLeaders"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["electedOfficials"]!.findOne.mockResolvedValue(null);

    const { triggerLeadershipElectionsAfterChamberVote } = await import("./leadershipElections");
    await triggerLeadershipElectionsAfterChamberVote(db as unknown as Db, "house", new Date());

    expect(db.collectionMocks["houseLeadershipElections"]!.updateOne).toHaveBeenCalledWith(
      { _id: "minority_leader" },
      expect.objectContaining({
        $set: expect.objectContaining({ _id: "minority_leader", status: "voting" }),
      }),
      { upsert: true }
    );
  });
});

describe("clearIneligibleHouseLeadershipNominations", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    db.collection("houseLeadershipNominations");
  });

  it("fails minority_leader nominations whose party joined the majority bloc", async () => {
    const republicanNomId = new ObjectId();
    const democratNomId = new ObjectId();

    // Find() returns one republican (now-ineligible) and one democrat (still
    // eligible) nomination on the minority_leader role; all other role queries
    // return empty.
    db.collectionMocks["houseLeadershipNominations"]!.find.mockImplementation((query) => {
      const matchesMinority =
        (query as { role?: string }).role === "minority_leader" &&
        (query as { status?: { $in?: string[] } }).status?.$in?.includes("voting");
      const data = matchesMinority
        ? [
            { _id: republicanNomId, role: "minority_leader", nomineeParty: "republican" },
            { _id: democratNomId, role: "minority_leader", nomineeParty: "democrat" },
          ]
        : [];
      return { toArray: vi.fn().mockResolvedValue(data) } as unknown as ReturnType<
        typeof db.collectionMocks.houseLeadershipNominations.find
      >;
    });

    const ctx = buildChamberLeadershipContext({
      composition: [
        { party: "republican", partyName: "Republicans" },
        { party: "democrat", partyName: "Democrats" },
      ],
      majorityParty: "republican",
      majorityBloc: {
        kind: "party",
        id: "republican",
        displayName: "Republican Party",
        displayColor: "#FF0000",
        partySlugs: new Set(["republican"]),
        seats: 235,
        dominantPartySlug: "republican",
        dominantPartySeats: 235,
      },
    });

    const { clearIneligibleHouseLeadershipNominations } = await import("./leadershipElections");
    const now = new Date();
    await clearIneligibleHouseLeadershipNominations(db as unknown as Db, ctx, now);

    expect(db.collectionMocks["houseLeadershipNominations"]!.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [republicanNomId] } },
      { $set: { status: "failed", updatedAt: now } }
    );
  });

  it("is a no-op for any-seated policy roles (Speaker / Pro Tem / Bundestagspraesident)", async () => {
    // The function only iterates House election roles, none of which are
    // currently any-seated. But within the loop the early-`continue` for
    // any-seated should never call find()/updateMany() for those roles.
    // We assert that no updateMany is called when all nominations are eligible.
    db.collectionMocks["houseLeadershipNominations"]!.find.mockImplementation(() => ({
      toArray: vi.fn().mockResolvedValue([]),
    }));

    const ctx = buildChamberLeadershipContext({
      composition: [{ party: "republican" }, { party: "democrat" }],
      majorityParty: "republican",
      majorityBloc: null,
    });

    const { clearIneligibleHouseLeadershipNominations } = await import("./leadershipElections");
    await clearIneligibleHouseLeadershipNominations(db as unknown as Db, ctx, new Date());

    expect(db.collectionMocks["houseLeadershipNominations"]!.updateMany).not.toHaveBeenCalled();
  });
});
