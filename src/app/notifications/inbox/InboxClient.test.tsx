/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useInboxData } from "./useInboxData";
import { InboxClient } from "./InboxClient";
import type { InboxItem } from "@/lib/inbox";

vi.mock("./useInboxData", () => ({ useInboxData: vi.fn() }));

const mockUseInboxData = vi.mocked(useInboxData);

function notif(id: string): InboxItem {
  return {
    id,
    kind: "notif",
    category: "crisis",
    label: "Crisis",
    urgency: "urgent",
    unread: true,
    action: true,
    createdAt: new Date().toISOString(),
    time: "now",
    title: `Title ${id}`,
    body: `Body ${id}`,
  };
}

function hookResult(items: InboxItem[], refetch: () => void) {
  return {
    items,
    loading: false,
    error: null as string | null,
    refetch,
    counts: {
      all: items.filter((i) => i.unread).length,
      notifs: items.filter((i) => i.kind === "notif" && i.unread).length,
      mail: 0,
      action: items.filter((i) => i.action && i.unread).length,
    },
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => ResponseLike) {
  global.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    return handler(url, init) as unknown as Response;
  }) as unknown as typeof fetch;
}

type ResponseLike = { ok: boolean; status: number; json: () => Promise<unknown> };

const okJson = (body: unknown): ResponseLike => ({
  ok: true,
  status: 200,
  json: async () => body,
});

describe("InboxClient handleMarkAllRead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success: PATCHes every unread item, clears the unread count, shows no error", async () => {
    const refetch = vi.fn();
    mockUseInboxData.mockReturnValue(hookResult([notif("n1"), notif("n2")], refetch));
    mockFetch((url, init) => {
      if (url === "/api/notifications" && init?.method === "PATCH") {
        return okJson({ success: true });
      }
      return okJson(null);
    });

    render(<InboxClient />);

    const button = await screen.findByRole("button", { name: "Mark all read" });
    fireEvent.click(button);

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([url, init]: [string, RequestInit | undefined]) =>
          url === "/api/notifications" && init?.method === "PATCH"
      );
      expect(calls).toHaveLength(2);
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/0 items need/);
    });
  });

  it("failure: shows an error, rolls back to unread, and refetches server state", async () => {
    const refetch = vi.fn();
    mockUseInboxData.mockReturnValue(hookResult([notif("n1"), notif("n2")], refetch));
    mockFetch((url, init) => {
      if (url === "/api/notifications" && init?.method === "PATCH") {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return okJson(null);
    });

    render(<InboxClient />);

    const button = await screen.findByRole("button", { name: "Mark all read" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn't mark everything as read/);

    // Optimistic readIds were rolled back: the unread count returns.
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/2 items need/);
    });
    expect(refetch).toHaveBeenCalled();
  });

  it("partial failure: rolls back only the failed item", async () => {
    const refetch = vi.fn();
    mockUseInboxData.mockReturnValue(hookResult([notif("n1"), notif("n2")], refetch));
    mockFetch((url, init) => {
      if (url === "/api/notifications" && init?.method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { id?: string };
        if (body.id === "n2") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return okJson({ success: true });
      }
      return okJson(null);
    });

    render(<InboxClient />);

    const button = await screen.findByRole("button", { name: "Mark all read" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Some items couldn't be marked as read/);

    // n1 stayed read, n2 rolled back: one item still needs input.
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/1 item needs/);
    });
    expect(refetch).toHaveBeenCalled();
  });
});
