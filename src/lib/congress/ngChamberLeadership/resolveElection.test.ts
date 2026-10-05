import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { NgChamberLeadershipElection, NgChamberLeadershipResolution } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEvent: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: { leadership: 0x123456 },
}));
vi.mock("@/lib/congress/leadershipElections", () => ({
  vacateCongressLeadershipRole: vi.fn().mockResolvedValue(undefined),
  isLeadershipElectionClosed: vi.fn().mockReturnValue(true),
}));

const ROLE = "speaker_ng_reps" as const;
const WINNER_ID = new ObjectId();
const NOMINATION_ID = new ObjectId();
const STARTED_AT = new Date("2026-02-01T00:00:00.000Z");

function nomination(overrides: Record<string, unknown> = {}) {
  return {
    _id: NOMINATION_ID,
    role: ROLE,
    nomineeId: WINNER_ID,
    nomineeName: "Amina Yusuf",
    nomineeParty: "PDP",
    nomineeState: "Lagos",
    votesFor: 8,
    status: "voting",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    ...overrides,
  };
}

function election(
  overrides: Partial<NgChamberLeadershipElection> = {}
): NgChamberLeadershipElection {
  return {
    _id: ROLE,
    status: "voting",
    startedAt: STARTED_AT,
    endsAt: new Date("2026-02-02T00:00:00.000Z"),
    updatedAt: STARTED_AT,
    ...overrides,
  };
}

describe("resolveNgChamberLeadershipElection durable resolution", () => {
  let db: MockDb;
  let electionState: NgChamberLeadershipElection;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("ngChamberLeadershipElections");
    db.collection("ngChamberLeadershipNominations");
    db.collection("electedOfficials");
    db.collection("characters");
    electionState = election();
    db.collectionMocks.ngChamberLeadershipElections!.findOne.mockImplementation(async () =>
      structuredClone(electionState)
    );
    db.collectionMocks.ngChamberLeadershipElections!.updateOne.mockImplementation(
      async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
        const set = update.$set as Record<string, unknown>;
        if (filter.status === "voting") {
          if (
            electionState.status !== "voting" ||
            !(filter.startedAt instanceof Date) ||
            filter.startedAt.getTime() !== STARTED_AT.getTime()
          )
            return { matchedCount: 0, modifiedCount: 0 } as never;
          electionState = { ...electionState, ...set };
          return { matchedCount: 1, modifiedCount: 1 } as never;
        }
        if (filter.status === "closed") {
          const expectedResolution = filter["resolution.id"] as ObjectId;
          if (
            electionState.status !== "closed" ||
            !electionState.resolution?.id.equals(expectedResolution) ||
            electionState.resolution?.completedAt
          )
            return { matchedCount: 0, modifiedCount: 0 } as never;
          electionState = {
            ...electionState,
            resolution: {
              ...electionState.resolution!,
              ...(set["resolution.completedAt"]
                ? { completedAt: set["resolution.completedAt"] as Date }
                : {}),
            },
          };
          return { matchedCount: 1, modifiedCount: 1 } as never;
        }
        return { matchedCount: 0, modifiedCount: 0 } as never;
      }
    );
    db.collectionMocks.ngChamberLeadershipNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([nomination()]),
    } as never);
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue(null as never);
    db.collectionMocks.electedOfficials!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    } as never);
    db.collectionMocks.ngChamberLeadershipNominations!.updateOne.mockResolvedValue({
      matchedCount: 1,
      modifiedCount: 1,
    } as never);
    db.collectionMocks.ngChamberLeadershipNominations!.updateMany.mockResolvedValue({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    db.collectionMocks.characters!.findOne.mockResolvedValue(null as never);
  });

  it("claims the immutable winner before writes and omits an absent portrait", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );

    const electionUpdate =
      db.collectionMocks.ngChamberLeadershipElections!.updateOne.mock.calls[0]!;
    expect(electionUpdate[0]).toEqual({ _id: ROLE, status: "voting", startedAt: STARTED_AT });
    expect(electionUpdate[1]).toMatchObject({
      $set: {
        status: "closed",
        resolution: {
          winner: { _id: NOMINATION_ID, nomineeId: WINNER_ID, nomineeName: "Amina Yusuf" },
          resolvedAt: expect.any(Date),
          id: expect.any(ObjectId),
        },
      },
    });
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateOne).toHaveBeenCalledWith(
      { _id: NOMINATION_ID, role: ROLE },
      { $set: { status: "confirmed", updatedAt: expect.any(Date) } }
    );
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ createdAt: { $lte: expect.any(Date) } }),
      { $set: { status: "failed", updatedAt: expect.any(Date) } }
    );
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "NG",
      expect.not.objectContaining({ thumbnail: expect.anything() })
    );
  });

  it.each([
    {
      role: "speaker_ng_reps" as const,
      officeType: "speaker",
      label: "Speaker of the House of Representatives",
    },
    {
      role: "president_ng_senate" as const,
      officeType: "senatePresident",
      label: "President of the Senate",
    },
  ])(
    "publishes the $role winner with the exact office card and portrait",
    async ({ role, officeType, label }) => {
      const nomineeId = new ObjectId();
      electionState = election({ _id: role });
      db.collectionMocks.ngChamberLeadershipElections!.findOne.mockImplementation(async () =>
        structuredClone(electionState)
      );
      db.collectionMocks.ngChamberLeadershipNominations!.find.mockReturnValue({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          nomination({
            role,
            nomineeId,
            nomineeName: "Amina Yusuf",
            nomineeParty: "PDP",
            nomineeState: "Lagos",
          }),
        ]),
      } as never);
      db.collectionMocks.characters!.findOne.mockResolvedValue({
        _id: nomineeId,
        avatarUrl: "https://cdn.example/amina.png",
      } as never);
      const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
      const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");

      await expect(
        resolveNgChamberLeadershipElection(db as unknown as Db, role, true)
      ).resolves.toBe(true);

      expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(ObjectId) },
        expect.objectContaining({
          $set: expect.objectContaining({
            officeType,
            countryId: "NG",
            characterId: nomineeId,
            characterName: "Amina Yusuf",
            party: "PDP",
            state: "Lagos",
          }),
        }),
        { upsert: true }
      );
      expect(sendCountryGameEvent).toHaveBeenCalledWith("NG", {
        title: `Leadership Election Result: ${label}`,
        description: `**Amina Yusuf** has been elected as **${label}**.`,
        color: 0x123456,
        footer: { text: "A House Divided" },
        timestamp: electionState.resolution?.resolvedAt.toISOString(),
        thumbnail: { url: "https://cdn.example/amina.png" },
      });
    }
  );

  it("persists a winner before any side effects and retries that winner after a write failure", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    db.collectionMocks.ngChamberLeadershipNominations!.updateOne.mockRejectedValueOnce(
      new Error("temporary nomination write failure")
    );

    await expect(
      resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)
    ).rejects.toThrow("temporary nomination write failure");
    const persistedResolution = electionState.resolution;
    expect(persistedResolution?.winner?.nomineeId).toEqual(WINNER_ID);
    if (!persistedResolution) throw new Error("expected durable resolution");
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();

    db.collectionMocks.ngChamberLeadershipNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockRejectedValue(new Error("must not recompute winner")),
    } as never);
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.ngChamberLeadershipNominations!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: persistedResolution.id }),
      expect.objectContaining({ $set: expect.objectContaining({ characterId: WINNER_ID }) }),
      { upsert: true }
    );
  });

  it("does not write or read nominations when its initial close claim loses", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    db.collectionMocks.ngChamberLeadershipElections!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.ngChamberLeadershipNominations!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
  });

  it("makes completed elections no-ops without candidate reads or publication", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    electionState = election({
      status: "closed",
      resolution: {
        id: new ObjectId(),
        winner: null,
        resolvedAt: new Date(),
        completedAt: new Date(),
      },
    });
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      false
    );
    expect(db.collectionMocks.ngChamberLeadershipNominations!.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.ngChamberLeadershipElections!.updateOne).not.toHaveBeenCalled();
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("does not publish twice when the completion claim is already won", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const resolution: NgChamberLeadershipResolution = {
      id: new ObjectId(),
      winner: nomination(),
      resolvedAt: new Date(),
    };
    electionState = election({ status: "closed", resolution });
    db.collectionMocks.ngChamberLeadershipElections!.updateOne.mockResolvedValueOnce({
      matchedCount: 0,
      modifiedCount: 0,
    } as never);
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.electedOfficials!.updateOne).toHaveBeenCalledTimes(1);
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
  });

  it("does not write an older result over an office filled by a later election", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const laterElectedAt = new Date("2026-03-01T00:00:00.000Z");
    electionState = election({
      status: "closed",
      resolution: {
        id: new ObjectId(),
        winner: {
          _id: NOMINATION_ID,
          nomineeId: WINNER_ID,
          nomineeName: "Earlier Winner",
          nomineeParty: "PDP",
          nomineeState: "Lagos",
        },
        resolvedAt: new Date("2026-02-02T00:00:00.000Z"),
      },
    });
    db.collectionMocks.electedOfficials!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      electedAt: laterElectedAt,
    } as never);

    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
  });

  it("does no work when the election epoch changed before the close claim", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    electionState = election({ startedAt: new Date(STARTED_AT.getTime() + 1000) });
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.ngChamberLeadershipNominations!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateMany).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
  });

  it("completes an empty election without writing an official or publishing a card", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    db.collectionMocks.ngChamberLeadershipNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);
    await expect(resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true)).resolves.toBe(
      true
    );
    expect(db.collectionMocks.electedOfficials!.findOne).not.toHaveBeenCalled();
    expect(db.collectionMocks.electedOfficials!.updateOne).not.toHaveBeenCalled();
    expect(sendCountryGameEvent).not.toHaveBeenCalled();
    expect(electionState.resolution?.winner).toBeNull();
    expect(electionState.resolution?.completedAt).toBeInstanceOf(Date);
  });

  it("rendezvouses vote snapshots before claims and leaves the losing snapshot without writes", async () => {
    const { resolveNgChamberLeadershipElection } = await import("./resolveElection");
    const { sendCountryGameEvent } = await import("@/lib/discordWebhooks");
    const nomineeX = nomination({
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Candidate X",
      votesFor: 8,
    });
    const nomineeY = nomination({
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Candidate Y",
      votesFor: 7,
    });
    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.collectionMocks.ngChamberLeadershipNominations!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockImplementation(async () => {
        const snapshot = ++arrived === 1 ? [nomineeX, nomineeY] : [nomineeY, nomineeX];
        if (arrived === 2) release();
        await bothRead;
        return snapshot;
      }),
    } as never);
    const officialWrites: ObjectId[] = [];
    db.collectionMocks.electedOfficials!.updateOne.mockImplementation(
      async (_filter: unknown, update: { $set: { characterId: ObjectId } }) => {
        officialWrites.push(update.$set.characterId);
        return { matchedCount: 1, modifiedCount: 1 } as never;
      }
    );

    await Promise.all([
      resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true),
      resolveNgChamberLeadershipElection(db as unknown as Db, ROLE, true),
    ]);
    expect(officialWrites).toEqual([nomineeX.nomineeId]);
    expect(electionState).toMatchObject({
      resolution: { winner: { nomineeName: "Candidate X" }, completedAt: expect.any(Date) },
    });
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateOne).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.ngChamberLeadershipNominations!.updateMany).toHaveBeenCalledTimes(1);
    expect(sendCountryGameEvent).toHaveBeenCalledTimes(1);
    expect(sendCountryGameEvent).toHaveBeenCalledWith(
      "NG",
      expect.objectContaining({ description: expect.stringContaining("Candidate X") })
    );
  });
});
