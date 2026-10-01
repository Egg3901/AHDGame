import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  buildUkSnapElectionRecapContent,
  runSeed1977UkSnapElectionRecap,
  UK_SNAP_RECAP_ENTITY_ID,
  UK_SNAP_RECAP_SLUG,
  type NationalElectionRecap,
} from "./2026-10-01-seed-1977-uk-snap-election-recap";

function cursor(rows: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) };
}

function election(
  year: number,
  type: "commons" | "snap_commons",
  cycle: number,
  state: string,
  totalSeats: number
) {
  return {
    _id: new ObjectId(),
    countryId: "UK",
    electionType: type,
    state,
    cycle,
    electionYear: year,
    status: "resolved",
    totalSeats,
    endTime: new Date(year === 1977 ? "2026-09-29T13:00:00Z" : "2026-09-25T16:00:00Z"),
  };
}

function tally(electionId: ObjectId, firstSeats: number, secondSeats: number, finalized = true) {
  return {
    electionId,
    totalVotes: { first: firstSeats * 1_000, second: secondSeats * 1_000 },
    candidateParties: { first: "1", second: "2" },
    seatsEstimate: { first: firstSeats, second: secondSeats },
    finalized,
  };
}

describe("1977 UK snap-election recap migration", () => {
  let db: MockDb;
  let currentRows: ReturnType<typeof election>[];
  let priorRows: ReturnType<typeof election>[];
  let tallies: ReturnType<typeof tally>[];

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    currentRows = [
      election(1977, "snap_commons", 6, "AAA", 6),
      election(1977, "snap_commons", 6, "BBB", 4),
    ];
    priorRows = [election(1975, "commons", 5, "AAA", 6), election(1975, "commons", 5, "BBB", 4)];
    tallies = [
      tally(currentRows[0]._id, 4, 2),
      tally(currentRows[1]._id, 2, 2),
      tally(priorRows[0]._id, 3, 3),
      tally(priorRows[1]._id, 1, 3),
    ];

    db.collection("wikiPages");
    db.collection("elections");
    db.collection("electionVoteTallies");
    db.collection("states");
    db.collection("politicalParties");
    db.collectionMocks.elections.find
      .mockReturnValueOnce(cursor(currentRows))
      .mockReturnValueOnce(cursor(priorRows));
    db.collectionMocks.electionVoteTallies.find.mockReturnValue(cursor(tallies));
    db.collectionMocks.states.find.mockReturnValue(
      cursor([
        { _id: "AAA", name: "Alpha", countryId: "UK" },
        { _id: "BBB", name: "Beta", countryId: "UK" },
      ])
    );
    db.collectionMocks.politicalParties.find.mockReturnValue(
      cursor([
        { sequentialId: 1, name: "Labour Party", abbreviation: "LAB" },
        { sequentialId: 2, name: "Conservative Party", abbreviation: "CON" },
      ])
    );
    db.collectionMocks.wikiPages.updateOne.mockResolvedValue({ upsertedCount: 1 });
  });

  it("dry-runs the certified aggregate without writing", async () => {
    const result = await runSeed1977UkSnapElectionRecap(db as unknown as Db, {
      dryRun: true,
    });

    expect(result.documentsInserted).toBe(0);
    expect(result.notes?.join(" ")).toContain("2 finalized regions");
    expect(db.collectionMocks.wikiPages.updateOne).not.toHaveBeenCalled();
  });

  it("inserts a published national snap-election recap", async () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const result = await runSeed1977UkSnapElectionRecap(db as unknown as Db, {
      dryRun: false,
      now,
    });

    expect(result.documentsInserted).toBe(1);
    const [filter, update, options] = db.collectionMocks.wikiPages.updateOne.mock.calls[0];
    expect(filter).toEqual({ slug: UK_SNAP_RECAP_SLUG });
    expect(options).toEqual({ upsert: true });
    expect(update.$setOnInsert).toMatchObject({
      slug: UK_SNAP_RECAP_SLUG,
      status: "published",
      private: false,
      countryId: "UK",
      autoGenerateConfig: { type: "election", entityId: UK_SNAP_RECAP_ENTITY_ID },
      createdAt: now,
      updatedAt: now,
    });
    expect(update.$setOnInsert.content).toContain(
      "The 1977 United Kingdom House of Commons election was a snap election."
    );
    expect(update.$setOnInsert.content).toContain("| LAB seats | 6 (+2) |");
    expect(update.$setOnInsert.content).toContain("| CON seats | 4 (-2) |");
  });

  it("preserves an existing recap without loading election data", async () => {
    db.collectionMocks.wikiPages.findOne.mockResolvedValue({
      slug: UK_SNAP_RECAP_SLUG,
      status: "published",
      private: false,
      content: "Human-edited recap",
    });

    const result = await runSeed1977UkSnapElectionRecap(db as unknown as Db, {
      dryRun: false,
    });

    expect(result.documentsInserted).toBe(0);
    expect(db.collectionMocks.elections.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.wikiPages.updateOne).not.toHaveBeenCalled();
  });

  it("refuses to publish an unfinalized regional tally", async () => {
    tallies[0] = tally(currentRows[0]._id, 4, 2, false);
    db.collectionMocks.electionVoteTallies.find.mockReturnValue(cursor(tallies));

    await expect(
      runSeed1977UkSnapElectionRecap(db as unknown as Db, { dryRun: true })
    ).rejects.toThrow("vote tally is not finalized");
    expect(db.collectionMocks.wikiPages.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a certified allocation that does not fill the chamber", async () => {
    tallies[0] = tally(currentRows[0]._id, 3, 2);
    db.collectionMocks.electionVoteTallies.find.mockReturnValue(cursor(tallies));

    await expect(
      runSeed1977UkSnapElectionRecap(db as unknown as Db, { dryRun: true })
    ).rejects.toThrow("allocates 5 of 6 seats");
  });

  it("refuses duplicate tally documents for the same regional election", async () => {
    tallies.push({ ...tallies[0] });
    db.collectionMocks.electionVoteTallies.find.mockReturnValue(cursor(tallies));

    await expect(
      runSeed1977UkSnapElectionRecap(db as unknown as Db, { dryRun: true })
    ).rejects.toThrow("duplicate vote tallies");
  });

  it("refuses a fractional certified vote count", async () => {
    tallies[0] = {
      ...tallies[0],
      totalVotes: { ...tallies[0].totalVotes, first: 4_000.5 },
    };
    db.collectionMocks.electionVoteTallies.find.mockReturnValue(cursor(tallies));

    await expect(
      runSeed1977UkSnapElectionRecap(db as unknown as Db, { dryRun: true })
    ).rejects.toThrow("invalid certified vote total");
  });
});

describe("buildUkSnapElectionRecapContent", () => {
  it("uses only ordinary hyphens in player-facing copy", () => {
    const party = {
      id: "1",
      name: "Labour Party",
      abbreviation: "LAB",
      seats: 10,
      votes: 10_000,
    };
    const region = {
      electionId: new ObjectId().toString(),
      code: "AAA",
      name: "Alpha",
      totalSeats: 10,
      parties: [party],
    };
    const current: NationalElectionRecap = {
      year: 1977,
      electionType: "snap_commons",
      endedAt: new Date("2026-09-29T13:00:00Z"),
      totalSeats: 10,
      totalVotes: 10_000,
      parties: [party],
      regions: [region],
    };
    const prior: NationalElectionRecap = {
      ...current,
      year: 1975,
      electionType: "commons",
    };

    const content = buildUkSnapElectionRecapContent(current, prior);

    expect(content).not.toMatch(/[–—]/u);
  });
});
