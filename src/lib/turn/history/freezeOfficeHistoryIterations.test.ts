import { describe, it, expect } from "vitest";
import { freezeOfficeHistoryIterations } from "./freezeOfficeHistoryIterations";

function makeDb(seed: Record<string, Array<Record<string, unknown>>>) {
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const [k, rows] of Object.entries(seed)) {
    data[k] = rows.map((r) => ({ ...r }));
  }
  return {
    data,
    collection: (name: string) => ({
      find: (filter: { iteration?: { $exists?: boolean } }) => ({
        toArray: async () => {
          const rows = data[name] ?? [];
          if (filter?.iteration && filter.iteration.$exists === false) {
            return rows.filter((d) => d.iteration === undefined);
          }
          return rows;
        },
      }),
      updateOne: async (filter: { _id: unknown }, update: { $set: Record<string, unknown> }) => {
        const row = (data[name] ?? []).find((d) => d._id === filter._id);
        if (row) Object.assign(row, update.$set);
      },
    }),
  } as never;
}

const anchor = {
  currentTurn: 100,
  lastTurnProcessed: new Date("2020-01-01T00:00:00Z"),
  startingYear: 2019,
};
const IT = { type: "Beta", number: 2 } as const;

const EMPTY_COLLECTIONS = {
  cabinetNominations: [],
  congressLeaders: [],
  speakerNominations: [],
  houseLeadershipNominations: [],
  senateLeadershipNominations: [],
};

describe("freezeOfficeHistoryIterations", () => {
  it("stamps only unstamped records with iteration + startingYear + confirmedTurn", async () => {
    const db = makeDb({
      countryHistory: [
        { _id: "c1", turn: 5 },
        { _id: "c2", iteration: IT, turn: 6 },
      ],
      cabinetMembers: [{ _id: "m1", confirmedAt: "2019-12-25T00:00:00Z" }],
      ...EMPTY_COLLECTIONS,
    });
    const res = await freezeOfficeHistoryIterations(db, IT, anchor);
    expect(res.countryHistory).toBe(1); // c2 already stamped, skipped
    const data = (db as unknown as { data: Record<string, Array<Record<string, unknown>>> }).data;
    expect(data.countryHistory[0].iteration).toEqual(IT);
    expect(data.countryHistory[0].iterationStartingYear).toBe(2019);
    expect(data.cabinetMembers[0].iteration).toEqual(IT);
    expect(typeof data.cabinetMembers[0].confirmedTurn).toBe("number");
  });

  it("dryRun counts without writing", async () => {
    const db = makeDb({
      countryHistory: [{ _id: "c1", turn: 5 }],
      cabinetMembers: [],
      ...EMPTY_COLLECTIONS,
    });
    const res = await freezeOfficeHistoryIterations(db, IT, anchor, { dryRun: true });
    expect(res.countryHistory).toBe(1);
    const data = (db as unknown as { data: Record<string, Array<Record<string, unknown>>> }).data;
    expect(data.countryHistory[0].iteration).toBeUndefined();
  });
});
