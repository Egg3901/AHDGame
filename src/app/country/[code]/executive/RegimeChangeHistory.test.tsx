// @vitest-environment happy-dom
import { render as rtlRender, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import profile from "@/../messages/en/profile.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={profile}>
      {ui}
    </NextIntlClientProvider>
  );
}

import { RegimeChangeHistory } from "./RegimeChangeHistory";

afterEach(cleanup);
describe("RegimeChangeHistory", () => {
  it("shows exact causes and deltas newest first, preserving multiple events per turn", () => {
    render(
      <RegimeChangeHistory
        entries={[
          { turn: 7, previous: 50, next: 48, delta: -2, reason: "Economic contraction" },
          { turn: 8, previous: 48, next: 49, delta: 1, reason: "Reform" },
          { turn: 8, previous: 49, next: 50, delta: 1, reason: "Public address" },
        ]}
      />
    );
    const rows = screen.getAllByRole("listitem", { hidden: true });
    expect(rows[0].textContent).toContain("Public address");
    expect(rows[1].textContent).toContain("Reform");
    expect(rows[2].textContent).toContain("-2.00");
    expect(rows[2].textContent).toContain("50.00 → 48.00");
  });
  it("does not invent history for legacy records", () => {
    render(<RegimeChangeHistory entries={[]} />);
    expect(screen.queryByRole("listitem", { hidden: true })).toBeNull();
  });
});
