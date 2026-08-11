/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhipTabsLayout } from "./whipTabsLayout";

// Avoid the runtime-config fetch in the hook; seed-derived governmentType is
// enough for chamber-chip derivation.
vi.mock("@/hooks/useRuntimeCountryConfig", () => ({
  useRuntimeCountryConfig: (countryId: string) => ({
    config: { countryId: countryId?.toUpperCase(), governmentType: "presidential" },
    loading: false,
    error: null,
  }),
}));

describe("WhipTabsLayout chamber chips — US sub-national enablement", () => {
  it("renders the US State Senate chamber chip on the state-party (non-national) view", () => {
    render(
      <WhipTabsLayout
        countryId="US"
        isNational={false}
        renderBills={() => <div>bills</div>}
        renderLeadership={() => <div>leadership</div>}
      />
    );
    // Federal chambers plus the sub-national chamber chip.
    expect(screen.getByText("Senate")).toBeTruthy();
    expect(screen.getByText("House")).toBeTruthy();
    expect(screen.getByText("State Senate")).toBeTruthy();
  });

  it("renders the US State Senate chamber chip on the national-party view", () => {
    render(
      <WhipTabsLayout
        countryId="US"
        isNational={true}
        renderBills={() => <div>bills</div>}
        renderLeadership={() => <div>leadership</div>}
      />
    );
    expect(screen.getByText("State Senate")).toBeTruthy();
  });
});
