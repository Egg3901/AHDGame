/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/contexts/ToastContext";
import { ExecutiveTabsClient } from "./ExecutiveTabsClient";

let tabParam = "";
vi.mock("next/navigation", () => ({
  // The shell seeds its initial tab from `?tab=`. No params here, so every test
  // below opens on the overview exactly as it did before.
  useSearchParams: () => new URLSearchParams(tabParam),
}));

const conflictsSpy = vi.fn().mockReturnValue(true);
vi.mock("@/contexts/AuthDataContext", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConflictsEnabled: () => conflictsSpy(),
}));
// The shell's gating is what is under test here, not the panels inside the tab.
vi.mock("./components/ForeignAffairsTab", () => ({
  ForeignAffairsTab: ({ canAct }: { canAct: boolean }) => (
    <div data-testid="foreign-affairs-tab">canAct:{String(canAct)}</div>
  ),
}));

function renderTabs(props: {
  viewerIsAdmin?: boolean;
  isOnePartyState?: boolean;
  viewerIsLeader?: boolean;
}) {
  return render(
    <ToastProvider>
      <ExecutiveTabsClient
        countryId="UK"
        overview={<div data-testid="ov">overview</div>}
        viewerIsLeader={props.viewerIsLeader ?? false}
        viewerIsAdmin={props.viewerIsAdmin ?? false}
        isOnePartyState={props.isOnePartyState}
      />
    </ToastProvider>
  );
}

describe("ExecutiveTabsClient admin tab", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hides the Admin tab from non-admins", () => {
    renderTabs({ viewerIsAdmin: false, isOnePartyState: false });
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });

  it("shows the Admin tab with the appoint control for a non-one-party-state admin", async () => {
    renderTabs({ viewerIsAdmin: true, isOnePartyState: false });
    screen.getByRole("button", { name: "Admin" }).click();
    await waitFor(() => expect(screen.getByTestId("executive-admin-appoint")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Appoint PM (Admin)" })).toBeTruthy();
    expect(screen.queryByTestId("executive-admin-regime")).toBeNull();
  });

  it("orders the appoint section before the regime panel for a one-party-state admin", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;
    renderTabs({ viewerIsAdmin: true, isOnePartyState: true });
    screen.getByRole("button", { name: "Admin" }).click();
    await waitFor(() => expect(screen.getByTestId("executive-admin-regime")).toBeTruthy());
    const appoint = screen.getByTestId("executive-admin-appoint");
    const regime = screen.getByTestId("executive-admin-regime");
    expect(appoint.compareDocumentPosition(regime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ExecutiveTabsClient foreign affairs tab", () => {
  beforeEach(() => conflictsSpy.mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it("shows for the sitting head of government", () => {
    renderTabs({ viewerIsLeader: true });
    expect(screen.getByRole("button", { name: "Foreign Affairs" })).toBeTruthy();
  });

  it("shows for an admin", () => {
    renderTabs({ viewerIsAdmin: true });
    expect(screen.getByRole("button", { name: "Foreign Affairs" })).toBeTruthy();
  });

  it("is hidden from an ordinary viewer", () => {
    renderTabs({});
    expect(screen.queryByRole("button", { name: "Foreign Affairs" })).toBeNull();
  });

  it("is hidden when the conflicts subsystem is off, even for the leader", () => {
    // Matches every other conflict surface; the routes 404 in this state anyway.
    conflictsSpy.mockReturnValue(false);
    renderTabs({ viewerIsLeader: true });
    expect(screen.queryByRole("button", { name: "Foreign Affairs" })).toBeNull();
  });

  it("mounts the tab body with canAct true when opened by the leader", async () => {
    renderTabs({ viewerIsLeader: true });
    screen.getByRole("button", { name: "Foreign Affairs" }).click();
    await waitFor(() =>
      expect(screen.getByTestId("foreign-affairs-tab").textContent).toBe("canAct:true")
    );
  });

  it("does not render the tab body while another tab is active", () => {
    renderTabs({ viewerIsLeader: true });
    expect(screen.queryByTestId("foreign-affairs-tab")).toBeNull();
  });
});

describe("ExecutiveTabsClient deep link", () => {
  beforeEach(() => conflictsSpy.mockReturnValue(true));
  afterEach(() => {
    tabParam = "";
  });

  it("opens the Foreign Affairs tab when the URL asks for it", () => {
    // What the peace strip's link depends on: without this it landed on Overview
    // and the panel it promised was nowhere on screen. The overview body is only
    // mounted while its own tab is active, so its absence is the switch.
    tabParam = "tab=foreign";
    renderTabs({ viewerIsLeader: true });
    expect(screen.queryByTestId("ov")).toBeNull();
  });

  it("opens the overview when the URL asks for nothing", () => {
    renderTabs({ viewerIsLeader: true });
    expect(screen.getByTestId("ov")).toBeTruthy();
  });

  it("falls back to the overview on an unknown tab", () => {
    // `?tab=` is untrusted input; anything unrecognised must not blank the page.
    tabParam = "tab=nonsense";
    renderTabs({ viewerIsLeader: true });
    expect(screen.getByTestId("ov")).toBeTruthy();
  });

  it("ignores a private tab requested by someone who may not see it", () => {
    // The tab nav is gated on the viewer, and a URL must not route around that.
    tabParam = "tab=admin";
    renderTabs({ viewerIsLeader: false, viewerIsAdmin: false });
    expect(screen.queryByRole("button", { name: "Admin" })).toBeNull();
  });
});

describe("ExecutiveTabsClient deep link cannot route around the nav", () => {
  afterEach(() => {
    tabParam = "";
  });

  it("does not open a private tab for a viewer with no button for it", () => {
    // The `address` and `orders` BODIES carry no guard of their own, because until
    // the URL could seed the tab, `active` was only reachable by clicking. So the
    // seed has to enforce what the nav enforces.
    tabParam = "tab=address";
    renderTabs({ viewerIsLeader: false, viewerIsAdmin: false });
    expect(screen.getByTestId("ov")).toBeTruthy();
  });

  it("does not open the admin tab for a non-admin leader", () => {
    tabParam = "tab=admin";
    renderTabs({ viewerIsLeader: true, viewerIsAdmin: false });
    expect(screen.queryByTestId("executive-admin-tab")).toBeNull();
    expect(screen.getByTestId("ov")).toBeTruthy();
  });

  it("still opens a private tab for a viewer who may see it", () => {
    tabParam = "tab=address";
    renderTabs({ viewerIsLeader: true });
    expect(screen.queryByTestId("ov")).toBeNull();
  });
});
