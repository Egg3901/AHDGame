/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enNav from "../../../messages/en/nav.json";
import { SearchResultsClient } from "./SearchResultsClient";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fetchMock = vi.fn<typeof fetch>();

function renderPage(initialQuery: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enNav}>
      <SearchResultsClient initialQuery={initialQuery} />
    </NextIntlClientProvider>
  );
}

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({
      results: [
        {
          type: "commodity",
          id: "steel",
          title: "Steel",
          subtitle: "Market & price data",
          href: "/commodity/steel",
          icon: "📦",
        },
      ],
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SearchResultsClient", () => {
  it("loads page-mode matches and renders links with the localized count", async () => {
    renderPage("steel");
    const link = await screen.findByRole("link", { name: /Steel/ });
    expect(link.getAttribute("href")).toBe("/commodity/steel");
    expect(screen.getByText("1 result")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search/universal?q=steel&view=page",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("submits an edited query in a shareable URL", () => {
    renderPage("");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: " steel & iron " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(push).toHaveBeenCalledWith("/search?q=steel%20%26%20iron");
  });

  it("shows service failures separately from an empty result set", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    renderPage("steel");
    expect(await screen.findByText("Search is unavailable")).toBeTruthy();
    expect(screen.queryByText("No matches found")).toBeNull();
  });

  it("retries a failed search when the same query is submitted again", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    renderPage("steel");
    expect(await screen.findByText("Search is unavailable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("link", { name: /Steel/ })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
  });

  it("shows an empty result state for a successful search without matches", async () => {
    fetchMock.mockResolvedValue(Response.json({ results: [] }));
    renderPage("unmatched");
    expect(await screen.findByText("No matches found")).toBeTruthy();
    expect(screen.getByText("0 results")).toBeTruthy();
  });

  it("does not send requests for short or oversized queries", () => {
    const view = renderPage("x");
    expect(screen.getByText("Enter at least two characters to search.")).toBeTruthy();
    view.unmount();
    renderPage("x".repeat(201));
    expect(screen.getByText("Search terms can be up to 200 characters.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
