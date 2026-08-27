/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrisisInteractionPanel from "./CrisisInteractionPanel";

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubInteraction() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        canInteract: true,
        multiResponder: true,
        alreadyResponded: false,
        interaction: {
          _id: "interaction-1",
          crisisId: "crisis-1",
          decisionTree: [
            {
              nodeId: "response",
              type: "choice",
              title: "Nuclear Alert Crisis: governments are called to respond",
              description: "Ambiguous reports force decisions before facts are known.",
              requiredRoles: ["headOfState"],
              options: [
                {
                  optionId: "mobilize",
                  label: "Mobilize and stand firm",
                  description: "Put forces and public credibility behind your position.",
                  effects: [
                    {
                      effectType: "tick",
                      targetType: "approval",
                      targetId: "government",
                      value: -0.44999999999999996,
                      label: "Crisis mobilization",
                    },
                  ],
                },
              ],
            },
          ],
          currentNodeId: "response",
          collectiveTarget: null,
          collectiveCurrent: 0,
          contributors: [],
          decisionDeadline: null,
          resolvedAt: null,
          resolutionPath: [],
          resolutionOutcome: null,
        },
        campaignBrief: {
          stage: "mobilization",
          stageLabel: "Mobilization",
          stageTurns: 23,
          cycle: 2,
          capability: {
            treasuryPctGdp: -0.774,
            militaryReadiness: 67,
            logistics: 100,
            domesticSupport: 48,
            intelligence: 49,
          },
          intelligence: {
            riskBand: "contained",
            confidence: "medium",
            estimatedRiskMin: 4,
            estimatedRiskMax: 20,
            summary: "Contained risk",
          },
          countryMemory: {
            credibility: 50,
            warWeariness: 0,
            militaryCommitment: 0,
            humanitarianCommitment: 0,
            covertExposure: 0,
          },
          consequenceBands: {},
          optionAvailability: { mobilize: { eligible: true, reasons: [] } },
        },
      }),
    }))
  );
}

describe("CrisisInteractionPanel national capacity", () => {
  it("labels debt honestly and explains where the non-fiscal capacities come from", async () => {
    stubInteraction();
    render(<CrisisInteractionPanel crisisId="crisis-1" />);

    expect(await screen.findByText("Treasury debt 77.40% GDP")).toBeTruthy();
    expect(screen.queryByText("Treasury -77.40% GDP")).toBeNull();
    expect(
      screen.getByText(/Logistics reflects support equipment across your formations/i)
    ).toBeTruthy();
  });

  it("does not leak floating-point residue into effect chips", async () => {
    stubInteraction();
    render(<CrisisInteractionPanel crisisId="crisis-1" />);

    expect(await screen.findByText("-0.45")).toBeTruthy();
    expect(screen.queryByText("-0.44999999999999996")).toBeNull();
  });
});
