/**
 * Tests for canonical jurisdiction ownership and rate-grid validation.
 *
 * A shared-currency bank has exactly one authoritative document and the URL's
 * country is only a viewpoint: DE resolves to the ECB doc, SCO/WAL resolve to
 * the UK doc, and the anchor member owns governance. Committee actions are
 * US-only, and every primeRate writer normalizes onto the quarter-point grid.
 */

import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import { resolveJurisdiction } from "./jurisdiction";
import { decideGovernance } from "./rules/machine";
import { allowedActionsFor } from "./rules/allowedActions";
import type { JurisdictionState } from "./rules/types";

function mockDb(bankDoc: { _id: string; countryId: string } | null) {
  return {
    collection: vi.fn((name: string) => {
      if (name === "centralBanks") {
        return { findOne: vi.fn().mockResolvedValue(bankDoc) };
      }
      if (name === "organizationMemberships") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    }),
  } as unknown as Db;
}

describe("resolveJurisdiction", () => {
  it("resolves the US to its own committee institution", async () => {
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "US", countryId: "US" }),
      "US" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("US");
    expect(jurisdiction.memberCountryIds).toEqual(["US"]);
    expect(jurisdiction.anchorCountryId).toBe("US");
    expect(jurisdiction.isAnchor).toBe(true);
    expect(jurisdiction.committeeBank).toBe(true);
  });

  it("resolves a sterlingized member to the Bank of England doc with the UK as anchor", async () => {
    // SCO is coming-soon and absent from COUNTRY_ORDER, so the configured
    // member list is just the UK itself; the viewpoint country always joins
    // through its own scope, with the anchor first.
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "UK", countryId: "UK" }),
      "SCO" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("UK");
    expect(jurisdiction.anchorCountryId).toBe("UK");
    expect(jurisdiction.isAnchor).toBe(false);
    expect(jurisdiction.memberCountryIds).toEqual(["UK", "SCO"]);
    expect(jurisdiction.committeeBank).toBe(false);
  });

  it("resolves a second sterlingized member to the same Bank of England doc", async () => {
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "UK", countryId: "UK" }),
      "WAL" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("UK");
    expect(jurisdiction.anchorCountryId).toBe("UK");
    expect(jurisdiction.isAnchor).toBe(false);
    expect(jurisdiction.memberCountryIds).toContain("UK");
    expect(jurisdiction.memberCountryIds).toContain("WAL");
    expect(jurisdiction.committeeBank).toBe(false);
  });

  it("resolves the UK itself as the anchor member", async () => {
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "UK", countryId: "UK" }),
      "UK" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("UK");
    expect(jurisdiction.isAnchor).toBe(true);
    expect(jurisdiction.committeeBank).toBe(false);
  });

  it("resolves DE to the ECB doc, which runs no committee", async () => {
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "ECB", countryId: "DE" }),
      "DE" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("ECB");
    expect(jurisdiction.memberCountryIds).toContain("DE");
    expect(jurisdiction.committeeBank).toBe(false);
  });

  it("resolves IE to its own national bank", async () => {
    const jurisdiction = await resolveJurisdiction(
      mockDb({ _id: "IE", countryId: "IE" }),
      "IE" as CountryId
    );
    expect(jurisdiction.institutionId).toBe("IE");
    expect(jurisdiction.isAnchor).toBe(true);
    expect(jurisdiction.committeeBank).toBe(false);
  });
});

function ukState(): JurisdictionState {
  return {
    institutionId: "UK",
    currency: "GBP",
    memberCountryIds: ["UK", "SCO", "WAL"],
    anchorCountryId: "UK",
    committeeBank: false,
    governmentControlled: false,
    primeRate: 4,
    chairInfamy: 0,
    board: [],
    activeMeeting: null,
    rateChangesThisTerm: 0,
    termStartedAtTurn: 100,
    lastMeetingTurn: null,
    lastRateChangeTurn: null,
    chairCharacterId: null,
    controlsLocked: false,
    chairSelectionPending: false,
    fxCommitment: null,
    commandEconomy: false,
    lastVacancyNoticeAtTurn: null,
  };
}

function usState(): JurisdictionState {
  return {
    ...ukState(),
    institutionId: "US",
    currency: "USD",
    memberCountryIds: ["US"],
    anchorCountryId: "US",
    committeeBank: true,
    primeRate: 5,
  };
}

const CLOCK = { turn: 108, now: 1_700_000_000_000, currentYear: 1960 };

describe("jurisdiction scoping in the machine", () => {
  it("a shared-currency member cannot trigger US-only committee controls", async () => {
    const macro = { neutralRate: 3, inflationRate: 5, targetInflation: 2, gdpGrowth: 2 };
    const open = decideGovernance(
      ukState(),
      { type: "open_meeting", macro, countryId: "SCO" },
      { kind: "system" },
      CLOCK
    );
    expect(open.allowed).toBe(false);
    if (open.allowed) return;
    expect(open.reason).toBe("no-committee");

    const ballot = decideGovernance(
      ukState(),
      { type: "cast_ballot", seatId: "seat-1", vote: "hike", countryId: "SCO" },
      { kind: "governor", seatId: "seat-1", countryId: "SCO" },
      CLOCK
    );
    expect(ballot.allowed).toBe(false);
    if (ballot.allowed) return;
    expect(ballot.reason).toBe("no-committee");
  });

  it("a non-member viewpoint is refused", async () => {
    const decision = decideGovernance(
      usState(),
      { type: "set_rate", rate: 5.25, countryId: "DE" },
      { kind: "chair", countryId: "DE" },
      CLOCK
    );
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe("not-member");
  });

  it("non-US institutions never expose committee actions", async () => {
    const view = allowedActionsFor(ukState(), { kind: "chair", countryId: "SCO" }, CLOCK);
    for (const action of ["open_meeting", "cast_ballot", "resolve_meeting"]) {
      expect(view.actions.find((a) => a.action === action)?.allowed).toBe(false);
    }
  });
});

describe("committee resolution normalizes onto the grid", () => {
  it("snaps a hike from an off-grid stored rate back onto the grid", async () => {
    const { resolveMeetingInto } = await import("@/lib/turn/fomcMeetingTurn");
    const set: Record<string, unknown> = {};
    const board = Array.from({ length: 7 }, (_, i) => ({
      seatId: `seat-${i + 1}`,
      isChair: i === 0,
      occupantType: "npp" as const,
      characterId: null,
      characterName: `Governor ${i + 1}`,
      nppId: null,
      alignment: "hawk" as const,
      appointedByPresidentId: null,
      appointedAtTurn: 0,
      termExpiresAtTurn: 900,
    }));
    const meeting = {
      meetingId: "m1",
      openedAtTurn: 100,
      openedAt: new Date(),
      motion: "hike" as const,
      proposedDelta: 0.25,
      status: "voting" as const,
      ballots: ["seat-1", "seat-2", "seat-3", "seat-4"].map((seatId) => ({
        seatId,
        vote: "hike" as const,
        auto: true,
        castAt: new Date(),
      })),
      playerVoteDeadline: new Date(),
      resolvesOnTurn: 124,
    };
    resolveMeetingInto(
      set,
      { primeRate: 4.1, rateHistory: [], fomcMeetingHistory: [] },
      board,
      meeting,
      124,
      new Date(),
      { changesThisTerm: 0, forceDeadline: true }
    );
    // Raw arithmetic would store 4.35, off the grid. Snapped: 4.0 + 0.25.
    expect(set.primeRate).toBe(4.25);
  });
});
