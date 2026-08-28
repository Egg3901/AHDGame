import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadBlocWarEntryStatusByDisplayOrg } from "./warEntryStatus";

describe("bloc war entry status projection", () => {
  it("shows NATO votes and linked Warsaw Pact status on COMECON", async () => {
    const db = createMockDb();
    const natoResolution = new ObjectId();
    const pactResolution = new ObjectId();
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: natoResolution,
          organizationId: "NATO",
          type: "join_conflict",
          status: "active",
          joinConflictTheaterId: "germany",
          joinConflictSide: "A",
        },
        {
          _id: pactResolution,
          organizationId: "WARSAW_PACT",
          type: "join_conflict",
          status: "active",
          joinConflictTheaterId: "germany",
          joinConflictSide: "B",
        },
      ]),
    });
    db.collection("conflicts").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "germany",
          name: "The War for Germany",
          hostCountry: "DD",
          hostEntities: ["DD", "DE"],
          status: "active",
          sideA: { countries: ["US", "DE"] },
          sideB: { countries: ["DD", "RU", "PL"] },
        },
      ]),
    });
    db.collection("bills").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          countryId: "FR",
          status: "active_both",
          votesFor: 139,
          votesAgainst: 135,
          votesAbstain: 353,
          otherChamberVotes: {},
          otherChamberVotesFor: 315,
          otherChamberVotesAgainst: 215,
          otherChamberVotesAbstain: 177,
          provisions: [{ type: "join_conflict", resolutionId: natoResolution.toString() }],
        },
      ]),
    });

    const statuses = await loadBlocWarEntryStatusByDisplayOrg(
      db as unknown as Db,
      [
        {
          id: "NATO",
          members: [{ countryId: "DE" }, { countryId: "FR" }],
        },
        {
          id: "COMECON",
          members: [{ countryId: "PL" }],
        },
      ] as never,
      "1953-default"
    );

    expect(statuses.get("NATO")?.[0]).toMatchObject({
      militaryOrganizationId: "NATO",
      stake: "offensive_coalition",
      opposingNames: ["East Germany", "Soviet Union", "Poland"],
      members: [
        { countryId: "DE", status: "joined", stake: "principal_belligerent" },
        {
          countryId: "FR",
          status: "pending",
          lower: { for: 139, against: 135, abstain: 353 },
        },
      ],
    });
    expect(statuses.get("COMECON")?.[0]).toMatchObject({
      militaryOrganizationId: "WARSAW_PACT",
      stake: "collective_defense",
      members: [{ countryId: "PL", status: "joined" }],
    });
  });
});
