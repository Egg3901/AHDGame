/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WikiSiteHeader, wikiPageHref } from "./WikiSiteHeader";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => pushMock(...args),
  }),
}));

describe("WikiSiteHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { slug: "getting-started", title: "Getting Started", description: "New player guide" },
          ],
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("links home, play, and docs", () => {
    render(
      <WikiSiteHeader
        playUrl="https://ahousedividedgame.com"
        docsUrl="https://docs.lakesidegames.net"
      />
    );

    expect(screen.getByRole("link", { name: "Wiki" }).getAttribute("href")).toBe("/wiki");
    expect(screen.getByRole("link", { name: "Play" }).getAttribute("href")).toBe(
      "https://ahousedividedgame.com"
    );
    expect(screen.getByRole("link", { name: "Docs" }).getAttribute("href")).toBe(
      "https://docs.lakesidegames.net"
    );
  });

  it("searches published pages and links results under /wiki", async () => {
    render(
      <WikiSiteHeader
        playUrl="https://ahousedividedgame.com"
        docsUrl="https://docs.lakesidegames.net"
      />
    );

    fireEvent.change(screen.getByRole("combobox", { name: /search wiki/i }), {
      target: { value: "getting" },
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/wiki/search?q=getting&limit=8",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const result = await screen.findByRole("link", { name: /Getting Started/i });
    expect(result.getAttribute("href")).toBe(wikiPageHref("getting-started"));
  });

  it("navigates to the active result on Enter", async () => {
    render(
      <WikiSiteHeader
        playUrl="https://ahousedividedgame.com"
        docsUrl="https://docs.lakesidegames.net"
      />
    );

    const input = screen.getByRole("combobox", { name: /search wiki/i });
    fireEvent.change(input, { target: { value: "getting" } });
    await screen.findByRole("link", { name: /Getting Started/i });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(pushMock).toHaveBeenCalledWith("/wiki/getting-started");
  });
});
