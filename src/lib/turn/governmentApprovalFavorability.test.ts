import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/countryState", () => ({
  getCountryState: vi.fn(async (_db: unknown, countryId: string) => ({
    governmentType: countryId === "US" ? "presidential" : "parliamentaryRepublic",
  })),
}));
import {
  governmentApprovalFavorabilityDrain,
  loadRulingExecutiveParties,
  MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN,
} from "./governmentApprovalFavorability";

describe("governmentApprovalFavorabilityDrain", () => {
  it("is zero at and above neutral, and is capped at zero approval", () => {
    expect(governmentApprovalFavorabilityDrain(50)).toBe(0);
    expect(governmentApprovalFavorabilityDrain(75)).toBe(0);
    expect(governmentApprovalFavorabilityDrain(0)).toBe(MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN);
    expect(governmentApprovalFavorabilityDrain(-20)).toBe(
      MAX_GOVERNMENT_APPROVAL_FAVORABILITY_DRAIN
    );
  });

  it("is linear below 50", () => {
    expect(governmentApprovalFavorabilityDrain(40)).toBeCloseTo(0.05);
    expect(governmentApprovalFavorabilityDrain(20)).toBeCloseTo(0.15);
    expect(governmentApprovalFavorabilityDrain(49)).toBeCloseTo(0.005);
  });
});

function cursor<T>(rows: T[]) {
  return { toArray: vi.fn().mockResolvedValue(rows) };
}

function collection<T>(rows: T[]) {
  return { find: vi.fn().mockReturnValue(cursor(rows)) };
}

describe("loadRulingExecutiveParties", () => {
  it("uses the president party rather than a congressional formation party", async () => {
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([
        { countryId: "US", officeType: "president", characterId: "pres", party: "executive" },
      ]),
      governmentFormations: collection([
        {
          _id: "US",
          countryId: "US",
          governingPartyId: "majority",
          pmCharacterId: null,
          pmNppId: null,
        },
      ]),
      parliamentaryGovernments: collection([]),
      governmentApprovals: collection([{ _id: "US", approvalRating: 45 }]),
      characters: collection([]),
      npps: collection([]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(
      new Map([["US", "executive"]])
    );
  });

  it("resolves a parliamentary PM character party by country", async () => {
    const pmId = new ObjectId();
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([]),
      governmentFormations: collection([
        { _id: "UK", countryId: "UK", governingPartyId: "1", pmCharacterId: pmId, pmNppId: null },
      ]),
      parliamentaryGovernments: collection([]),
      governmentApprovals: collection([{ _id: "UK", approvalRating: 45 }]),
      characters: collection([{ _id: pmId, countryId: "UK", party: "labour" }]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(
      new Map([["UK", "labour"]])
    );
  });

  it("ignores archived governments and does not infer an executive from the legislature", async () => {
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([]),
      governmentFormations: collection([
        {
          _id: "UK",
          countryId: "UK",
          status: "formed",
          governingPartyId: "largest-party",
          pmCharacterId: null,
          pmNppId: null,
        },
      ]),
      parliamentaryGovernments: collection([
        {
          _id: "UK_4",
          countryId: "UK",
          status: "formed",
          governingPartyId: "archived-largest",
          pmCharacterId: null,
        },
      ]),
      governmentApprovals: collection([]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(new Map());
  });

  it("resolves an NPP executive party", async () => {
    const nppId = new ObjectId();
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([]),
      governmentFormations: collection([
        { _id: "DD", countryId: "DD", status: "formed", pmCharacterId: null, pmNppId: nppId },
      ]),
      parliamentaryGovernments: collection([]),
      governmentApprovals: collection([]),
      npps: collection([{ _id: nppId, countryId: "DD", party: "sed" }]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(
      new Map([["DD", "sed"]])
    );
  });

  it("uses the runtime head of government and keeps NPP parties country-scoped", async () => {
    const ruPm = new ObjectId();
    const cnNpp = new ObjectId();
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([
        // RU's ceremonial president must not displace its PM.
        { countryId: "RU", officeType: "president", characterId: null, party: "ceremonial" },
        { countryId: "US", officeType: "president", characterId: null, party: "executive" },
      ]),
      governmentFormations: collection([
        { _id: "RU", countryId: "RU", status: "formed", pmCharacterId: ruPm, pmNppId: null },
        { _id: "CN", countryId: "CN", status: "formed", pmCharacterId: null, pmNppId: cnNpp },
      ]),
      parliamentaryGovernments: collection([]),
      governmentApprovals: collection([]),
      characters: collection([{ _id: ruPm, countryId: "RU", party: "communist" }]),
      npps: collection([{ _id: cnNpp, countryId: "CN", party: "cpc" }]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(
      new Map([
        ["US", "executive"],
        ["RU", "communist"],
        ["CN", "cpc"],
      ])
    );
  });

  it("does not fall through a vacant current formation to stale legacy leadership", async () => {
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([]),
      governmentFormations: collection([
        { _id: "UK", countryId: "UK", status: "pending", pmCharacterId: null, pmNppId: null },
      ]),
      parliamentaryGovernments: collection([
        { _id: "UK_4", countryId: "UK", status: "formed", pmCharacterId: new ObjectId() },
      ]),
      governmentApprovals: collection([]),
      characters: collection([]),
      npps: collection([]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(new Map());
  });

  it("keeps a caretaker PM eligible even while the formation is pending", async () => {
    const caretaker = new ObjectId();
    const rows: Record<string, ReturnType<typeof collection>> = {
      electedOfficials: collection([]),
      governmentFormations: collection([
        { _id: "DE", countryId: "DE", status: "pending", pmCharacterId: caretaker, pmNppId: null },
      ]),
      parliamentaryGovernments: collection([]),
      governmentApprovals: collection([]),
      characters: collection([{ _id: caretaker, countryId: "DE", party: "caretaker-party" }]),
      npps: collection([]),
    };
    const db = { collection: vi.fn((name: string) => rows[name]) };
    await expect(loadRulingExecutiveParties(db as never)).resolves.toEqual(
      new Map([["DE", "caretaker-party"]])
    );
  });
});
