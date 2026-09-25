/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import WatchlistPanel from "./WatchlistPanel";

const USER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

const MANGO_HIT = {
  id: "char-mango",
  userId: USER_ID,
  name: "Mango Freeman",
  username: "mango",
  discordUsername: "mango_d",
  homeState: "PA",
  currentOffice: "Governor",
};

function emptyWatchlist() {
  return { ok: true, json: async () => ({ entries: [], currentTurn: 7 }) };
}

function entryFor(userId: string, username: string) {
  return {
    id: "wl-1",
    userId,
    username,
    banned: false,
    addedBy: "mod-1",
    addedByName: "Mod",
    reason: "Alt suspect",
    createdAt: new Date().toISOString(),
    lastNotifiedTurn: null,
    activity: { totalActions: 0, lastActionAt: null, lastActionTurn: null, recentActions: [] },
    alerts: {
      sinceTurn: 7,
      newActivityCount: 0,
      hasNewActivity: false,
      newLinks: [],
      hasNewLinks: false,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WatchlistPanel player search", () => {
  it("keeps direct user ID entry for banned accounts excluded from public search", async () => {
    const post = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { userId: string };
      return { ok: true, json: async () => ({ entry: entryFor(body.userId, "banned-user") }) };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/admin/watchlist" && init?.method === "POST") {
          return post(url, init);
        }
        return emptyWatchlist();
      })
    );

    render(<WatchlistPanel />);
    await waitFor(() => expect(screen.getByText("Nothing pinned yet")).toBeTruthy());

    const add = screen.getByRole("button", { name: "Add to watchlist" });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("24-character user ID"), {
      target: { value: USER_ID },
    });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);

    await waitFor(() => expect(post).toHaveBeenCalledOnce());
    expect(JSON.parse(post.mock.calls[0]![1]!.body as string)).toEqual({ userId: USER_ID });
  });

  it("searches, selects, and submits the picked player", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.startsWith("/api/characters/search")) {
          return { ok: true, json: async () => ({ results: [MANGO_HIT] }) } as Response;
        }
        if (url === "/api/admin/watchlist" && init?.method === "POST") {
          const body = JSON.parse(init.body as string) as { userId: string; reason?: string };
          return {
            ok: true,
            json: async () => ({ entry: entryFor(body.userId, "mango") }),
          } as Response;
        }
        return emptyWatchlist() as Response;
      })
    );

    render(<WatchlistPanel />);
    await waitFor(() => expect(screen.getByText("Nothing pinned yet")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "mango" } });
    await waitFor(() => expect(screen.getByText("Mango Freeman")).toBeTruthy());

    // Select the hit; the picked chip replaces the search input.
    const hitButton = screen.getByText("Mango Freeman").closest("button");
    expect(hitButton).toBeTruthy();
    fireEvent.click(hitButton!);
    expect(screen.getByLabelText("Clear selected player")).toBeTruthy();
    expect(screen.queryByLabelText("Search players")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Why is this account being watched?"), {
      target: { value: "Alt suspect" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to watchlist" }));

    await waitFor(() => expect(screen.getByText("Pinned mango to the watchlist.")).toBeTruthy());

    const post = calls.find((c) => c.url === "/api/admin/watchlist" && c.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.init!.body as string)).toEqual({
      userId: USER_ID,
      reason: "Alt suspect",
    });
  });

  it("ignores a stale search response that resolves after a newer one", async () => {
    let resolveAlpha: ((v: unknown) => void) | null = null;
    let resolveBeta: ((v: unknown) => void) | null = null;
    const fetchedTerms: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/characters/search")) {
          const q = new URL(url, "http://localhost").searchParams.get("q") ?? "";
          fetchedTerms.push(q);
          if (q === "alpha") {
            return new Promise((resolve) => {
              resolveAlpha = resolve;
            }) as Promise<Response>;
          }
          return new Promise((resolve) => {
            resolveBeta = resolve;
          }) as Promise<Response>;
        }
        return emptyWatchlist() as Response;
      })
    );

    const alphaHit = { ...MANGO_HIT, id: "char-alpha", name: "Alpha Hit" };
    const betaHit = { ...MANGO_HIT, id: "char-beta", name: "Beta Hit" };

    render(<WatchlistPanel />);
    await waitFor(() => expect(screen.getByText("Nothing pinned yet")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "alpha" } });
    await waitFor(() => expect(fetchedTerms).toContain("alpha"));

    fireEvent.change(screen.getByLabelText("Search players"), { target: { value: "alphab" } });
    await waitFor(() => expect(fetchedTerms).toContain("alphab"));

    // Newer term resolves first, then the stale one lands late.
    resolveBeta!({ ok: true, json: async () => ({ results: [betaHit] }) });
    await waitFor(() => expect(screen.getByText("Beta Hit")).toBeTruthy());
    resolveAlpha!({ ok: true, json: async () => ({ results: [alphaHit] }) });

    // Flush the late resolution, then confirm it did not clobber the dropdown.
    await waitFor(() => expect(screen.getByText("Beta Hit")).toBeTruthy());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Alpha Hit")).toBeNull();
    expect(screen.getByText("Beta Hit")).toBeTruthy();
  });
});
