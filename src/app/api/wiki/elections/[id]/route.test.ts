import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/wikiGuard", () => ({ checkWikiDisabled: vi.fn().mockResolvedValue(null) }));
beforeEach(() => vi.clearAllMocks());
it("serves a named snap-election recap with its finalized seats and votes", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  const id = new ObjectId();
  db.collection("elections").findOne.mockResolvedValue({
    _id: id,
    electionType: "snap_commons",
    countryId: "UK",
    state: "LON",
    status: "resolved",
    electionYear: 1978,
    cycle: 6,
    totalSeats: 91,
    endTime: new Date("2026-09-29T13:00:00Z"),
  });
  db.collection("states").findOne.mockResolvedValue({ _id: "LON", name: "London" });
  db.collection("electionVoteTallies").findOne.mockResolvedValue({
    totalVotes: { a: 60, b: 40 },
    candidateNames: { a: "Candidate A", b: "Candidate B" },
    candidateParties: { a: "Party A", b: "Party B" },
    seatsEstimate: { a: 55, b: 36 },
    finalized: true,
  });
  const response = await GET(new Request(`http://localhost/api/wiki/elections/${id}`), {
    params: Promise.resolve({ id: id.toString() }),
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.label).toBe("1978 London Snap Commons");
  expect(data.generalResults.finalized).toBe(true);
  expect(data.generalResults.seatsEstimate).toEqual({ a: 55, b: 36 });
});
