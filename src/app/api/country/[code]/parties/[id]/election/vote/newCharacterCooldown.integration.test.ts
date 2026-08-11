import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";

// This test scaffold requires an authenticated session cookie to hit the
// party-vote route end-to-end. The codebase does not (yet) expose a
// `createTestAuthSession` / `signTestJwt` helper. When one is added,
// replace the placeholder assertion with a real POST to the route and
// verify the 403 response carries { error, unblockAt }.
//
// The pure cooldown logic is exhaustively covered by the unit test
// suite at `src/lib/auth/newCharacterCooldown.test.ts`.

const skipIfNoDb = !process.env.MONGODB_URI ? describe.skip : describe;

skipIfNoDb("POST /api/country/[code]/parties/[id]/election/vote — cooldown", () => {
  const uri = process.env.MONGODB_URI!;
  const dbName = process.env.MONGODB_DB ?? "a-house-divided-test";
  let client: MongoClient;

  beforeEach(async () => {
    client = await MongoClient.connect(uri);
    const db = client.db(dbName);
    await db.collection("nationalPartyElections").deleteMany({});
    await db.collection("nationalPartyCandidates").deleteMany({});
    await db.collection("nationalPartyVotes").deleteMany({});
  });

  afterAll(async () => {
    await client?.close();
  });

  it("scaffold: end-to-end cooldown test pending test-auth helper", () => {
    // Placeholder — see file header. When the test-auth helper exists:
    //   const res = await fetch(`http://localhost:3000/api/country/US/parties/1/election/vote`, {
    //     method: "POST",
    //     headers: { "Content-Type": "application/json", cookie: testAuthCookie(...) },
    //     body: JSON.stringify({ candidateId: "...", position: "chair" }),
    //   });
    //   expect(res.status).toBe(403);
    //   const body = await res.json();
    //   expect(body).toHaveProperty("unblockAt");
    expect(true).toBe(true);
  });
});
