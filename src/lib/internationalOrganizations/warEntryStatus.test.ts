import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { loadBlocWarEntryStatusByDisplayOrg } from "./warEntryStatus";

describe("bloc war entry status projection", () => {
  it("shows a custom Bloc's own operation", async () => {
    const db = createMockDb();
    const resolutionId = new ObjectId();
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: resolutionId,
          organizationId: "andes-pact",
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
          status: "active",
          sideA: { countries: ["US"] },
          sideB: { countries: ["DD"] },
        },
      ]),
    });
    db.collection("bills").find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const result = await loadBlocWarEntryStatusByDisplayOrg(
      db as unknown as Db,
      [
        {
          id: "andes-pact",
          def: {
            category: "bloc",
            foundingMembers: ["BR"],
            alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
          },
          members: [{ countryId: "BR" }],
        },
      ] as never
    );

    expect(result.get("andes-pact")?.[0]).toMatchObject({
      militaryOrganizationId: "andes-pact",
      stake: "collective_defense",
      members: [{ countryId: "BR", stake: "collective_defense", status: "awaiting" }],
    });
  });

  it("shows a custom Bloc's defense of an applicant on the non-host side", async () => {
    const db = createMockDb();
    db.collection("organizationLegislation").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          organizationId: "andes-pact",
          type: "join_conflict",
          status: "active",
          joinConflictTheaterId: "germany",
          joinConflictSide: "A",
          joinConflictDefendingCountryId: "DE",
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
          sideA: { countries: ["DE"] },
          sideB: { countries: ["DD"] },
        },
      ]),
    });
    db.collection("bills").find.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const result = await loadBlocWarEntryStatusByDisplayOrg(
      db as unknown as Db,
      [
        {
          id: "andes-pact",
          def: {
            category: "bloc",
            foundingMembers: ["BR"],
            alignment: { poleId: "ORG:andes-pact", accentToken: "warning" },
          },
          members: [{ countryId: "BR" }],
        },
      ] as never
    );

    expect(result.get("andes-pact")?.[0]).toMatchObject({
      stake: "collective_defense",
      members: [{ countryId: "BR", stake: "collective_defense", status: "awaiting" }],
    });
  });

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
