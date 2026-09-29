/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enNav from "../../messages/en/nav.json";
import { UniversalSearch } from "./UniversalSearch";
import type { SearchResult } from "@/lib/search/types";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const result: SearchResult = {
  type: "commodity",
  id: "steel",
  title: "Steel",
  subtitle: "Market & price data",
  href: "/commodity/steel",
  icon: "📦",
};
const fetchMock = vi.fn<typeof fetch>();

function renderSearch(inDialog = false, onNavigate = vi.fn()) {
  const search = <UniversalSearch onNavigate={onNavigate} />;
  const view = render(
    <NextIntlClientProvider locale="en" messages={enNav}>
      {inDialog ? <div role="dialog">{search}</div> : search}
    </NextIntlClientProvider>
  );
  const input = screen.getByRole("combobox");
  fireEvent.focus(input);
  return { ...view, input, onNavigate };
}

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(Response.json({ results: [result] }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UniversalSearch", () => {
  it("opens suggestions when the empty input receives focus", () => {
    renderSearch();
    expect(screen.getByText("Try searching for")).toBeTruthy();
    expect(screen.getByRole("button", { name: /California/ })).toBeTruthy();
  });

  it("submits Enter before autocomplete has loaded", () => {
    const { input, onNavigate } = renderSearch();
    fireEvent.change(input, { target: { value: " steel & iron " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=steel%20%26%20iron");
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits plain Enter even when autocomplete matches are visible", async () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "steel" } });
    await screen.findByRole("option", { name: /Steel/ });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=steel");
  });

  it("opens an explicitly selected keyboard match directly", async () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "steel" } });
    await screen.findByRole("option", { name: /Steel/ });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/commodity/steel");
  });

  it("keeps matches inside the mobile dialog and opens a clicked match", async () => {
    const { input, onNavigate } = renderSearch(true);
    fireEvent.change(input, { target: { value: "steel" } });
    const option = await screen.findByRole("option", { name: /Steel/ });
    expect(option.closest('[role="dialog"]')).toBe(screen.getByRole("dialog"));
    fireEvent.click(option);
    expect(push).toHaveBeenCalledWith("/commodity/steel");
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("clears the selected suggestion when Escape closes the popup", async () => {
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "steel" } });
    await screen.findByRole("option", { name: /Steel/ });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/search?q=steel");
  });

  it("does not reopen a dismissed popup when an outstanding search completes", async () => {
    let resolveResponse: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      })
    );
    const { input } = renderSearch();
    fireEvent.change(input, { target: { value: "steel" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    fireEvent.mouseDown(document.body);
    await act(async () => resolveResponse(Response.json({ results: [result] })));
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("aborts an outstanding request on unmount", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    const { input, unmount } = renderSearch();
    fireEvent.change(input, { target: { value: "steel" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
