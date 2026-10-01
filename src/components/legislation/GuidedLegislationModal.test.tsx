/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuidedLegislationModal } from "./GuidedLegislationModal";

const mocks = vi.hoisted(() => ({
  postBill: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock("@/components/bills/BillAutoFailWarning", () => ({
  postBillProposalWithElectionConfirmation: mocks.postBill,
}));

const catalog = {
  balanceNotice: "Game-calibrated provisional estimates for the 1991 reset.",
  taxes: [],
  families: [
    {
      familyId: "L19",
      title: "Primary care access",
      domain: "Health and care",
      primaryMetricIds: ["16"],
      currentLaw: "Baseline coverage",
      currentLawDescription: "The existing national coverage framework.",
      currentChoice: "center",
      overseeingSeatId: "secretary_of_health",
      overseeingAgencyId: "Health and Human Services",
      options: [
        {
          option: { choice: "center", annualAllocation: 100 },
          title: "Baseline coverage",
          description: "Maintain the existing national coverage framework.",
          currentChoice: "center",
          currentAnnualAllocation: 100,
          annualAllocationDelta: 0,
          primaryMetricEffects: [{ metricId: "16", favorableNormalizedPoints: 0 }],
          balanceBasis: "game-calibrated-provisional",
        },
        {
          option: { choice: "center_left", annualAllocation: 125 },
          title: "Community clinic expansion",
          description: "Expand access through targeted public clinics.",
          currentChoice: "center",
          currentAnnualAllocation: 100,
          annualAllocationDelta: 25,
          primaryMetricEffects: [{ metricId: "16", favorableNormalizedPoints: 0.24 }],
          balanceBasis: "game-calibrated-provisional",
        },
      ],
    },
    {
      familyId: "L10",
      title: "School access",
      domain: "Education and skills",
      primaryMetricIds: ["11"],
      currentLaw: "Local provision",
      currentLawDescription: "The existing school access framework.",
      currentChoice: "center_right",
      overseeingSeatId: "secretary_of_education",
      overseeingAgencyId: "Department of Education",
      options: [
        {
          option: { choice: "center_right", annualAllocation: 70 },
          title: "Local provision",
          description: "Maintain the existing local provision model.",
          currentChoice: "center_right",
          currentAnnualAllocation: 70,
          annualAllocationDelta: 0,
          primaryMetricEffects: [{ metricId: "11", favorableNormalizedPoints: 0 }],
          balanceBasis: "game-calibrated-provisional",
        },
        {
          option: { choice: "center", annualAllocation: 82 },
          title: "Portable school support",
          description: "Fund access while preserving local delivery choices.",
          currentChoice: "center_right",
          currentAnnualAllocation: 70,
          annualAllocationDelta: 12,
          primaryMetricEffects: [{ metricId: "11", favorableNormalizedPoints: 0.16 }],
          balanceBasis: "game-calibrated-provisional",
        },
      ],
    },
  ],
} as const;

function stubCatalog() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(input).includes("reset-legislation") ? catalog : []),
    }))
  );
}

function renderModal(onSuccess = vi.fn()) {
  render(
    <GuidedLegislationModal
      countryId="US"
      endpoint="/api/congress/bills"
      chambers={[
        { value: "house", label: "House" },
        { value: "senate", label: "Senate" },
      ]}
      initialChamber="house"
      onClose={vi.fn()}
      onSuccess={onSuccess}
    />
  );
  return { onSuccess };
}

async function addProvision(domain: string, family: string, option: string) {
  fireEvent.click(await screen.findByRole("button", { name: domain }));
  fireEvent.click(screen.getByText(family).closest("button")!);
  fireEvent.click(screen.getByText(option).closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Add to draft bill" }));
  expect(screen.getByRole("heading", { name: "Bill overview" })).toBeTruthy();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GuidedLegislationModal", () => {
  it("locks current law and returns to the overview while composing a multi-provision bill", async () => {
    stubCatalog();
    mocks.postBill.mockResolvedValue({
      response: { ok: true },
      data: {},
      cancelled: false,
    });
    const { onSuccess } = renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "Health and care" }));
    fireEvent.click(screen.getByText("Primary care access").closest("button")!);
    expect(screen.getByText("Baseline coverage").closest("button")?.hasAttribute("disabled")).toBe(
      true
    );
    fireEvent.click(screen.getByText("Community clinic expansion").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "Add to draft bill" }));

    expect(screen.getByRole("heading", { name: "Bill overview" })).toBeTruthy();
    expect(screen.getByText(/Health and Human Services/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add another provision" }));
    expect(screen.getByRole("heading", { name: "How do you want to find a law?" })).toBeTruthy();

    await addProvision("Education and skills", "School access", "Portable school support");
    fireEvent.change(screen.getByLabelText("Bill title"), {
      target: { value: "Community Opportunity Act" },
    });
    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Expands targeted access to health care and education." },
    });
    fireEvent.change(screen.getByLabelText("Originating chamber"), {
      target: { value: "senate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose bill" }));

    await waitFor(() => expect(mocks.postBill).toHaveBeenCalledOnce());
    expect(mocks.postBill).toHaveBeenCalledWith({
      url: "/api/congress/bills",
      body: {
        title: "Community Opportunity Act",
        summary: "Expands targeted access to health care and education.",
        chamber: "senate",
        category: "custom",
        provisions: [
          {
            type: "reset_law",
            familyId: "L19",
            scope: "national",
            choice: "center_left",
          },
          {
            type: "reset_law",
            familyId: "L10",
            scope: "national",
            choice: "center",
          },
        ],
      },
    });
    expect(mocks.showToast).toHaveBeenCalledWith("Bill proposed.", "success");
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
