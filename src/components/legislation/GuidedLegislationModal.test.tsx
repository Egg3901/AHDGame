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
  year: 1991,
  balanceNotice: "Game-calibrated provisional estimates for the 1991 reset.",
  taxes: [],
  metrics: [
    {
      id: "11",
      name: "Secondary completion",
      description: "Completion of secondary education by cohort age.",
    },
    {
      id: "16",
      name: "Effective health coverage",
      description: "Enrollment, service reach, and practical access to care.",
    },
  ],
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
      overseeingAgencyId: "us_health_department",
      overseeingAgencyName: "U.S. Department of Health and Human Services",
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
      overseeingAgencyId: "us_education_department",
      overseeingAgencyName: "U.S. Department of Education",
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

const metricBoard = {
  metrics: [
    { id: "11", observation: { value: 82 } },
    { id: "16", observation: { value: 86 } },
  ],
};

function stubCatalog(response: unknown = catalog) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return {
        ok: true,
        json: async () =>
          url.includes("reset-legislation")
            ? response
            : url.includes("reset-metrics")
              ? metricBoard
              : [],
      };
    })
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
  fireEvent.change(await screen.findByLabelText("Policy domain"), {
    target: { value: domain },
  });
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
  it("populates metric names when the server response omits its metric definitions", async () => {
    const { metrics: _metrics, ...olderCatalogResponse } = catalog;
    stubCatalog(olderCatalogResponse);
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "By metric" }));

    expect(screen.getByRole("option", { name: "Secondary completion" })).toBeTruthy();
    const coverageOption = screen.getByRole("option", { name: "Effective health coverage" });
    expect(coverageOption).toBeTruthy();
    expect(coverageOption.getAttribute("title")).toContain("enrolled in health coverage");

    fireEvent.change(screen.getByLabelText("Metric to affect"), { target: { value: "16" } });
    fireEvent.click(screen.getByText("Primary care access").closest("button")!);
    expect(screen.getByText("At equilibrium")).toBeTruthy();
    expect(screen.getByText("▲").className).toContain("text-sm");
    expect(screen.queryByText(/Effective health coverage: \+0\.24$/)).toBeNull();
    expect(screen.getByText("Allocation +125/yr")).toBeTruthy();
    expect(screen.getByText("Budget change +25/yr")).toBeTruthy();
    expect(screen.queryByText(/Metric 16/)).toBeNull();
    expect(screen.queryByText("v2")).toBeNull();
    expect(screen.getByText(/Overseeing agency:/).textContent).toContain(
      "U.S. Department of Health and Human Services"
    );
    expect(screen.queryByText(/us_health_department/)).toBeNull();
  });

  it("uses player-facing metric names for the metric path and review", async () => {
    stubCatalog();
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "By metric" }));
    const metricSelect = screen.getByLabelText("Metric to affect");
    expect(screen.getByRole("option", { name: "Effective health coverage" })).toBeTruthy();
    fireEvent.change(metricSelect, { target: { value: "16" } });
    expect(screen.queryByText(/L19/)).toBeNull();
    fireEvent.click(screen.getByText("Primary care access").closest("button")!);
    expect(screen.getByRole("heading", { name: "Primary care access" })).toBeTruthy();
    expect(screen.queryByText(/L19/)).toBeNull();
    fireEvent.click(screen.getByText("Community clinic expansion").closest("button")!);

    expect(screen.getByText("▲").className).toContain("text-sm");
    expect(
      screen.getByText("Expected metric direction from current law at full implementation")
    ).toBeTruthy();
  });

  it("locks current law and returns to the overview while composing a multi-provision bill", async () => {
    stubCatalog();
    mocks.postBill.mockResolvedValue({
      response: { ok: true },
      data: {},
      cancelled: false,
    });
    const { onSuccess } = renderModal();

    fireEvent.change(await screen.findByLabelText("Policy domain"), {
      target: { value: "Health and care" },
    });
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
