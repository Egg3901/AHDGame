/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { OrgProvider, useOrg, type OrgContextValue } from "./OrgProvider";
import type { ReactNode } from "react";

const value = {
  org: { id: "EU" },
  viewer: null,
  currentTurn: 100,
  votingWindowTurns: 24,
  refresh: () => {},
} as unknown as OrgContextValue;

describe("useOrg", () => {
  it("returns the provided context inside OrgProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <OrgProvider value={value}>{children}</OrgProvider>
    );
    const { result } = renderHook(() => useOrg(), { wrapper });
    expect(result.current.currentTurn).toBe(100);
  });

  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useOrg())).toThrow();
  });
});
