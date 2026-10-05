/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { FeatureGatesPanel } from "./FeatureGatesPanel";

afterEach(() => vi.restoreAllMocks());

describe("reset system controls", () => {
  it("distinguishes the running version from the next-reset selection", async () => {
    const state = {
      booleans: {},
      nppAutonomyLevel: "off",
      nppForeignPolicyMode: "off",
      nppForeignPolicyStage: "votes",
      nppEntryViabilityMode: "off",
      resetSystemVersions: { metrics: "v1", legislation: "v1", cabinet: "v1" },
      resetSystemSelections: { metrics: "v2", legislation: "v1", cabinet: "v1" },
      resetV2Ready: { metrics: true, legislation: false, cabinet: false },
      resetV2Seeded: { metrics: false, legislation: false, cabinet: false },
    };
    global.fetch = vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url === "/api/admin/feature-gates" ? state : {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    ) as typeof fetch;
    render(<FeatureGatesPanel />);
    const section = await screen.findByLabelText("Reset-era system versions");
    await waitFor(() =>
      expect(
        within(section).getByText(
          "Next 1991 reset: v2. Changing this selection does not switch the running world."
        )
      ).toBeTruthy()
    );
    expect(within(section).getAllByText("v1 live")).toHaveLength(3);
    const metrics = within(section).getByText("Metrics").closest("div.rounded-lg");
    expect(metrics).toBeTruthy();
    expect(metrics!.querySelector("button.bg-primary")?.textContent).toBe("v2");
  });
});
