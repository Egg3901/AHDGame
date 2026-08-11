/**
 * Integration tests: one-party constraints wired into parliamentaryGovernment.
 *
 * Verifies that `checkAppointmentEligibility` correctly gates non-ruling
 * parties from forming government in a one-party state (currently CN),
 * and that parliamentary countries (UK, etc.) are unaffected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { checkAppointmentEligibility } from "@/lib/turn/parliamentaryGovernment";
import type { PoliticalParty } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

type ChairOpts = {
  chairPartySeqId?: number;
  chairPartyRegimeStatus?: "ruling" | "approved" | "banned" | null;
  chairPartySeats?: number;
  pcMpCount?: number;
  countryId?: string;
};

function makeMockDb(opts: ChairOpts) {
  const {
    chairPartySeqId = 1,
    chairPartyRegimeStatus = "ruling",
    chairPartySeats = 3000,
    pcMpCount = 1,
    countryId = "CN",
  } = opts;

  return {
    db: {
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "politicalParties") {
          return {
            findOne: vi
              .fn()
              .mockImplementation(
                (filter: {
                  chairId?: ObjectId;
                  $or?: Array<{ chairId?: ObjectId | null }>;
                  sequentialId?: number;
                }) => {
                  const isChairLookup =
                    filter.chairId !== undefined ||
                    (Array.isArray(filter.$or) &&
                      filter.$or.some((clause) => clause.chairId !== undefined));
                  const isSeqLookup = filter.sequentialId !== undefined;
                  if (isChairLookup || isSeqLookup) {
                    return Promise.resolve({
                      _id: new ObjectId(),
                      sequentialId: chairPartySeqId,
                      regimeStatus: chairPartyRegimeStatus,
                      name: chairPartySeqId === 1 ? "CCP" : "CDL",
                      countryId,
                    } as unknown as PoliticalParty);
                  }
                  return Promise.resolve(null);
                }
              ),
          };
        }
        if (name === "electedOfficials") {
          return {
            find: vi.fn().mockReturnValue({
              toArray: vi
                .fn()
                .mockResolvedValue([
                  { party: String(chairPartySeqId), seatsHeld: chairPartySeats, isNPP: true },
                ]),
            }),
            countDocuments: vi.fn().mockResolvedValue(pcMpCount),
          };
        }
        // Default (incl. "states"): support find().project().toArray() so the
        // live-seat lookup in checkAppointmentEligibility falls back to config.
        const emptyCursor: {
          project: () => typeof emptyCursor;
          toArray: () => Promise<unknown[]>;
        } = {
          project: () => emptyCursor,
          toArray: () => Promise.resolve([]),
        };
        return {
          findOne: vi.fn().mockResolvedValue(null),
          find: vi.fn().mockReturnValue(emptyCursor),
        };
      }),
    } as unknown as import("mongodb").Db,
  };
}

describe("checkAppointmentEligibility — one-party constraints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the ruling party chair to be eligible in CN", async () => {
    const { db } = makeMockDb({
      chairPartySeqId: 1,
      chairPartyRegimeStatus: "ruling",
      chairPartySeats: 3000,
    });
    const result = await checkAppointmentEligibility(db, "CN", new ObjectId(), 1491);
    expect(result.eligible).toBe(true);
  });

  it("blocks an approved (non-ruling) party chair in CN", async () => {
    const { db } = makeMockDb({
      chairPartySeqId: 2,
      chairPartyRegimeStatus: "approved",
      chairPartySeats: 50,
    });
    const result = await checkAppointmentEligibility(db, "CN", new ObjectId(), 1491);
    expect(result.eligible).toBe(false);
  });

  it("blocks a banned party chair in CN", async () => {
    const { db } = makeMockDb({
      chairPartySeqId: 4,
      chairPartyRegimeStatus: "banned",
      chairPartySeats: 50,
    });
    const result = await checkAppointmentEligibility(db, "CN", new ObjectId(), 1491);
    expect(result.eligible).toBe(false);
  });

  it("allows a non-ruling party chair in a non-one-party country", async () => {
    const { db } = makeMockDb({
      chairPartySeqId: 2,
      chairPartyRegimeStatus: null,
      chairPartySeats: 350,
      countryId: "UK",
    });
    const result = await checkAppointmentEligibility(db, "UK", new ObjectId(), 326);
    expect(result.eligible).toBe(true);
  });
});
