/**
 * @vitest-environment happy-dom
 */
/**
 * Ticket #1183 — the card offered every global-response option as clickable.
 * Picking one the nation cannot support is a guaranteed refusal, and the player
 * saw only the raw error. The crisis detail page greys those options out and
 * lists why; this card has to do the same.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import CrisisActionCard from "./CrisisActionCard";

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const CURRENT_NODE = {
  nodeId: "response",
  type: "choice",
  title: "Berlin Crisis: the alliance consults",
  description: "The alliance wants a common position.",
  requiredRoles: ["headOfState"],
  timeLimitMinutes: 1440,
  options: [
    {
      optionId: "allied_support",
      label: "Support the alliance line",
      description: "Contribute money, logistics, and diplomatic backing.",
      effects: [],
    },
    {
      optionId: "allied_mediation",
      label: "Demand negotiations",
      description: "Press the alliance toward talks.",
      effects: [],
    },
  ],
};

function stubFeed(optionAvailability: Record<string, unknown> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        crises: [
          {
            crisis: {
              _id: "65b0000000000000000000aa",
              name: "Berlin Crisis",
              description: "Governments are called to respond.",
              scope: "global",
              effects: [],
            },
            interaction: null,
            currentNode: CURRENT_NODE,
            canInteract: true,
            timeRemainingMinutes: 1215,
            hasContributed: false,
            optionAvailability,
          },
        ],
      }),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("CrisisActionCard — options the nation cannot support", () => {
  it("disables an ineligible option and shows why", async () => {
    stubFeed({
      allied_support: { eligible: false, reasons: ["Needs military readiness 42"] },
      allied_mediation: { eligible: true, reasons: [] },
    });

    render(<CrisisActionCard />);

    const support = await screen.findByRole("button", { name: /Support the alliance line/i });
    expect(support.hasAttribute("disabled")).toBe(true);
    expect(await screen.findByText(/Needs military readiness 42/)).toBeTruthy();
  });

  it("leaves an eligible option clickable", async () => {
    stubFeed({
      allied_support: { eligible: false, reasons: ["Needs military readiness 42"] },
      allied_mediation: { eligible: true, reasons: [] },
    });

    render(<CrisisActionCard />);

    const mediation = await screen.findByRole("button", { name: /Demand negotiations/i });
    expect(mediation.hasAttribute("disabled")).toBe(false);
  });

  it("leaves every option clickable when the feed carries no availability", async () => {
    stubFeed(null);

    render(<CrisisActionCard />);

    const support = await screen.findByRole("button", { name: /Support the alliance line/i });
    expect(support.hasAttribute("disabled")).toBe(false);
  });
});
