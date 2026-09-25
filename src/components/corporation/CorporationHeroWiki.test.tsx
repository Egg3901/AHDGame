/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, type ComponentProps } from "vitest";
import { CorporationHero } from "./CorporationHero";
import type { CorporationDetail } from "./CorporationPageTypes";

const router = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({
    formatAmount: (amount: number) => `$${amount}`,
    formatPrice: (amount: number) => `$${amount}`,
    formatPriceIn: (amount: number) => `$${amount}`,
    formatFull: (amount: number) => `$${amount}`,
    toInternalFrom: (amount: number) => amount,
  }),
}));
vi.mock("@/contexts/AuthDataContext", () => ({
  useAuthMe: () => ({ user: { enableExperimentalUI: true } }),
}));

function makeCorp(overrides: Partial<CorporationDetail> = {}): CorporationDetail {
  return {
    _id: "corp1",
    sequentialId: 931,
    name: "Acme",
    isPrivate: false,
    sharePrice: 10,
    liquidCapital: 100,
    liquidCurrencyCode: "USD",
    ...overrides,
  } as unknown as CorporationDetail;
}

function renderHero(corp: CorporationDetail, isCeo: boolean) {
  return render(
    <CorporationHero
      corporation={corp}
      ceo={null}
      brandHex="#3b82f6"
      isCeo={isCeo}
      onRefresh={() => {}}
      exchangeLabel="NYSE"
      corpId="931"
    />
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  router.push.mockClear();
});

describe("CorporationHero wiki link gate (#2347)", () => {
  it("links to Wiki only when the page is published", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ history: [] }) })
    );
    renderHero(makeCorp({ wikiPagePublished: true }), true);

    const link = screen.getByRole("link", { name: /Wiki/ });
    expect(link.getAttribute("href")).toBe("/wiki/corp-931");
    expect(screen.queryByRole("button", { name: /Create wiki page/ })).toBeNull();
  });

  it("offers the CEO a create flow instead of a dead link when unpublished", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ history: [] }) })
    );
    renderHero(makeCorp({ wikiPagePublished: false }), true);

    expect(screen.queryByRole("link", { name: /^Wiki$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Create wiki page/ })).toBeTruthy();
  });

  it("shows neither link nor create flow to non-CEOs when unpublished", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ history: [] }) })
    );
    renderHero(makeCorp({ wikiPagePublished: false }), false);

    expect(screen.queryByRole("link", { name: /^Wiki$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Create wiki page/ })).toBeNull();
  });

  it("follows the claim slug to the editor when it is this corporation's page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/wiki/my/claim")
          return { ok: true, json: async () => ({ slug: "corp-931", created: true }) };
        return { ok: false, json: async () => ({ history: [] }) };
      })
    );
    renderHero(makeCorp({ wikiPagePublished: false }), true);

    fireEvent.click(screen.getByRole("button", { name: /Create wiki page/ }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/wiki/corp-931/edit"));
    expect(fetch).toHaveBeenCalledWith(
      "/api/wiki/my/claim",
      expect.objectContaining({
        body: JSON.stringify({ target: "corporation", corporationSequentialId: 931 }),
      })
    );
  });

  it("does not navigate when the claim resolves to a different corporation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/wiki/my/claim")
          return { ok: true, json: async () => ({ slug: "corp-112", created: false }) };
        return { ok: false, json: async () => ({ history: [] }) };
      })
    );
    renderHero(makeCorp({ wikiPagePublished: false }), true);

    const button = screen.getByRole("button", { name: /Create wiki page/ });
    fireEvent.click(button);
    await waitFor(() =>
      expect(button.getAttribute("title")).toMatch(/Could not confirm this corporation/)
    );
    expect(router.push).not.toHaveBeenCalled();
  });
});
