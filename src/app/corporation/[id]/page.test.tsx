/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("@/components/corporation/CorporationMasthead", () => ({
  CorporationMasthead: ({
    corporation,
    onRefresh,
  }: {
    corporation: { name: string };
    onRefresh: () => void;
  }) => (
    <div>
      <span>{corporation.name}</span>
      <button type="button" onClick={onRefresh}>
        Refresh corporation
      </button>
    </div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("corporation load errors", () => {
  it("shows the server request reference for a validation failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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

  it.each([
    new TypeError("Failed to fetch"),
    new TypeError("Load failed"),
    new DOMException("signal timed out", "TimeoutError"),
  ])("shows a retryable network error for %s without reporting it", async (error) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    render(<CorporationDetailPage />);
    expect(
      await screen.findByText(
        "Could not reach the server. Check your connection and try again. (NETWORK_ERROR)"
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTitle(/Click to copy/)).toBeNull();
    expect(captureClientExceptionWithId).not.toHaveBeenCalled();
  });

  it("reports an unexpected application error with its event reference", async () => {
    const error = new RangeError("Invalid array length");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    render(<CorporationDetailPage />);
    await waitFor(() =>
      expect(captureClientExceptionWithId).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          tags: expect.objectContaining({ feature: "corporation-detail" }),
        })
      )
    );
    expect(await screen.findByTitle("Click to copy: sentry-event-1234567890")).toBeTruthy();
  });

  it("shows the gateway message for a 502 from the edge without reporting it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }))
    );
    render(<CorporationDetailPage />);
    expect(
      await screen.findByText(
        "The service is temporarily unavailable. Try again shortly. (SERVICE_UNAVAILABLE)"
      )
    ).toBeTruthy();
    expect(captureClientExceptionWithId).not.toHaveBeenCalled();
  });

  it.each(["", "<html>bad gateway</html>"])(
    "shows a retryable generic error when a successful response contains %s",
    async (body) => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/corporations/bad-id") {
          return new Response(body, {
            status: 200,
            headers: { "content-type": "text/html", "x-request-id": "proxy-req-123456" },
          });
        }
        return new Response("{}", { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<CorporationDetailPage />);

      expect(
        await screen.findByRole("heading", {
          name: "This page hit an unexpected problem and could not finish loading. (CLIENT_ERROR)",
        })
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.queryByText(/Unexpected end|Unexpected token|JSON/i)).toBeNull();
      expect(await screen.findByTitle("Click to copy: sentry-event-1234567890")).toBeTruthy();
      expect(captureClientExceptionWithId).toHaveBeenCalledWith(
        expect.objectContaining({ name: "CorporationResponseError" }),
        expect.objectContaining({
          extra: expect.objectContaining({
            url: "/api/corporations/bad-id",
            status: 200,
            contentType: "text/html",
          }),
        })
      );
    }
  );

  it("keeps the last valid corporation visible when a refresh returns malformed JSON", async () => {
    let detailRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/corporations/bad-id") {
        detailRequests += 1;
        if (detailRequests > 1) return new Response("", { status: 200 });
        return new Response(
          JSON.stringify({
            corporation: {
              _id: "corp-1",
              name: "Alder Works",
              isPrivate: true,
              type: "manufacturing",
            },
            ceo: null,
            financials: null,
            sectors: [],
            balanceSheet: null,
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CorporationDetailPage />);
    expect((await screen.findAllByText("Alder Works")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh corporation" }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.getAllByText("Alder Works").length).toBeGreaterThan(0);
    expect(toast).toHaveBeenCalledWith(
      "This page hit an unexpected problem and could not finish loading. (CLIENT_ERROR)",
      "error"
    );
  });

  it("normalizes an aborted corporation request as a network failure", async () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    render(<CorporationDetailPage />);
    expect(
      await screen.findByText(
        "Could not reach the server. Check your connection and try again. (NETWORK_ERROR)"
      )
    ).toBeTruthy();
  });

  it("preserves an abort that happens while reading a successful response body", async () => {
    const abort = new DOMException("The operation was aborted", "AbortError");
    const response = new Response("", { status: 200 });
    Object.defineProperty(response, "json", { value: vi.fn().mockRejectedValue(abort) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === "/api/corporations/bad-id"
          ? response
          : new Response("{}", { status: 200 })
      )
    );
    render(<CorporationDetailPage />);
    expect(
      await screen.findByText(
        "Could not reach the server. Check your connection and try again. (NETWORK_ERROR)"
      )
    ).toBeTruthy();
  });

  it.each([new TypeError("Load failed"), new TypeError("Failed to fetch")])(
    "preserves a network failure (%s) that happens while reading a successful response body",
    async (networkError) => {
      const response = new Response("", { status: 200 });
      Object.defineProperty(response, "json", {
        value: vi.fn().mockRejectedValue(networkError),
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          String(input) === "/api/corporations/bad-id"
            ? response
            : new Response("{}", { status: 200 })
        )
      );
      render(<CorporationDetailPage />);
      expect(
        await screen.findByText(
          "Could not reach the server. Check your connection and try again. (NETWORK_ERROR)"
        )
      ).toBeTruthy();
      expect(captureClientExceptionWithId).not.toHaveBeenCalled();
    }
  );

  it("keeps the last valid corporation visible when a refresh drops the network while reading the body", async () => {
    let detailRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/corporations/bad-id") {
        detailRequests += 1;
        if (detailRequests > 1) {
          const response = new Response("", { status: 200 });
          Object.defineProperty(response, "json", {
            value: vi.fn().mockRejectedValue(new TypeError("Load failed")),
          });
          return response;
        }
        return new Response(
          JSON.stringify({
            corporation: {
              _id: "corp-1",
              name: "Alder Works",
              isPrivate: true,
              type: "manufacturing",
            },
            ceo: null,
            financials: null,
            sectors: [],
            balanceSheet: null,
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CorporationDetailPage />);
    expect((await screen.findAllByText("Alder Works")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh corporation" }));

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(screen.getAllByText("Alder Works").length).toBeGreaterThan(0);
    expect(toast).toHaveBeenCalledWith(
      "Could not reach the server. Check your connection and try again. (NETWORK_ERROR)",
      "error"
    );
    expect(toast).not.toHaveBeenCalledWith(expect.stringContaining("(CLIENT_ERROR)"), "error");
  });
});
