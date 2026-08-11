import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/referendum/secede/secedeRegion", () => ({
  secedeRegion: vi.fn().mockResolvedValue({ ok: true, report: { inserted: 7 } }),
}));

import { runReferendumActuation } from "./actuateReferendum";
import { secedeRegion } from "@/lib/referendum/secede/secedeRegion";
import { makeInMemoryStore } from "@/lib/test-utils/inMemoryStore";
import type { Referendum } from "@/lib/db/types/referendum";

// String ids: the in-memory store deep-clones via structuredClone, which would
// break ObjectId reference-equality between bill._id and ref.westminsterBillId.
function seed(billStatus: string) {
  const store = makeInMemoryStore({
    bills: [{ _id: "bill1", status: billStatus }],
    referendums: [
      {
        _id: "ref1",
        kind: "independence",
        countryId: "UK",
        regionId: "SCO",
        targetCountryId: null,
        westminsterBillId: "bill1",
        status: "actuating",
      },
    ],
  });
  return { ...store, ref: store.cols.referendums[0] as unknown as Referendum };
}

describe("runReferendumActuation — independence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses when the Westminster consent bill is not signed", async () => {
    const { db, ref } = seed("active");
    const res = await runReferendumActuation(db, ref, 300);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not signed/i);
    expect(secedeRegion).not.toHaveBeenCalled();
  });

  it("secedes the region and completes the referendum when the bill is signed", async () => {
    const { db, cols, ref } = seed("signed");
    const res = await runReferendumActuation(db, ref, 300);
    expect(res.ok).toBe(true);
    expect(secedeRegion).toHaveBeenCalledWith(db, {
      regionId: "SCO",
      fromCountryId: "UK",
      currentTurn: 300,
    });
    expect(cols.referendums[0].status).toBe("completed");
  });

  it("returns the secedeRegion failure when the region can't stand up", async () => {
    vi.mocked(secedeRegion).mockResolvedValueOnce({ ok: false, skipped: "region-not-found" });
    const { db, ref } = seed("signed");
    const res = await runReferendumActuation(db, ref, 300);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/region-not-found/);
  });
});
