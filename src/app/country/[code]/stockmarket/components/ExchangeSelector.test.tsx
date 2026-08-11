/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ExchangeSelector } from "./ExchangeSelector";
import type { ExchangeMetaEntry } from "../stockMarketRouting";

// global + the six player-visible exchanges, with SSE (China) last — the real
// runtime order. SSE is the entry that was being clipped off the mobile dropdown.
const META: Record<string, ExchangeMetaEntry> = {
  global: {
    title: "Stock Market",
    subtitle: "All listed corporations worldwide",
    exchangeApi: "global",
  },
  US: { title: "NYSE", subtitle: "NYSE - United States", exchangeApi: "nyse" },
  UK: { title: "FTSE", subtitle: "FTSE - United Kingdom", exchangeApi: "ftse" },
  DE: { title: "DAX", subtitle: "DAX - Germany", exchangeApi: "dax" },
  JP: { title: "Nikkei", subtitle: "Nikkei - Japan", exchangeApi: "nikkei" },
  IE: { title: "ISEQ", subtitle: "ISEQ - Ireland", exchangeApi: "iseq" },
  CN: { title: "SSE", subtitle: "SSE - China", exchangeApi: "sse" },
};

function openMobileDropdown() {
  fireEvent.click(screen.getByRole("button", { name: /exchange filter/i }));
  return screen.getByRole("listbox");
}

describe("ExchangeSelector mobile dropdown", () => {
  it("lists every exchange, including the last one (SSE)", () => {
    render(<ExchangeSelector exchangeMeta={META} exchangeFilter="global" onSelect={() => {}} />);

    const listbox = openMobileDropdown();
    const labels = within(listbox)
      .getAllByRole("option")
      .map((o) => o.textContent);

    expect(labels).toEqual(["Global", "NYSE", "FTSE", "DAX", "Nikkei", "ISEQ", "SSE"]);
  });

  it("renders outside overflow-clipping ancestors so the last exchange is not cut off", () => {
    // The real hero header is `overflow-hidden` (rounded image), which clips an
    // absolutely-positioned dropdown. The dropdown must escape that ancestor.
    const { getByTestId } = render(
      <div data-testid="clip" style={{ overflow: "hidden" }}>
        <ExchangeSelector exchangeMeta={META} exchangeFilter="global" onSelect={() => {}} />
      </div>
    );

    const listbox = openMobileDropdown();

    expect(getByTestId("clip").contains(listbox)).toBe(false);
    expect(document.body.contains(listbox)).toBe(true);
  });

  it("selects an exchange by clicking its option", () => {
    const selected: string[] = [];
    render(
      <ExchangeSelector
        exchangeMeta={META}
        exchangeFilter="global"
        onSelect={(key) => selected.push(key)}
      />
    );

    const listbox = openMobileDropdown();
    fireEvent.click(within(listbox).getByRole("option", { name: "SSE" }));

    expect(selected).toEqual(["CN"]);
  });
});
