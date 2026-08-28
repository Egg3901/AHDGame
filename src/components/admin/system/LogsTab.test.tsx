/**
 * @vitest-environment happy-dom
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LogsTab } from "./LogsTab";

// Shapes below mirror what the live production endpoints actually return
// (captured 2026-08-28 by replaying the route transforms over the live
// adminLogs / turnLogs collections), so a render throw here is a render throw
// in the admin panel.
const ACCOUNT_LOGS = [
  {
    id: "68b0c0000000000000000001",
    category: "account" as const,
    action: "account_created",
    username: "klausvascense",
    characterName: null,
    adminUsername: null,
    details: null,
    createdAt: "2026-08-28T14:57:00.000Z",
  },
  {
    id: "68b0c0000000000000000002",
    category: "system" as const,
    // An action with no ACTION_CONFIG entry — must fall back, not crash.
    action: "some_unmapped_action",
    username: "system",
    characterName: "Louise Haigh",
    adminUsername: "lynetters",
    details: "appointed",
    createdAt: "2026-08-28T10:36:00.000Z",
  },
];

const HOURLY_LOGS = [
  {
    id: "68b0c0000000000000000010",
    turn: 457,
    year: 1962,
    gameTime: "2026-08-28T17:00:00.000Z",
    realTime: "2026-08-28T17:00:00.100Z",
    durationMs: 114379,
    success: true,
    warnings: [],
    phaseStatuses: {
      indexFunds: {
        status: "completed",
        startedAt: "2026-08-28T17:00:01.000Z",
        completedAt: "2026-08-28T17:00:28.622Z",
        updatedAt: "2026-08-28T17:00:28.622Z",
        reason: null,
        message: null,
      },
    },
    phases: {
      actionRefresh: { charactersProcessed: 229, totalActionsGranted: 458 },
      // Production stores this phase result as a BOOLEAN even though TurnLog
      // types it as an object. Object.entries(true) is [] rather than a throw,
      // so this must render as an empty card, not blow up the panel.
      financialSuspectScan: true,
      // A null phase result is the documented "did not run" marker.
      caucusTax: null,
    },
    createdAt: "2026-08-28T17:00:00.100Z",
  },
];

function mockFetchOk() {
  return vi.fn(async (url: string) => {
    if (url.includes("/hourly")) {
      return { ok: true, json: async () => ({ logs: HOURLY_LOGS, count: HOURLY_LOGS.length }) };
    }
    return { ok: true, json: async () => ({ logs: ACCOUNT_LOGS, total: ACCOUNT_LOGS.length }) };
  }) as unknown as typeof fetch;
}

describe("LogsTab", () => {
  beforeEach(() => {
    global.fetch = mockFetchOk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the default account sub-tab without throwing", async () => {
    render(<LogsTab />);
    await waitFor(() => expect(screen.getByText("Account Created")).toBeTruthy());
  });

  it("renders the hourly sub-tab and expands a turn without throwing", async () => {
    render(<LogsTab />);
    fireEvent.click(screen.getByText("Hourly Logs"));

    await waitFor(() => expect(screen.getByText("Turn 457")).toBeTruthy());

    // Expanding is where Object.entries(log.phases) runs.
    fireEvent.click(screen.getByText("Turn 457"));
    await waitFor(() => expect(screen.getByText("Phase Results")).toBeTruthy());
  });

  it("surfaces a server error as text instead of crashing the panel", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: "Forbidden" }),
    })) as unknown as typeof fetch;

    render(<LogsTab />);
    await waitFor(() => expect(screen.getByText("Forbidden")).toBeTruthy());
  });
});
