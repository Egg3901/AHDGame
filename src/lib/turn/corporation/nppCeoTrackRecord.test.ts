import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { buildCeoTrackRecordWrites } from "./nppCeoTrackRecord";

describe("buildCeoTrackRecordWrites", () => {
  const a = new ObjectId().toHexString();
  const b = new ObjectId().toHexString();

  it("writes one $set per NPP covering each sampled lane", () => {
    const writes = buildCeoTrackRecordWrites(
      [
        { nppId: a, lane: "energy", relMarginPp: 4 },
        { nppId: a, lane: "banking", relMarginPp: -2 },
        { nppId: b, lane: "energy", relMarginPp: 1 },
      ],
      new Map([[a, { energy: { turns: 24, relMarginPp: 0, lastTurn: 24 } }]]),
      48
    );
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      updateOne: {
        filter: { _id: new ObjectId(a) },
        update: {
          $set: {
            "ceoTrackRecord.energy": { turns: 48, relMarginPp: 2, lastTurn: 48 },
            "ceoTrackRecord.banking": { turns: 24, relMarginPp: -2, lastTurn: 48 },
          },
        },
      },
    });
  });

  it("skips a lane already sampled this turn", () => {
    const writes = buildCeoTrackRecordWrites(
      [{ nppId: a, lane: "energy", relMarginPp: 4 }],
      new Map([[a, { energy: { turns: 24, relMarginPp: 0, lastTurn: 48 } }]]),
      48
    );
    expect(writes).toEqual([]);
  });
});
