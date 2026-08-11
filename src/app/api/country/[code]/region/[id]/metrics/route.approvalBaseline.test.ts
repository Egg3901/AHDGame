import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  calculateStateApproval,
  computeNationalAveragesFromMetrics,
  buildFlatMetrics,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// CA is the target region; TX is another state in the country. Diffs are kept
// small (under the ~13% per-metric clamp) so the two candidate baselines yield
// *different* approval numbers: vs the CA/TX simple mean (5.0) CA is neutral,
// but vs the national doc (5.5) CA looks better — proving which baseline is used.
const ca = {
  _id: "CA",
  countryId: "US",
  economic: { unemploymentRate: { value: 5 } },
} as unknown as StateMetrics;
const tx = {
  _id: "TX",
  countryId: "US",
  economic: { unemploymentRate: { value: 5 } },
} as unknown as StateMetrics;
const federal = {
  _id: "federal",
  countryId: "US",
  economic: { unemploymentRate: { value: 5.5 } },
} as unknown as StateMetrics;

function cursorOf<T>(data: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(data),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

describe("region metrics route — approval baseline", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("macroMetrics");

    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      population: 1000,
    });
    db.collectionMocks.macroMetrics!.findOne.mockImplementation((filter: { _id: string }) =>
      Promise.resolve(filter._id === "CA" ? ca : filter._id === "federal" ? federal : null)
    );
    // The country-wide metrics fetch (drives the simple-mean approval baseline).
    db.collectionMocks.macroMetrics!.find.mockReturnValue(cursorOf([ca, tx]) as never);

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("scores approval against the simple mean of the country's states, not the national doc", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://localhost/api/country/us/region/CA/metrics"), {
      params: Promise.resolve({ code: "us", id: "CA" }),
    });
    const json = await res.json();

    const simpleMean = computeNationalAveragesFromMetrics([ca, tx]);
    // The route resolves preset from gameState; unmocked here → null, so mirror
    // that to compare like-for-like.
    const expected = calculateStateApproval(ca, simpleMean, [], undefined, null, null);
    const nationalDocBased = calculateStateApproval(
      ca,
      buildFlatMetrics(federal),
      [],
      undefined,
      null,
      null
    );

    expect(json.governmentApproval).toBeCloseTo(expected, 5);
    // Guard: the two baselines must actually differ, else the test proves nothing.
    expect(expected).not.toBeCloseTo(nationalDocBased, 5);
  });
});
