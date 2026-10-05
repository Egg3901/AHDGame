import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

const { atLeastMock, agendaSpy, mandateMock } = vi.hoisted(() => ({
  atLeastMock: vi.fn(),
  agendaSpy: vi.fn(),
  mandateMock: vi.fn(),
}));
vi.mock("../featureFlag", () => ({
  nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a),
}));
vi.mock("../governingAgenda", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../governingAgenda")>();
  return {
    ...actual,
    computeGoverningAgenda: (...a: Parameters<typeof actual.computeGoverningAgenda>) => {
      agendaSpy(...a);
      return actual.computeGoverningAgenda(...a);
    },
  };
});
vi.mock("../electoralMandateIntake", () => ({
  loadElectoralMandate: (...a: unknown[]) => mandateMock(...a),
}));

import { runCaretakerMinisters } from "../ministerialGovernance";

const now = new Date("2026-06-24T12:00:00Z");

describe("runCaretakerMinisters electoral mandate (#2321)", () => {
  let db: MockDb;
  const nppId = new ObjectId();

  beforeEach(() => {
    db = createMockDb();
    atLeastMock.mockReset().mockResolvedValue(true);
    agendaSpy.mockReset();
    mandateMock.mockReset();
    vi.mocked(db.collection("cabinetMembers").find).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: new ObjectId(),
          countryId: "US",
          positionId: "secretary_of_education",
          isNPP: true,
          nppId,
          appointedByCharacterId: new ObjectId(),
        },
      ]),
    } as never);
    vi.mocked(db.collection("npps").find).mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: nppId,
          personality: { ambition: 50, stubbornness: 50, loyalty: 50 },
          policies: { economic: 0, social: 0 },
        },
      ]),
    } as never);
    vi.mocked(db.collection("governmentFormations").findOne).mockResolvedValue({
      _id: "US",
      governingPartyId: "3",
      seatsByParty: { "3": 240 },
      totalSeats: 435,
    } as never);
  });

  it("passes the elected government's mandate to each caretaker's agenda", async () => {
    mandateMock.mockResolvedValue({
      partyId: "3",
      sources: ["platform"],
      domains: { education: 0.6 },
      strength: 1,
      computedTurn: 100,
    });
    await runCaretakerMinisters(db as unknown as Db, "US", 100, now);
    expect(mandateMock).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      expect.objectContaining({ governingPartyId: "3" }),
      100
    );
    expect(agendaSpy).toHaveBeenCalledTimes(1);
    expect(agendaSpy.mock.calls[0][0].mandate).toEqual({ education: 0.6 });
  });

  it("omits the mandate when none can be derived", async () => {
    mandateMock.mockResolvedValue(null);
    await runCaretakerMinisters(db as unknown as Db, "US", 100, now);
    expect(agendaSpy).toHaveBeenCalledTimes(1);
    expect(agendaSpy.mock.calls[0][0].mandate).toBeUndefined();
  });
});
