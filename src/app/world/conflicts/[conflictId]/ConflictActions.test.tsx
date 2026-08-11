// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConflictActions } from "./ConflictActions";

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ oddsPct: 46, counterOddsPct: 52, unopposed: false }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = {
  theaterId: "front-1",
  countryCode: "us",
  positionId: "secretary_of_defense",
  targets: ["CN", "RU"],
  pendingTarget: null as string | null,
};

/** The forecast URL for a target, once requested. */
function forecastUrl(target: string): string | undefined {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .find((u) => u.includes("battle/forecast") && u.includes(`targetCountry=${target}`));
}

describe("ConflictActions", () => {
  it("projects the engagement against the selected target", async () => {
    render(<ConflictActions {...base} />);
    await waitFor(() => expect(forecastUrl("CN")).toBeTruthy());
    const url = forecastUrl("CN")!;
    expect(url).toContain("/api/country/us/executive/cabinet/secretary_of_defense/battle/forecast");
    expect(url).toContain("theaterId=front-1");
    await waitFor(() => expect(screen.getByText("46%")).toBeTruthy());
    expect(screen.getByText("52%")).toBeTruthy();
  });

  it("declares an offensive against the selected target", async () => {
    render(<ConflictActions {...base} />);
    await waitFor(() => expect(forecastUrl("CN")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /declare/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        (c) => String(c[0]).includes("battle/declare") && c[1]?.method === "POST"
      );
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1].body))).toEqual({
        theaterId: "front-1",
        targetCountry: "CN",
      });
    });
  });

  it("withdraws a pending offensive instead of offering another", async () => {
    render(<ConflictActions {...base} pendingTarget="CN" />);
    expect(screen.queryByRole("button", { name: /^declare/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[1]?.method === "DELETE");
      expect(call).toBeTruthy();
      expect(String(call![0])).toContain("theaterId=front-1");
    });
  });

  it("names the pending target", () => {
    render(<ConflictActions {...base} pendingTarget="CN" />);
    expect(screen.getByText(/CN/)).toBeTruthy();
  });

  it("shows recent offensive declaration history", () => {
    render(
      <ConflictActions
        {...base}
        declarationHistory={[
          {
            id: "d1",
            declarerCountry: "DD",
            targetCountry: "US",
            declaredTurn: 429,
            resolvedTurn: 430,
            status: "resolved",
            outcome: "Victory",
            favorable: true,
          },
        ]}
      />
    );
    expect(screen.getByText(/recent offensives/i)).toBeTruthy();
    expect(screen.getByText(/T429 · DD → US/)).toBeTruthy();
  });

  // The list said only "resolved T430" — that the turn processor reached it, not what
  // it did. A player who had run three winning offensives could not tell from here
  // that any of them had won.
  it("names the outcome of a finished offensive, not just that it resolved", () => {
    render(
      <ConflictActions
        {...base}
        declarationHistory={[
          {
            id: "d1",
            declarerCountry: "DD",
            targetCountry: "US",
            declaredTurn: 429,
            resolvedTurn: 430,
            status: "resolved",
            outcome: "Decisive Victory",
            favorable: true,
          },
        ]}
      />
    );
    expect(screen.getByText(/Decisive Victory · T430/)).toBeTruthy();
    expect(screen.queryByText(/^resolved T430$/)).toBeNull();
  });

  // A walkover is why this mattered: the engagement list drops no-contact reports, so
  // an unopposed advance showed a front that claimed never to have been contested.
  it("names an unopposed advance", () => {
    render(
      <ConflictActions
        {...base}
        declarationHistory={[
          {
            id: "d1",
            declarerCountry: "DD",
            targetCountry: "US",
            declaredTurn: 446,
            resolvedTurn: 448,
            status: "resolved",
            outcome: "unopposed advance",
            favorable: true,
          },
        ]}
      />
    );
    expect(screen.getByText(/unopposed advance · T448/)).toBeTruthy();
  });

  it("keeps the current odds visible while an offensive is pending", async () => {
    render(<ConflictActions {...base} pendingTarget="CN" />);
    await waitFor(() => expect(screen.getByText("46%")).toBeTruthy());
    expect(screen.getByText("52%")).toBeTruthy();
  });

  it("says so when there is nobody to attack", () => {
    render(<ConflictActions {...base} targets={[]} />);
    expect(screen.getByText(/no opposing nation/i)).toBeTruthy();
  });

  it("surfaces a failed projection rather than pretending", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<ConflictActions {...base} />);
    await waitFor(() => expect(screen.getByText(/projection unavailable/i)).toBeTruthy());
  });
  // The routes re-check authority, opposing side, forces present and duplicates.
  // Fire-and-forget would leave the panel claiming an offensive the server refused.
  it("rolls back and surfaces the reason when a declaration is refused", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (String(url).includes("battle/declare") && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "No forces committed at this theater" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ oddsPct: 46, counterOddsPct: 52, unopposed: false }),
      });
    });

    render(<ConflictActions {...base} />);
    await waitFor(() => expect(screen.getByText("46%")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /declare/i }));

    await waitFor(() =>
      expect(screen.getByText(/no forces committed at this theater/i)).toBeTruthy()
    );
    // …and the panel is back to offering a declaration, not claiming a pending one.
    expect(screen.getByRole("button", { name: /declare/i })).toBeTruthy();
    expect(screen.queryByText(/offensive pending/i)).toBeNull();
  });

  it("rolls back a refused withdrawal", async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (init?.method === "DELETE") {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: "No pending offensive" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ oddsPct: 46, counterOddsPct: 52, unopposed: false }),
      });
    });

    render(<ConflictActions {...base} pendingTarget="CN" />);
    fireEvent.click(screen.getByRole("button", { name: /withdraw/i }));

    await waitFor(() => expect(screen.getByText(/no pending offensive/i)).toBeTruthy());
    expect(screen.getByText(/offensive pending against CN/i)).toBeTruthy();
  });
});
