// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { barredScopesFor, type CabinetLeverScope } from "@/lib/cabinet/rules";
import { actingLock } from "./ActingLock";
import { ActingOfficeNotice } from "./ActingOfficeNotice";

afterEach(cleanup);

describe("acting cabinet authority", () => {
  it("unlocks all office capabilities for the acting holder's briefing payload", () => {
    const member = { acting: true, barredScopes: barredScopesFor({ acting: true }) };
    for (const scope of [
      "stance",
      "personnel",
      "doctrine",
      "procurement",
      "treasury",
      "assets",
    ] as CabinetLeverScope[]) {
      expect(actingLock(member, scope)).toBeNull();
    }
  });

  it("does not relock capabilities from a stale briefing payload", () => {
    const scopes: CabinetLeverScope[] = [
      "stance",
      "personnel",
      "doctrine",
      "procurement",
      "treasury",
      "assets",
    ];
    for (const scope of scopes) {
      expect(actingLock({ acting: true, barredScopes: scopes }, scope)).toBeNull();
      expect(actingLock({ acting: true }, scope)).toBeNull();
      expect(actingLock(null, scope)).toBeNull();
    }
  });

  it("shows remaining tenure and full authority", () => {
    render(<ActingOfficeNotice turnsRemaining={12} />);
    expect(screen.getByRole("note").textContent).toContain("12 turns remain");
    expect(screen.getByRole("note").textContent).toContain("full departmental authority");
    expect(screen.getByRole("note").textContent).not.toContain("locked");
  });

  it("still warns when the appointment is due to expire", () => {
    render(<ActingOfficeNotice turnsRemaining={0} />);
    expect(screen.getByRole("note").textContent).toContain("lapses at the next turn");
  });
});
