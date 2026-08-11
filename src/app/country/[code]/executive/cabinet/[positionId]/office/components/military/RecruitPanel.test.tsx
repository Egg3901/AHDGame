/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { RecruitPanel } from "./RecruitPanel";
import type { Branch } from "@/lib/constants/military";

afterEach(cleanup);

const BRANCH: Branch = { id: "ground", name: "Ground Forces", abbr: "SV", domain: "ground" };

function setup(over: Partial<React.ComponentProps<typeof RecruitPanel>> = {}) {
  return render(
    <RecruitPanel
      branch={BRANCH}
      currencySymbol="$"
      busy={false}
      countryId="DE"
      gdp={387_000_000_000}
      baselineGdp={387_000_000_000}
      hasBudget={true}
      appropriation={100_000_000_000}
      appropriationNetPerTurn={1_000_000_000}
      manpowerPool={1_000_000}
      onRecruit={vi.fn()}
      onCancel={vi.fn()}
      {...over}
    />
  );
}

const authorizeBtn = () => screen.getByRole("button", { name: /authorize/i }) as HTMLButtonElement;

describe("RecruitPanel", () => {
  it("labels the price as a one-time draw on the appropriation", () => {
    setup();
    expect(screen.getByText(/one-time draw on the defence appropriation/i)).toBeTruthy();
  });

  // Procurement has no overdraft — the pot must cover the price outright, matching the
  // $gte guard the server enforces.
  it("blocks and explains when the appropriation cannot cover the price", () => {
    setup({ appropriation: 1_000_000 });
    expect(screen.getByText(/appropriation is short/i)).toBeTruthy();
    expect(authorizeBtn().disabled).toBe(true);
  });

  it("says how many turns until the order becomes affordable", () => {
    setup({ appropriation: 0, appropriationNetPerTurn: 1_000_000_000 });
    expect(screen.getByText(/affordable in \d+ turns?/i)).toBeTruthy();
  });

  // "Affordable in -3 turns" is worse than saying nothing.
  it("does not promise a wait when the account is not growing", () => {
    setup({ appropriation: 0, appropriationNetPerTurn: -5 });
    expect(screen.queryByText(/affordable in/i)).toBeNull();
    expect(screen.getByText(/not growing/i)).toBeTruthy();
  });

  it("says nothing about shortfalls when the appropriation covers the price", () => {
    setup();
    expect(screen.queryByText(/appropriation is short/i)).toBeNull();
    expect(authorizeBtn().disabled).toBe(false);
  });

  it("blocks and explains when the country has no usable GDP", () => {
    setup({ gdp: null });
    expect(screen.getByText(/no usable GDP/i)).toBeTruthy();
    expect(authorizeBtn().disabled).toBe(true);
  });

  it("disables the authorize button when manpower is short", () => {
    setup({ manpowerPool: 10 });
    expect(authorizeBtn().disabled).toBe(true);
    expect(screen.getByText(/insufficient manpower/i)).toBeTruthy();
  });

  it("explains that the era has no national budget, not that GDP is broken", () => {
    setup({ gdp: null, hasBudget: false });
    expect(screen.getByText(/no national budget in this era/i)).toBeTruthy();
    expect(screen.queryByText(/no usable GDP/i)).toBeNull();
    expect(authorizeBtn().disabled).toBe(true);
  });

  it("still reports a broken GDP when the budget exists", () => {
    setup({ gdp: null, hasBudget: true });
    expect(screen.getByText(/no usable GDP/i)).toBeTruthy();
    expect(authorizeBtn().disabled).toBe(true);
  });
});
