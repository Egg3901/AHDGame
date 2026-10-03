import { MongoClient, ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/mongodb";
import { getGameState } from "@/lib/gameState";
import { POST } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/gameState", () => ({ getGameState: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/lib/time/gameTime", () => ({ invalidateGameTimeCache: vi.fn() }));
vi.mock("@/lib/turnSystem", () => ({
  ensurePerpetualElections: vi.fn(),
  ensureUKElections: vi.fn(),
  ensureUKRegionalCouncilElections: vi.fn(),
}));
const uri = process.env.FEDERATION_TEST_MONGO_URI;
const ref = new Date("2026-01-01T00:00:00Z");

describe.skipIf(!uri)(
  "Admin timer repair retains Bulgarian, Hungarian and Russian native custody on isolated Mongo",
  () => {
    let client: MongoClient;
    beforeAll(async () => {
      const address = new URL(uri!);
      if (address.protocol !== "mongodb:" || !["localhost", "127.0.0.1"].includes(address.hostname))
        throw new Error("Qualification requires loopback Mongo");
      client = new MongoClient(uri!, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
    });
    afterAll(async () => {
      await client?.close();
    });
    it("repairs dates without renumbering, deleting, reactivating or moving native campaigns", async () => {
      const db = client.db(`ahd_test_bg_timer_${new ObjectId().toHexString()}`);
      try {
        vi.mocked(getDb).mockResolvedValue(db);
        vi.mocked(getGameState).mockResolvedValue({
          _id: "current",
          currentTurn: 10,
          preset: "1991-default",
          startingYear: 1991,
          lastTurnProcessed: ref,
        } as never);
        const polls = ["active", "upcoming", "completed", "resolved", "active", "active"].map(
          (status, i) => ({
            _id: new ObjectId(),
            countryId: "BG",
            electionType: "nationalAssembly",
            state: `BG-${i}`,
            cycle: i === 0 ? 0 : i + 3,
            status,
            startTurn: status === "upcoming" ? 20 : 1,
            primaryEndTurn: 25,
            endTurn: 30,
            totalSeats: 80,
            startTime: ref,
            primaryEndTime: ref,
            endTime: ref,
            createdAt: ref,
            updatedAt: ref,
            ...(i < 4
              ? {
                  bulgarianFoundingRound: {
                    ruleVersion: "parallel-1990-v1",
                    round: i ? 2 : 1,
                    receiptId: `BG:founding1990:${i}`,
                    rootElectionId: new ObjectId().toHexString(),
                    registeredVoters: 100000,
                  },
                }
              : { shiftedScheduleEndTurn: 30 }),
          })
        );
        // Malformed custody is skipped entirely, preserving evidence for its owner.
        polls[5].primaryEndTurn = 35;
        const nativeBindings = [
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            hungarianAssemblyRound: {
              ruleVersion: "mixed-1989-v1",
              receiptId: "HU:mixed1989:7",
              round: 1,
              registeredVoters: 100000,
            },
          },
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            hungarianAssemblyRound: {
              ruleVersion: "mixed-1989-v1",
              receiptId: "HU:mixed1989:7",
              round: 2,
              registeredVoters: 100000,
              rootElectionId: new ObjectId().toHexString(),
            },
          },
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            hungarianAssemblyRound: {
              ruleVersion: "mixed-1989-v1",
              receiptId: "vacancy",
              round: 1,
              registeredVoters: 100000,
              byElection: {
                parentReceiptId: "HU:mixed1989:7",
                districtIds: ["district"],
                generation: 1,
              },
            },
          },
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            hungarianModernAssembly: {
              ruleVersion: "mixed-2011-v1",
              reason: "parliamentary_decision",
              authorizedOnTurn: 8,
            },
          },
          {
            countryId: "HU",
            electionType: "nationalAssembly",
            hungarianModernByElection: {
              receiptId: "vacancy",
              parentReceiptId: "parent",
              districtId: "district",
              registeredVoters: 100000,
            },
          },
          {
            countryId: "RU",
            electionType: "president",
            russianPresidentialRound: { round: 1, mandateSinceTurn: 8, registeredVoters: 100000 },
          },
          {
            countryId: "RU",
            electionType: "president",
            russianPresidentialRound: {
              round: 2,
              mandateSinceTurn: 8,
              registeredVoters: 100000,
              predecessorElectionId: new ObjectId(),
            },
          },
          {
            countryId: "RU",
            electionType: "dumaDeputy",
            russianDumaRound: {
              cohortId: new ObjectId(),
              mandateSinceTurn: 8,
              registeredVoters: 100000,
              tier: "constituency",
              generation: 3,
              rootCohortId: new ObjectId(),
              predecessorElectionId: new ObjectId(),
            },
          },
          {
            countryId: "RU",
            electionType: "dumaDeputy",
            russianDumaRound: {
              cohortId: new ObjectId(),
              mandateSinceTurn: 8,
              registeredVoters: 100000,
              tier: "list",
              electoralLaw: "law1995",
            },
          },
          {
            countryId: "RU",
            electionType: "federationCouncilMember",
            russianCouncilRound: {
              cohortId: new ObjectId(),
              mandateSinceTurn: 8,
              registeredVoters: 100000,
              districtNumber: 1,
              generation: 3,
              rootCohortId: new ObjectId(),
            },
          },
        ];
        const nativePolls = nativeBindings.flatMap((binding, i) =>
          ["active", "upcoming", "completed", "resolved", "active", "active"].map((status, j) => ({
            _id: new ObjectId(),
            ...binding,
            state: `${binding.countryId}-${i}`,
            cycle: 9,
            electionYear: 2001,
            status,
            startTurn: status === "upcoming" ? 20 : 1,
            primaryEndTurn: j === 4 ? 35 : j === 5 ? 7 : status === "upcoming" ? 20 : 25,
            endTurn: j === 5 ? 8 : 30,
            totalSeats: 1,
            startTime: ref,
            primaryEndTime: ref,
            endTime: ref,
            createdAt: ref,
            updatedAt: ref,
          }))
        );
        const allPolls = [...polls, ...nativePolls];
        await db.collection("elections").insertMany(allPolls);
        const candidates = allPolls.map((row) => ({
          _id: new ObjectId(),
          electionId: row._id,
          status: "active",
        }));
        const tallies = allPolls.map((row) => ({
          _id: new ObjectId(),
          electionId: row._id,
          finalized: false,
          totalVotes: { existing: 7 },
        }));
        await db.collection("electionCandidates").insertMany(candidates);
        await db.collection("electionVoteTallies").insertMany(tallies);
        const response = await POST();
        expect(response.status).toBe(200);
        const after = await db.collection("elections").find().toArray();
        expect(after).toHaveLength(allPolls.length);
        for (const poll of allPolls) {
          const repaired = after.find((row) => row._id.equals(poll._id));
          expect(repaired).toBeDefined();
          if (["completed", "resolved"].includes(poll.status) || poll.primaryEndTurn > poll.endTurn)
            expect(repaired).toEqual(poll);
          else {
            const { startTime, primaryEndTime, endTime, updatedAt, ...stable } = repaired!;
            const {
              startTime: oldStart,
              primaryEndTime: oldPrimary,
              endTime: oldEnd,
              updatedAt: oldUpdated,
              ...original
            } = poll;
            void updatedAt;
            void oldStart;
            void oldPrimary;
            void oldEnd;
            void oldUpdated;
            expect(stable).toEqual(original);
            expect(startTime).toEqual(new Date(ref.getTime() + (poll.startTurn - 10) * 3600000));
            expect(primaryEndTime).toEqual(
              new Date(ref.getTime() + (poll.primaryEndTurn - 10) * 3600000)
            );
            expect(endTime).toEqual(new Date(ref.getTime() + (poll.endTurn - 10) * 3600000));
          }
        }
        expect(await db.collection("electionCandidates").find().toArray()).toEqual(candidates);
        expect(await db.collection("electionVoteTallies").find().toArray()).toEqual(tallies);
      } finally {
        await db.dropDatabase();
      }
    });
  }
);
