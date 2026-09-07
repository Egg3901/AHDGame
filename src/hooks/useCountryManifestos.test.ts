/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCountryManifestos } from "./useCountryManifestos";
import { MAX_MANIFESTO_ELECTION_IDS } from "@/lib/db/types/manifesto";

const body = (manifestos: Record<string, unknown>) => ({
  catalog: [{ id: "uk.nhs.universal", label: "A universal NHS", policyDomain: "health" }],
  pledgeCount: 3,
  isPartyLeader: true,
  party: { id: "1", name: "Labour" },
  manifestos,
});

function mockFetch(...bodies: Array<Record<string, unknown>>) {
  const fn = vi.fn();
  for (const b of bodies) fn.mockResolvedValueOnce({ ok: true, json: async () => b });
  global.fetch = fn;
  return fn;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("useCountryManifestos", () => {
  it("fetches every election on the page in a single request", async () => {
    const fetchMock = mockFetch(body({ e1: null, e2: { pledges: [], locked: false } }));

    const { result } = renderHook(() => useCountryManifestos("uk", ["e1", "e2"]));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/country/uk/elections/manifestos?electionIds=e1%2Ce2"
    );
    expect(result.current?.isPartyLeader).toBe(true);
    expect(result.current?.manifestos.e2).toEqual({ pledges: [], locked: false });
  });

  /**
   * Every other fetch on the elections page bounds itself (`AbortSignal.timeout`
   * in ElectionsClient). One request now backs every manifesto bar on the page,
   * so an unbounded hang would leave all of them stuck instead of just one.
   */
  it("bounds the request so a hung origin cannot stall every bar", async () => {
    const fetchMock = mockFetch(body({ e1: null }));
    const { result } = renderHook(() => useCountryManifestos("uk", ["e1"]));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not fetch when the page shows no elections", () => {
    const fetchMock = mockFetch();
    const { result } = renderHook(() => useCountryManifestos("uk", []));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("does not refetch when the same ids arrive in a new array", async () => {
    const fetchMock = mockFetch(body({ e1: null }), body({ e1: null }));
    const { result, rerender } = renderHook(({ ids }) => useCountryManifestos("uk", ids), {
      initialProps: { ids: ["e1"] },
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    rerender({ ids: ["e1"] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("chunks an oversized list instead of exceeding the route's cap", async () => {
    const ids = Array.from({ length: MAX_MANIFESTO_ELECTION_IDS + 2 }, (_, i) => `e${i}`);
    const fetchMock = mockFetch(
      body({ e0: null }),
      body({ [`e${MAX_MANIFESTO_ELECTION_IDS}`]: null })
    );

    const { result } = renderHook(() => useCountryManifestos("uk", ids));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Merged into one lookup across both chunks.
    expect(result.current?.manifestos).toHaveProperty("e0");
    expect(result.current?.manifestos).toHaveProperty(`e${MAX_MANIFESTO_ELECTION_IDS}`);
  });

  it("stays null when the request fails, so the bar hides rather than lying", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useCountryManifestos("uk", ["e1"]));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
