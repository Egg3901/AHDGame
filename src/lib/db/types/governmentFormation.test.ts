import { describe, it, expect } from "vitest";
import type {
  GovernmentFormation,
  PMAppointmentVote,
  NoConfidenceVote,
} from "./governmentFormation";
import { ObjectId } from "mongodb";

describe("GovernmentFormation types", () => {
  it("should create a valid pending GovernmentFormation", () => {
    const doc: GovernmentFormation = {
      _id: "UK",
      countryId: "UK",
      cycle: 1,
      status: "pending",
      formationType: null,
      lostMajority: false,
      pmCharacterId: null,
      pmName: null,
      governingPartyId: "1",
      coalitionId: null,
      coalitionPartyIds: null,
      totalSeatsSupporting: 340,
      majorityThreshold: 326,
      seatsByParty: { "1": 340, "2": 310 },
      totalSeats: 650,
      activeVoteId: null,
      formedAt: null,
      formedTurn: null,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(doc.status).toBe("pending");
    expect(doc.formationType).toBeNull();
  });

  it("should create a valid formed GovernmentFormation with coalition", () => {
    const doc: GovernmentFormation = {
      _id: "UK",
      countryId: "UK",
      cycle: 2,
      status: "formed",
      formationType: "coalition",
      lostMajority: false,
      pmCharacterId: new ObjectId(),
      pmName: "Jane Smith",
      governingPartyId: "1",
      coalitionId: 5,
      coalitionPartyIds: ["1", "3", "7"],
      totalSeatsSupporting: 350,
      majorityThreshold: 326,
      seatsByParty: { "1": 200, "2": 300, "3": 100, "7": 50 },
      totalSeats: 650,
      activeVoteId: null,
      formedAt: new Date(),
      formedTurn: 12,
      collapsedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(doc.formationType).toBe("coalition");
    expect(doc.coalitionPartyIds).toContain("3");
  });

  it("should create a valid PMAppointmentVote", () => {
    const vote: PMAppointmentVote = {
      _id: new ObjectId(),
      countryId: "UK",
      nomineeCharacterId: new ObjectId(),
      nomineeName: "John Doe",
      nomineePartyId: "1",
      nominatedByCharacterId: new ObjectId(),
      formationType: "majority",
      coalitionId: null,
      coalitionPartyIds: null,
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      status: "active",
      openedAt: new Date(),
      closesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(vote.status).toBe("active");
  });

  it("should create a valid NoConfidenceVote", () => {
    const vote: NoConfidenceVote = {
      _id: new ObjectId(),
      countryId: "UK",
      proposedByCharacterId: new ObjectId(),
      proposedByName: "MP Smith",
      targetPmCharacterId: new ObjectId(),
      targetPmName: "PM Jones",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      status: "active",
      openedAt: new Date(),
      closesAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      closedAt: null,
      turnProposed: 48,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(vote.turnProposed).toBe(48);
  });
});
