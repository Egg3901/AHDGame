/**
 * Integration test: runs the live-results endpoint against a real database
 * (read-only) to validate collection-shape assumptions the unit tests mock —
 * party color resolution, region name lookup, tally field names, and the
 * president per-unit branch. Skips when MONGODB_URI is not set.
 */
import { describe, expect, it, vi } from "vitest";
import { MongoClient } from "mongodb";

vi.mock("@/lib/auth", () => ({
  // Admin bypasses the feature gate, so the test works regardless of the flag.
  getAuthUser: vi.fn(async () => ({
    userId: "test",
    username: "integration-test",
    email: "t@test",
    role: "admin",
    isAdmin: true,
  })),
}));
vi.mock("@/lib/observability/apiMetrics", () => ({
  withApiMetrics: (_name: string, handler: unknown) => handler,
}));

const describeIfDb = process.env.MONGODB_URI ? describe : describe.skip;

describeIfDb("GET /api/elections/[id]/results (integration)", () => {
  const call = async (id: string) => {
    const { GET } = await import("./route");
    return (GET as (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>)(
      new Request(`http://test/api/elections/${id}/results`),
      { params: Promise.resolve({ id }) }
    );
  };

  it("shapes a real resolved election end-to-end", async () => {
    const client = new MongoClient(process.env.MONGODB_URI!);
    try {
      const db = client.db();
      const election = await db
        .collection("elections")
        .findOne(
          { status: { $in: ["resolved", "completed"] } },
          { sort: { cycle: -1 }, projection: { _id: 1, electionType: 1 } }
        );
      if (!election) return; // empty world — nothing to assert

      const res = await call(election._id.toString());
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.election.id).toBe(election._id.toString());
      expect(body.election.status).toMatch(/resolved|completed/);
      expect(Array.isArray(body.candidates)).toBe(true);
      expect(Array.isArray(body.units)).toBe(true);
      // A finished race with votes must keep its roster even though
      // resolution marks every candidate doc withdrawn.
      if (body.summary.totalVotes > 0) {
        expect(body.candidates.length).toBeGreaterThan(0);
      }
      expect(body.isAdmin).toBe(true);
      // Ended elections never drip.
      expect(body.election.finalHour).toBeNull();
      for (const c of body.candidates) {
        expect(typeof c.name).toBe("string");
        expect(c.partyColor).toMatch(/^#/);
      }
      // Ended units with a decisive leader are called; region names resolved.
      for (const u of body.units) {
        expect(typeof u.name).toBe("string");
        expect(u.reportingPct === 0 || u.reportingPct === 100).toBe(true);
      }
    } finally {
      await client.close();
    }
  }, 30_000);

  it("uses the per-unit electoral board for a US president election with a unit tally", async () => {
    const client = new MongoClient(process.env.MONGODB_URI!);
    try {
      const db = client.db();
      const tally = await db
        .collection("electionVoteTallies")
        .findOne(
          { totalVotesByUnit: { $exists: true } },
          { projection: { electionId: 1 }, sort: { updatedAt: -1 } }
        );
      if (!tally) return; // no presidential tally in this world yet

      const res = await call(tally.electionId.toString());
      expect(res.status).toBe(200);
      const body = await res.json();
      if (body.election.electionType !== "president" || body.election.countryId !== "US") return;

      expect(body.election.totalEv).toBeGreaterThan(500);
      expect(body.election.evNeeded).toBe(Math.floor(body.election.totalEv / 2) + 1);
      expect(body.units.length).toBeGreaterThan(50);
      const named = body.units.filter((u: { id: string; name: string }) => u.name !== u.id);
      expect(named.length).toBeGreaterThan(40); // state names resolved
    } finally {
      await client.close();
    }
  }, 30_000);

  it("aggregates a national board for multi-region chamber elections", async () => {
    const client = new MongoClient(process.env.MONGODB_URI!);
    try {
      const db = client.db();
      const election = await db.collection("elections").findOne(
        {
          electionType: { $in: ["house", "commons", "shugiin", "npcDelegate", "bundestag"] },
          status: { $in: ["resolved", "completed", "active"] },
        },
        { sort: { cycle: -1 }, projection: { _id: 1, electionType: 1 } }
      );
      if (!election) return;

      const res = await call(election._id.toString());
      expect(res.status).toBe(200);
      const body = await res.json();
      if (!body.national) return; // fewer than 2 sibling regions — nothing national

      expect(body.national.totalSeats).toBeGreaterThan(0);
      expect(body.national.majorityThreshold).toBe(Math.floor(body.national.totalSeats / 2) + 1);
      expect(body.national.totalRegions).toBeGreaterThanOrEqual(2);
      expect(body.national.regions.length).toBe(body.national.totalRegions);
      expect(["westminster", "generic"]).toContain(body.national.style);
      expect(body.national.projection.kind).toMatch(/majority|hung|largest|tooEarly/);
    } finally {
      await client.close();
    }
  }, 30_000);
});
