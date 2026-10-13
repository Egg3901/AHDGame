/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DepositorBookPanel } from "./DepositorBookPanel";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { amount: string }) =>
    values ? key + ": " + values.amount : key,
}));
afterEach(cleanup);

describe("depositors panel", () => {
  it("links named characters, shows unknown owners safely, and separates households", () => {
    render(
      <DepositorBookPanel
        currency="USD"
        householdDeposits={800}
        book={{
          source: "accounts",
          total: 350,
          rows: [
            { key: "one", type: "character", name: "First", sequentialId: 42, balance: 300 },
            { key: "private-key", type: "character", name: null, sequentialId: null, balance: 50 },
          ],
        }}
      />
    );
    expect(screen.getByRole("link", { name: "First" }).getAttribute("href")).toBe("/character/42");
    expect(screen.getByText("unknown")).toBeTruthy();
    expect(screen.queryByText("private-id")).toBeNull();
    expect(screen.getByText("$350")).toBeTruthy();
    expect(screen.getByText("households: $800")).toBeTruthy();
    expect(screen.queryByText("legacy")).toBeNull();
  });

  it("explains empty legacy accounts", () => {
    render(
      <DepositorBookPanel
        currency="GBP"
        householdDeposits={0}
        book={{ source: "legacy", rows: [], total: 0 }}
      />
    );
    expect(screen.getByText("legacy")).toBeTruthy();
    expect(screen.getByText("empty")).toBeTruthy();
  });

  it("does not link a character when its public sequential id is absent", () => {
    render(
      <DepositorBookPanel
        currency="USD"
        householdDeposits={0}
        book={{
          source: "accounts",
          total: 25,
          rows: [
            {
              key: "opaque-key",
              type: "character",
              name: "No public link",
              sequentialId: null,
              balance: 25,
            },
          ],
        }}
      />
    );
    expect(screen.getByText("No public link").closest("a")).toBeNull();
  });
});
