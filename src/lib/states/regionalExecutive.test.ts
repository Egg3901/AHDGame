import { describe, it, expect, vi, beforeEach } from "vitest";
import { getRegionalExecutive } from "./regionalExecutive";

describe("getRegionalExecutive", () => {
  const mockFindOne = vi.fn();
  const mockGameConfigFindOne = vi.fn().mockResolvedValue({ turnLengthMinutes: 60 });
  const mockDb = {
    collection: vi.fn((name: string) =>
      name === "gameConfig" ? { findOne: mockGameConfigFindOne } : { findOne: mockFindOne }
    ),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGameConfigFindOne.mockResolvedValue({ turnLengthMinutes: 60 });
  });

  it("returns null for English non-London UK regions (no devolved executive)", async () => {
    const result = await getRegionalExecutive(mockDb as never, "UK", "SEE");
    expect(result).toBeNull();
    // Should short-circuit without querying the DB.
    expect(mockDb.collection).not.toHaveBeenCalled();
  });

  it("returns null for any country not in the executive map", async () => {
    const result = await getRegionalExecutive(mockDb as never, "BR", "SP");
    expect(result).toBeNull();
    expect(mockDb.collection).not.toHaveBeenCalled();
  });

  it("returns First Minister for Scotland with a seated governor", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "UK",
      state: "SCO",
      officeType: "governor",
      party: "snp",
      characterId: null,
    });

    const result = await getRegionalExecutive(mockDb as never, "UK", "SCO");

    expect(result).toEqual({ partyId: "snp", sign: 1, label: "First Minister" });
    expect(mockFindOne).toHaveBeenCalledWith(
      { countryId: "UK", state: "SCO", officeType: "governor" },
      { sort: { electedAt: -1 } }
    );
  });

  it("returns First Minister for Wales and Northern Ireland too", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "UK",
      state: "WAL",
      officeType: "governor",
      party: "lab",
    });
    let result = await getRegionalExecutive(mockDb as never, "UK", "WAL");
    expect(result).toEqual({ partyId: "lab", sign: 1, label: "First Minister" });

    mockFindOne.mockResolvedValueOnce({
      countryId: "UK",
      state: "NIR",
      officeType: "governor",
      party: "sf",
    });
    result = await getRegionalExecutive(mockDb as never, "UK", "NIR");
    expect(result).toEqual({ partyId: "sf", sign: 1, label: "First Minister" });
  });

  it("returns Mayor of London for the LON region", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "UK",
      state: "LON",
      officeType: "governor",
      party: "lab",
    });

    const result = await getRegionalExecutive(mockDb as never, "UK", "LON");

    expect(result).toEqual({ partyId: "lab", sign: 1, label: "Mayor of London" });
  });

  it("returns Governor for a JP region with a seated governor", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "JP",
      state: "KAN",
      officeType: "governor",
      party: "ldp",
    });

    const result = await getRegionalExecutive(mockDb as never, "JP", "KAN");

    expect(result).toEqual({ partyId: "ldp", sign: 1, label: "Governor" });
    expect(mockFindOne).toHaveBeenCalledWith(
      { countryId: "JP", state: "KAN", officeType: "governor" },
      { sort: { electedAt: -1 } }
    );
  });

  it("returns Governor for a US state with a seated governor", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "US",
      state: "PA",
      officeType: "governor",
      party: "dem",
      characterId: null,
    });

    const result = await getRegionalExecutive(mockDb as never, "US", "PA");

    expect(result).toEqual({ partyId: "dem", sign: 1, label: "Governor" });
    expect(mockDb.collection).toHaveBeenCalledWith("electedOfficials");
    // Query sorts by electedAt desc to deterministically pick the most
    // recent record when (rare) duplicates exist.
    expect(mockFindOne).toHaveBeenCalledWith(
      {
        countryId: "US",
        state: "PA", // already uppercase; helper would uppercase a lowercase input
        officeType: "governor",
      },
      { sort: { electedAt: -1 } }
    );
  });

  it("returns Governor for a CN macro-region with a seated governor", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "CN",
      state: "HD",
      officeType: "governor",
      party: "1",
    });

    const result = await getRegionalExecutive(mockDb as never, "CN", "HD");

    expect(result).toEqual({ partyId: "1", sign: 1, label: "Governor" });
    expect(mockFindOne).toHaveBeenCalledWith(
      { countryId: "CN", state: "HD", officeType: "governor" },
      { sort: { electedAt: -1 } }
    );
  });

  it("returns null for a CN region with no seated governor", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const result = await getRegionalExecutive(mockDb as never, "CN", "XB");
    expect(result).toBeNull();
  });

  it("returns Ministerpräsident for a DE Land with a seated executive", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "DE",
      state: "BY",
      officeType: "ministerPresident",
      party: "csu",
      characterId: null,
    });

    const result = await getRegionalExecutive(mockDb as never, "DE", "BY");

    expect(result).toEqual({ partyId: "csu", sign: 1, label: "Ministerpräsident" });
    expect(mockFindOne).toHaveBeenCalledWith(
      {
        countryId: "DE",
        state: "BY",
        officeType: "ministerPresident",
      },
      { sort: { electedAt: -1 } }
    );
  });

  it("returns null when the governor seat is vacant (no officials row)", async () => {
    mockFindOne.mockResolvedValueOnce(null);

    const result = await getRegionalExecutive(mockDb as never, "US", "WY");
    expect(result).toBeNull();
  });

  it("uppercases the stateId when querying electedOfficials", async () => {
    mockFindOne.mockResolvedValueOnce(null);
    await getRegionalExecutive(mockDb as never, "US", "pa");
    expect(mockFindOne).toHaveBeenCalledWith(
      expect.objectContaining({ state: "PA" }),
      expect.any(Object)
    );
  });

  it("returns null when the seated official has no party (data integrity edge)", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "US",
      state: "AK",
      officeType: "governor",
      // party is missing or empty string
      party: "",
      characterId: null,
    });

    const result = await getRegionalExecutive(mockDb as never, "US", "AK");
    expect(result).toBeNull();
  });

  it("returns Lord Mayor of Dublin for IE DUB region", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "IE",
      state: "DUB",
      officeType: "governor",
      party: "fine_gael",
    });
    const result = await getRegionalExecutive(mockDb as never, "IE", "DUB");
    expect(result).toEqual({ partyId: "fine_gael", sign: 1, label: "Lord Mayor of Dublin" });
  });

  it("returns Lord Mayor of Cork for IE COR region", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "IE",
      state: "COR",
      officeType: "governor",
      party: "fianna_fail",
    });
    const result = await getRegionalExecutive(mockDb as never, "IE", "COR");
    expect(result).toEqual({ partyId: "fianna_fail", sign: 1, label: "Lord Mayor of Cork" });
  });

  it("returns Mayor of Limerick for IE LIM region", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "IE",
      state: "LIM",
      officeType: "governor",
      party: "lab",
    });
    const result = await getRegionalExecutive(mockDb as never, "IE", "LIM");
    expect(result).toEqual({ partyId: "lab", sign: 1, label: "Mayor of Limerick" });
  });

  it("returns Mayor of Galway for IE GAL region", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "IE",
      state: "GAL",
      officeType: "governor",
      party: "green",
    });
    const result = await getRegionalExecutive(mockDb as never, "IE", "GAL");
    expect(result).toEqual({ partyId: "green", sign: 1, label: "Mayor of Galway" });
  });

  it("returns Cathaoirleach for any other IE region (default)", async () => {
    mockFindOne.mockResolvedValueOnce({
      countryId: "IE",
      state: "KIL",
      officeType: "governor",
      party: "fine_gael",
    });
    const result = await getRegionalExecutive(mockDb as never, "IE", "KIL");
    expect(result).toEqual({ partyId: "fine_gael", sign: 1, label: "Cathaoirleach" });
  });

  it("derives Moderate (sign 2) from tenure past the moderate threshold", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const electedAt = new Date(now.getTime() - 200 * 60 * 60_000); // 200 hourly turns ago
    mockFindOne.mockResolvedValueOnce({
      countryId: "US",
      state: "PA",
      officeType: "governor",
      party: "3",
      electedAt,
    });
    const result = await getRegionalExecutive(mockDb as never, "US", "PA", now, 60);
    expect(result).toEqual({ partyId: "3", sign: 2, label: "Governor" });
  });

  it("derives Strong (sign 3) from long tenure", async () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const electedAt = new Date(now.getTime() - 1000 * 60 * 60_000); // 1000 turns ago
    mockFindOne.mockResolvedValueOnce({
      countryId: "US",
      state: "PA",
      officeType: "governor",
      party: "3",
      electedAt,
    });
    const result = await getRegionalExecutive(mockDb as never, "US", "PA", now, 60);
    expect(result).toEqual({ partyId: "3", sign: 3, label: "Governor" });
  });
});
