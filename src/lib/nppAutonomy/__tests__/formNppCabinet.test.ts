import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));

import {
  rankCabinetCandidates,
  formNppCabinet,
  positionAxis,
  portfolioAffinity,
  type CabinetCandidate,
} from "../formNppCabinet";
import type { CabinetPositionMechanics, MetricConfig } from "@/lib/constants/cabinetMechanicsTypes";

const now = new Date("2026-06-24T12:00:00Z");

// Personalities by derived archetype (deriveGoverningArchetype axes).
const IDEOLOGUE = { ambition: 80, stubbornness: 80, loyalty: 50 };
const TECHNOCRAT = { ambition: 20, stubbornness: 20, loyalty: 50 };

function candidate(over: Partial<CabinetCandidate> & { nppId: ObjectId }): CabinetCandidate {
  return {
    name: "NPP",
    party: "5",
    ideology: { economic: 0, social: 0 },
    personality: { ambition: 50, stubbornness: 50, loyalty: 50 },
    politicalInfluence: 50,
    favorability: 50,
    ...over,
  };
}

describe("rankCabinetCandidates (pure)", () => {
  it("ranks the ideologically-closer candidate above the distant one", () => {
    const close = candidate({ nppId: new ObjectId(), ideology: { economic: -4, social: -2 } });
    const far = candidate({ nppId: new ObjectId(), ideology: { economic: 5, social: 5 } });
    const ranked = rankCabinetCandidates([far, close], {
      ideology: { economic: -4, social: -2 },
      personality: IDEOLOGUE,
    });
    expect(ranked[0].nppId).toBe(close.nppId);
  });

  it("is deterministic and stable under equal scores (influence tie-break)", () => {
    const a = candidate({ nppId: new ObjectId(), politicalInfluence: 30 });
    const b = candidate({ nppId: new ObjectId(), politicalInfluence: 90 });
    const ranked = rankCabinetCandidates([a, b], {
      ideology: { economic: 0, social: 0 },
      personality: TECHNOCRAT,
    });
    expect(ranked[0].nppId).toBe(b.nppId); // higher influence wins the tie
  });

  it("lets the head's archetype tune ideology-fit vs competence emphasis", () => {
    // A: perfect ideology fit, weak competence. B: poor fit, strong competence.
    const head = { economic: -5, social: -5 };
    const a = candidate({
      nppId: new ObjectId(),
      ideology: { ...head },
      politicalInfluence: 0,
      favorability: 0,
      personality: { ambition: 0, stubbornness: 0, loyalty: 0 },
    });
    const b = candidate({
      nppId: new ObjectId(),
      ideology: { economic: 5, social: 5 },
      politicalInfluence: 100,
      favorability: 100,
      personality: { ambition: 100, stubbornness: 100, loyalty: 100 },
    });

    const underIdeologue = rankCabinetCandidates([a, b], {
      ideology: head,
      personality: IDEOLOGUE,
    });
    const underTechnocrat = rankCabinetCandidates([a, b], {
      ideology: head,
      personality: TECHNOCRAT,
    });
    // An ideologue prizes the perfect-fit ally; a technocrat prizes competence.
    expect(underIdeologue[0].nppId).toBe(a.nppId);
    expect(underTechnocrat[0].nppId).toBe(b.nppId);
  });
});

let db: MockDb;
const headId = new ObjectId();

function setup(opts: {
  gov: Record<string, unknown> | null;
  existingMembers?: Record<string, unknown>[];
  headNpp?: Record<string, unknown> | null;
  pool?: Record<string, unknown>[];
  /** Live electedOfficials rows backing the seat tally `formNppCabinet` now
   *  derives via `tallySeatsByParty` instead of trusting `gov.seatsByParty`. */
  electedOfficials?: Record<string, unknown>[];
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["cabinetMembers"] = {
    ...db.collection("cabinetMembers"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.existingMembers ?? [])),
    updateOne: vi.fn().mockResolvedValue({ matchedCount: 0, upsertedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    findOne: vi.fn().mockResolvedValue(opts.headNpp ?? null),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.pool ?? [])),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["electedOfficials"] = {
    ...db.collection("electedOfficials"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.electedOfficials ?? [])),
  } as MockDb["collectionMocks"][string];
}

const headNpp = {
  _id: headId,
  name: "Taoiseach Tom",
  party: "5",
  policies: { economic: -3, social: -2 },
  personality: { ambition: 70, stubbornness: 30, loyalty: 60 },
  favorability: 65,
  politicalInfluence: 80,
};

function npp(over: Record<string, unknown>) {
  return {
    _id: new ObjectId(),
    name: "Minister M",
    party: "5",
    policies: { economic: -3, social: -2 },
    personality: { ambition: 50, stubbornness: 40, loyalty: 60 },
    favorability: 50,
    politicalInfluence: 50,
    retiredAt: null,
    ...over,
  };
}

beforeEach(() => {
  atLeastMock.mockReset().mockResolvedValue(true);
});

describe("formNppCabinet (I/O)", () => {
  it("no-ops when the v1 gate is not met", async () => {
    atLeastMock.mockResolvedValue(false);
    setup({ gov: { _id: "IE", status: "formed", pmNppId: headId } });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.ran).toBe(false);
    expect(res.filled).toBe(0);
  });

  it("no-ops when the head of government is player-held (no NPP id)", async () => {
    setup({ gov: { _id: "IE", status: "formed", pmNppId: null, presidentNppId: null } });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.ran).toBe(false);
  });

  it("no-ops (ran, filled 0) for a country with no cabinet positions defined (BR)", async () => {
    setup({ gov: { _id: "BR", status: "formed", presidentNppId: headId }, headNpp });
    const res = await formNppCabinet(db as unknown as Db, "BR", now);
    expect(res.ran).toBe(true);
    expect(res.filled).toBe(0);
    expect(db.collectionMocks["cabinetMembers"].updateOne).not.toHaveBeenCalled();
  });

  it("fills vacant posts from co-partisan NPPs, excluding the head", async () => {
    const a = npp({ name: "Ada", politicalInfluence: 90 });
    const b = npp({ name: "Ben", politicalInfluence: 40 });
    setup({
      gov: { _id: "IE", status: "formed", pmNppId: headId, governingPartyId: "5" },
      headNpp,
      pool: [a, b, { ...headNpp, retiredAt: null }],
    });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.ran).toBe(true);
    expect(res.filled).toBe(2); // two candidates → two senior posts
    const updateOne = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    expect(updateOne).toHaveBeenCalledTimes(2);
    const firstSet = updateOne.mock.calls[0][1].$set;
    expect(firstSet.isNPP).toBe(true);
    expect(firstSet.characterId).toBeNull();
    expect(firstSet.appointedByNppId).toBe(headId);
    // The head must never appoint itself into the cabinet.
    const appointedNppIds = updateOne.mock.calls.map((c) => c[1].$set.nppId.toString());
    expect(appointedNppIds).not.toContain(headId.toString());
  });

  it("is idempotent: already-filled posts are not refilled, seated NPPs excluded", async () => {
    // Every appointable IE post is already filled → nothing vacant.
    const { getCabinetPositions } = await import("@/lib/constants/cabinetMechanics");
    const appointable = getCabinetPositions("IE").filter((p) => !p.isHeadOfGovernment);
    const existing = appointable.map((p) => ({
      positionId: p.id,
      isNPP: true,
      nppId: new ObjectId(),
    }));
    setup({
      gov: { _id: "IE", status: "formed", pmNppId: headId, governingPartyId: "5" },
      existingMembers: existing,
      headNpp,
      pool: [npp({ name: "Spare" })],
    });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.filled).toBe(0);
    expect(db.collectionMocks["cabinetMembers"].updateOne).not.toHaveBeenCalled();
  });

  it("seats coalition partners, not only the lead party", async () => {
    // Lead party "1" (60 seats) + coalition partner "2" (40 seats), tallied live
    // from electedOfficials. With only one candidate from each, both vacant
    // senior posts get filled → partner seated.
    const leadNpp = npp({ name: "Lead Minister", party: "1" });
    const partnerNpp = npp({ name: "Partner Minister", party: "2" });
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: headId,
        governingPartyId: "1",
        coalitionPartyIds: ["2"],
      },
      headNpp: { ...headNpp, party: "1" },
      pool: [leadNpp, partnerNpp],
      electedOfficials: [
        { officeType: "dail", countryId: "IE", party: "1", seatsHeld: 60 },
        { officeType: "dail", countryId: "IE", party: "2", seatsHeld: 40 },
      ],
    });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.filled).toBe(2);
    const updateOne = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    const parties = updateOne.mock.calls.map((c) => c[1].$set.party);
    expect(parties).toContain("1");
    expect(parties).toContain("2"); // the coalition partner got a seat
  });

  it("derives coalition standing live, ignoring a stale/wrong gov.seatsByParty", async () => {
    // Regression for the stale-cache defect: `governmentFormations.seatsByParty`
    // is a write-triggered cache that can drift far from the real chamber
    // (measured in the field: 0 against a real 513/360-seat chamber). Seed the
    // stored cache with the OPPOSITE seat ordering from the live chamber and
    // assert the partner-standing bonus follows the live tally, not the doc.
    const leadNpp = npp({ name: "Lead Minister", party: "1", politicalInfluence: 50 });
    const partnerNpp = npp({ name: "Partner Minister", party: "2", politicalInfluence: 50 });
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: headId,
        governingPartyId: "1",
        coalitionPartyIds: ["2"],
        // Stale cache says the partner holds nearly everything — if this were
        // read, the partner would outrank the lead party's own candidate for
        // the top (most senior) post despite equal competence scores.
        seatsByParty: { "1": 1, "2": 999 },
      },
      headNpp: { ...headNpp, party: "1" },
      pool: [leadNpp, partnerNpp],
      // Live truth is the opposite of the stale cache: lead party dominates.
      electedOfficials: [
        { officeType: "dail", countryId: "IE", party: "1", seatsHeld: 100 },
        { officeType: "dail", countryId: "IE", party: "2", seatsHeld: 1 },
      ],
    });
    const res = await formNppCabinet(db as unknown as Db, "IE", now);
    expect(res.filled).toBe(2);
    const updateOne = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    // Most senior vacant post (order 0) is assigned first — it must go to the
    // lead party's candidate (LEADER_PARTY_BONUS + dominant live seat share),
    // not the partner the stale cache would have favored.
    const firstSet = updateOne.mock.calls[0][1].$set;
    expect(firstSet.party).toBe("1");
  });
});

function metric(category: string, metricId: string): MetricConfig {
  return { category, metricId, label: metricId, format: "index", higherIsBetter: true };
}
function mechanics(
  metrics: MetricConfig[]
): Pick<CabinetPositionMechanics, "nationalMetrics" | "regionalMetrics"> {
  return { nationalMetrics: metrics, regionalMetrics: [] };
}

describe("positionAxis (pure)", () => {
  it("classifies an economic portfolio from its metrics", () => {
    expect(positionAxis(mechanics([metric("economic", "gdpGrowth")]))).toBe("economic");
  });
  it("classifies a social/service portfolio from its metrics", () => {
    expect(positionAxis(mechanics([metric("healthcare", "healthcareAccess")]))).toBe("social");
  });
  it("is neutral when no metric maps to an agenda domain", () => {
    expect(positionAxis(mechanics([metric("governance", "governmentApproval")]))).toBe("neutral");
    expect(positionAxis(undefined)).toBe("neutral");
  });
});

describe("portfolioAffinity (pure)", () => {
  it("rewards conviction on the post's axis; neutral posts are flat", () => {
    const econHawk = { economic: 5, social: 0 };
    const socialDriven = { economic: 0, social: 5 };
    expect(portfolioAffinity(econHawk, "economic")).toBeCloseTo(1, 5);
    expect(portfolioAffinity(econHawk, "social")).toBeCloseTo(0, 5);
    expect(portfolioAffinity(socialDriven, "social")).toBeCloseTo(1, 5);
    expect(portfolioAffinity(econHawk, "neutral")).toBe(0.5);
  });
});
