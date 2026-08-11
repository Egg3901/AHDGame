/**
 * Unit tests for useLegislatureData hook
 * Tests UK legislature data fetching with parallel API calls
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useLegislatureData } from "../useLegislatureData";

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("useLegislatureData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch all three endpoints in parallel for UK and return data", async () => {
    // Mock responses for all three UK endpoints
    const mockMembersData = {
      totalSeats: 650,
      filledSeats: 100,
      vacantSeats: 550,
      composition: [
        { partyId: "LAB", partyName: "Labour", partyColor: "#E4003B", seats: 45 },
        { partyId: "CON", partyName: "Conservative", partyColor: "#0087DC", seats: 35 },
      ],
      members: [
        {
          characterId: "char1",
          characterName: "John Smith",
          constituency: "Westminster North",
          party: "LAB",
          partyColor: "#E4003B",
          isNPC: false,
        },
      ],
    };

    const mockBillsData = {
      bills: [
        {
          id: "bill1",
          title: "Healthcare Reform Act",
          sponsor: { id: "char1", name: "John Smith" },
          status: "proposed",
          proposedAt: "2024-01-01T00:00:00Z",
          votes: { for: 10, against: 5, abstain: 2 },
        },
      ],
      canPropose: true,
      adminOverride: false,
      total: 1,
      page: 1,
      limit: 50,
    };

    const mockLeadersData = {
      primeMinister: {
        characterId: "pm1",
        characterName: "Prime Minister Name",
        party: "LAB",
        since: "2024-01-01T00:00:00Z",
      },
      oppositionLeader: {
        characterId: "opp1",
        characterName: "Opposition Leader Name",
        party: "CON",
        since: "2024-01-01T00:00:00Z",
      },
      speaker: null,
    };

    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/country/uk/legislature/members")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMembersData),
        });
      }
      if (url.includes("/api/country/uk/legislature/bills")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockBillsData),
        });
      }
      if (url.includes("/api/country/uk/legislature/leaders")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockLeadersData),
        });
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });

    const { result } = renderHook(() => useLegislatureData("UK"));

    // Initially loading
    expect(result.current.loading).toBe(true);
    expect(result.current.members).toBe(null);
    expect(result.current.bills).toBe(null);
    expect(result.current.leaders).toBe(null);

    // Wait for data to load
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Check that all three endpoints were called in parallel
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch).toHaveBeenCalledWith("/api/country/uk/legislature/members", {
      cache: "no-store",
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/country/uk/legislature/bills?page=1", {
      cache: "no-store",
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/country/uk/legislature/leaders", {
      cache: "no-store",
    });

    // Check returned data
    expect(result.current.members).toEqual(mockMembersData);
    expect(result.current.bills).toEqual(mockBillsData);
    expect(result.current.leaders).toEqual(mockLeadersData);
    expect(result.current.error).toBe(null);
  });

  it("should handle errors gracefully and provide error details", async () => {
    // Mock failed responses
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/country/uk/legislature/members")) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });
      }
      if (url.includes("/api/country/uk/legislature/bills")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              bills: [],
              canPropose: false,
              adminOverride: false,
              total: 0,
              page: 1,
              limit: 50,
            }),
        });
      }
      if (url.includes("/api/country/uk/legislature/leaders")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }
      return Promise.reject(new Error("Unknown endpoint"));
    });

    const { result } = renderHook(() => useLegislatureData("UK"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should have error since 2 out of 3 endpoints failed
    expect(result.current.error).not.toBe(null);
    expect(result.current.error?.message).toContain("members");
    expect(result.current.error?.message).toContain("leaders");

    // Bills should still have data (partial success)
    expect(result.current.bills).not.toBe(null);
    expect(result.current.bills?.bills).toEqual([]);

    // Failed endpoints should be null
    expect(result.current.members).toBe(null);
    expect(result.current.leaders).toBe(null);
  });

  it("should refetch data when refetch is called", async () => {
    const mockData = {
      totalSeats: 650,
      filledSeats: 100,
      vacantSeats: 550,
      composition: [],
      members: [],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const { result } = renderHook(() => useLegislatureData("UK"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Initial fetch should have been called 3 times
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Clear mocks and refetch
    mockFetch.mockClear();

    // Call refetch
    result.current.refetch();

    // Should fetch again
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  it("should handle network errors", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useLegislatureData("UK"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).not.toBe(null);
    expect(result.current.members).toBe(null);
    expect(result.current.bills).toBe(null);
    expect(result.current.leaders).toBe(null);
  });

  it("should route to correct US Congress endpoints", async () => {
    const mockCongressData = { members: [] };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCongressData),
    });

    renderHook(() => useLegislatureData("US"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Should call US legislature endpoints via URL helper
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/api/country/us/legislature"), {
      cache: "no-store",
    });
  });
});
