/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WikiSiteHeader, wikiAccountFromNav, wikiGamePath, wikiPageHref } from "./WikiSiteHeader";
import type { ClientNavBootstrap } from "@/contexts/AuthDataContext";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (...args: unknown[]) => pushMock(...args),
  }),
}));

const { authState } = vi.hoisted(() => ({
  authState: {
    user: null as Record<string, unknown> | null,
    loading: false,
    navData: null as ClientNavBootstrap | null,
    refetch: vi.fn(),
    authFetchError: "none" as const,
  },
}));

vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => authState,
}));

const signedInNav = {
  user: {
    username: "alice",
    character: {
      name: "Alice Sterling",
      avatarUrl: "https://cdn.example/alice.png",
      borderKey: null,
      tintColor: null,
    },
  },
  characterName: "Alice Sterling",
  isImperialMode: false,
} as unknown as ClientNavBootstrap;

describe("WikiSiteHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = null;
    authState.loading = false;
    authState.navData = null;
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

  it("links home, play, docs, and sign-in on the main game site", () => {
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
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      wikiGamePath("https://ahousedividedgame.com", "/login")
    );
  });

  it("shows the Lakeside-auth profile avatar and a Profile link to the main site", () => {
    authState.user = signedInNav.user;
    authState.navData = signedInNav;

    render(
      <WikiSiteHeader
        playUrl="https://ahousedividedgame.com"
        docsUrl="https://docs.lakesidegames.net"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Alice Sterling" }));
    expect(screen.getByRole("menuitem", { name: "Profile" }).getAttribute("href")).toBe(
      "https://ahousedividedgame.com/profile"
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

describe("wikiAccountFromNav", () => {
  it("uses the character portrait when Lakeside auth has an active character", () => {
    expect(wikiAccountFromNav(signedInNav)).toEqual({
      name: "Alice Sterling",
      avatarUrl: "https://cdn.example/alice.png",
      borderKey: null,
      tintColor: null,
    });
  });

  it("falls back to the Lakeside username when there is no character", () => {
    expect(
      wikiAccountFromNav({
        user: { username: "bob", character: null },
        characterName: null,
        isImperialMode: false,
      } as unknown as ClientNavBootstrap)
    ).toEqual({
      name: "bob",
      avatarUrl: null,
      borderKey: null,
      tintColor: null,
    });
  });
});
