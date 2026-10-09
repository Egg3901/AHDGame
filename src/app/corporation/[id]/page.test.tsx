/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CorporationDetailPage from "./page";
import { captureClientExceptionWithId } from "@/lib/observability/sentryClientLazy";

const toast = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: toast }) }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "bad-id" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/corporation/bad-id",
}));
vi.mock("@/hooks/useGameEvents", () => ({ useGameEvents: vi.fn() }));
vi.mock("@/hooks/useFeatureSeen", () => ({
  useFeatureSeen: () => ({ isNew: false, markSeen: vi.fn() }),
}));
vi.mock("@/lib/observability/sentryClientLazy", () => ({
  captureClientExceptionWithId: vi.fn().mockResolvedValue("sentry-event-1234567890"),
}));
vi.mock("@/components/corporation/CorporationPageTabs", () => ({
  TabFallback: () => null,
  SectorsTab: () => null,
  SharesTab: () => null,
  CreditRatingTab: () => null,
  BondsTab: () => null,
  ChartsTab: () => null,
  SnapshotTab: () => null,
  CeoOfficeTab: () => null,
  OverviewTab: () => null,
  TechTab: () => null,
  CommoditiesTab: () => null,
  DealsTab: () => null,
  CorporationContractsTab: () => null,
  DefenceContractsTab: () => null,
  SupplyAgreementsSection: () => null,
  DefaultedBondCrisisModal: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("corporation load errors", () => {
  it("shows the server request reference for a validation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              error: "Invalid corporation ID",
              code: "BAD_REQUEST",
              ref: "request-1234567890",
            }),
            { status: 400 }
          )
        )
    );
    render(<CorporationDetailPage />);
    expect(await screen.findByText("Invalid corporation ID (BAD_REQUEST)")).toBeTruthy();
    expect(screen.getByTitle("Click to copy: request-1234567890")).toBeTruthy();
    expect(captureClientExceptionWithId).not.toHaveBeenCalled();
  });

  it("captures network failures and displays the returned event reference", async () => {
    const error = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    render(<CorporationDetailPage />);
    await waitFor(() =>
      expect(captureClientExceptionWithId).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: { feature: "corporation-detail", error_code: "NETWORK_ERROR" },
        })
      )
    );
    expect(await screen.findByTitle("Click to copy: sentry-event-1234567890")).toBeTruthy();
  });
});
