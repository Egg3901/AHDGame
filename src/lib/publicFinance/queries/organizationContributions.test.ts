import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createAsyncIterableCursor, createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/countryAccess", () => ({
  getCountryAccessFromDb: vi.fn(),
}));
vi.mock("@/lib/internationalOrganizations/countryGdp", () => ({
  loadUsdGdpByCountry: vi.fn(),
}));

const { getCountryAccessFromDb } = await import("@/lib/countryAccess");
const { loadUsdGdpByCountry } = await import("@/lib/internationalOrganizations/countryGdp");
const { loadOrganizationContributions } = await import("./organizationContributions");

describe("loadOrganizationContributions", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("organizationMemberships");
    db.collection("organizationFunds");
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({
      enabledForPlayers: true,
    } as never);
    vi.mocked(loadUsdGdpByCountry).mockResolvedValue(new Map([["US", 48]]));
    db.collectionMocks.organizationMemberships!.find.mockReturnValue(
      createAsyncIterableCursor([{ organizationId: "UN" }, { organizationId: "COMECON" }])
    );
    db.collectionMocks.organizationFunds!.find.mockReturnValue(
      createAsyncIterableCursor([
        { organizationId: "UN", duesRateAnnual: 0.00006 },
        { organizationId: "COMECON", duesRateAnnual: 0.00006 },
      ])
    );
  });

  it("uses the same per-turn dues price for every organization membership", async () => {
    const result = await loadOrganizationContributions(db as unknown as Db, "US", "2019-default");

    // 48M USD GDP × 0.006% / 48 turns = 60 USD per organization per turn.
    expect(result).toEqual({
      perTurn: 120,
      lines: [
        { organizationId: "UN", kind: "dues", perTurn: 60 },
        { organizationId: "COMECON", kind: "dues", perTurn: 60 },
      ],
    });
  });

  it("reports tribute for a non-enabled armed-bloc member", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ enabledForPlayers: false } as never);
    db.collectionMocks.organizationMemberships!.find.mockReturnValue(
      createAsyncIterableCursor([{ organizationId: "WARSAW_PACT" }])
    );
    db.collectionMocks.organizationFunds!.find.mockReturnValue(createAsyncIterableCursor([]));

    const result = await loadOrganizationContributions(db as unknown as Db, "US", "1953-default");

    // 48M USD GDP × 0.75% / 48 turns = 7,500 USD for the Warsaw Pact.
    expect(result).toEqual({
      perTurn: 7_500,
      lines: [{ organizationId: "WARSAW_PACT", kind: "tribute", perTurn: 7_500 }],
    });
  });

  it("keeps ordinary dues for a non-enabled member outside an armed bloc", async () => {
    vi.mocked(getCountryAccessFromDb).mockResolvedValue({ enabledForPlayers: false } as never);
    db.collectionMocks.organizationMemberships!.find.mockReturnValue(
      createAsyncIterableCursor([{ organizationId: "COMECON" }])
    );
    db.collectionMocks.organizationFunds!.find.mockReturnValue(createAsyncIterableCursor([]));

    const result = await loadOrganizationContributions(db as unknown as Db, "US", "1953-default");

    expect(result).toEqual({
      perTurn: 60,
      lines: [{ organizationId: "COMECON", kind: "dues", perTurn: 60 }],
    });
  });

  it("does not invent a treasury draw when the country has no priced GDP", async () => {
    vi.mocked(loadUsdGdpByCountry).mockResolvedValue(new Map());

    await expect(
      loadOrganizationContributions(db as unknown as Db, "US", "2019-default")
    ).resolves.toEqual({ perTurn: 0, lines: [] });
  });
});
