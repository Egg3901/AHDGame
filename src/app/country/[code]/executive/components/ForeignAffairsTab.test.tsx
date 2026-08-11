// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ForeignAffairsTab } from "./ForeignAffairsTab";

vi.mock("@/lib/hooks/useEnabledCountryIds", () => ({
  useEnabledCountryIds: () => ["US", "CN"],
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ currentTurn: 40, wars: [], offers: [], truces: [] }),
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ForeignAffairsTab", () => {
  it("mounts both the declaration and the negotiation panels", async () => {
    // Exact strings, not regexes: the declaration panel's own button reads
    // "File declaration of war" and would match a loose pattern too.
    render(<ForeignAffairsTab countryId="US" canAct />);
    expect(await screen.findByText("Declaration of war")).toBeTruthy();
    expect(await screen.findByText("Peace negotiations")).toBeTruthy();
  });

  it("passes canAct through, so a non-leader cannot act", async () => {
    // The two panels express read-only differently — the declaration panel keeps
    // its button and disables it, the peace panel drops its form. Both badge the
    // card. This asserts what each actually does rather than assuming one style.
    render(<ForeignAffairsTab countryId="US" canAct={false} />);
    await screen.findByText("Declaration of war");
    expect(
      screen.getByRole("button", { name: /file declaration of war/i }).hasAttribute("disabled")
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /send peace offer/i })).toBeNull();
    expect(screen.getAllByText(/Read-only/i).length).toBeGreaterThanOrEqual(1);
  });

  it("gives the leader a live control", async () => {
    render(<ForeignAffairsTab countryId="US" canAct />);
    const button = await screen.findByRole("button", { name: /file declaration of war/i });
    // Enabled once a target and goal are chosen; what matters here is that the
    // read-only gate is not what is holding it shut.
    expect(screen.queryAllByText(/Read-only/i)).toHaveLength(0);
    expect(button).toBeTruthy();
  });

  it("lowercases the country for the API paths the panels call", async () => {
    // The shells carry an uppercase CountryId; the routes live at /api/country/us/.
    render(<ForeignAffairsTab countryId="US" canAct />);
    const calls = (globalThis.fetch as unknown as { mock: { calls: string[][] } }).mock.calls;
    expect(calls.some((c) => String(c[0]).includes("/api/country/us/"))).toBe(true);
    expect(calls.every((c) => !String(c[0]).includes("/api/country/US/"))).toBe(true);
  });

  it("puts the declaration above the negotiations", async () => {
    // Reads war → peace, the order the actions happen in.
    const { container } = render(<ForeignAffairsTab countryId="US" canAct />);
    await screen.findByText("Declaration of war");
    const text = container.textContent ?? "";
    expect(text.indexOf("Declaration of war")).toBeLessThan(text.indexOf("Peace negotiations"));
  });
});
