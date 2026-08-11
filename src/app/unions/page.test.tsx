/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import UnionsPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnionsPage — labourSystemMode below "full"', () => {
  it("shows a clear not-enabled state instead of a broken error page with fake stats", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Player-run unions are not enabled." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    render(<UnionsPage />);

    await waitFor(() =>
      expect(screen.getByText("Unions aren't live in this world yet")).toBeTruthy()
    );

    // The old bug: a stats bar claiming real numbers, and copy asserting
    // unions already exist everywhere, rendered directly above an error.
    expect(screen.queryByText("Led Unions")).toBeNull();
    expect(screen.queryByText(/Every industry already has a union/)).toBeNull();
    expect(screen.queryByText("Couldn't load unions")).toBeNull();
  });
});

describe('UnionsPage — labourSystemMode at "full"', () => {
  it("still shows the normal leaderboard chrome when the feature is actually enabled", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unions: [], bannedCountries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    render(<UnionsPage />);

    await waitFor(() => expect(screen.getByText("Led Unions")).toBeTruthy());
    expect(screen.getByText(/Every industry already has a union/)).toBeTruthy();
    expect(screen.queryByText("Unions aren't live in this world yet")).toBeNull();
  });
});
