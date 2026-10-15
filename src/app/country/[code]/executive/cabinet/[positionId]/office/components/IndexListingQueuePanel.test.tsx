// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IndexListingQueuePanel } from "./IndexListingQueuePanel";

const payload = {
  seat: { seatId: "competition", seatName: "Board of Trade" },
  petitions: [
    {
      id: "p1",
      corporationId: "corp1",
      corporationName: "Northern Steel",
      filedAtTurn: 10,
      deadlineAtTurn: 18,
      contributionAnchor: 12345,
    },
  ],
};

function mockFetch(body: unknown) {
  return vi
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve({ ok: true, json: async () => (init?.method === "POST" ? {} : body) })
    );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("IndexListingQueuePanel", () => {
  it("shows petitions with a corporation link and fee", async () => {
    vi.stubGlobal("fetch", mockFetch(payload));
    render(<IndexListingQueuePanel canAct />);
    expect((await screen.findByRole("link", { name: "Northern Steel" })).getAttribute("href")).toBe(
      "/corporation/corp1"
    );
    expect(screen.getByText(/₳12,345/)).toBeTruthy();
  });

  it("grants a petition and reloads the queue", async () => {
    const fetchMock = mockFetch(payload);
    vi.stubGlobal("fetch", fetchMock);
    render(<IndexListingQueuePanel canAct />);
    fireEvent.click(await screen.findByRole("button", { name: "Grant" }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/index-petitions/p1/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grant: true }),
      });
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/index-petitions")).toHaveLength(
        2
      );
    });
  });

  it("renders nothing when there is no seat", async () => {
    const json = vi.fn().mockResolvedValue({ seat: null, petitions: [] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));
    const { container } = render(<IndexListingQueuePanel canAct />);
    await waitFor(() => expect(json).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("disables decisions when the office cannot act", async () => {
    vi.stubGlobal("fetch", mockFetch(payload));
    render(<IndexListingQueuePanel canAct={false} />);
    expect((await screen.findByRole("button", { name: "Grant" })).hasAttribute("disabled")).toBe(
      true
    );
    expect(screen.getByRole("button", { name: "Refuse" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows the empty queue for a seat holder", async () => {
    vi.stubGlobal("fetch", mockFetch({ ...payload, petitions: [] }));
    render(<IndexListingQueuePanel canAct />);
    expect(await screen.findByText("No index listing requests are waiting for you.")).toBeTruthy();
  });

  it("shows a failed decision inline", async () => {
    const fetchMock = mockFetch(payload);
    vi.stubGlobal("fetch", fetchMock);
    render(<IndexListingQueuePanel canAct />);
    const refuse = await screen.findByRole("button", { name: "Refuse" });
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Decision failed" }),
    });
    fireEvent.click(refuse);
    expect(await screen.findByText("Decision failed")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/index-petitions/p1/decide",
      expect.objectContaining({ body: '{"grant":false}' })
    );
  });
});
