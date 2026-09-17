/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StateOrganizationTab } from "./StateOrganizationTab";
const clock = vi.hoisted(() => ({ currentTurn: 12 }));
vi.mock("@/contexts/useGameClock", () => ({ useGameClock: () => clock }));
vi.mock("@/components/PrimaryElectoralMap", () => ({
  PrimaryElectoralMap: ({ onStateClick }: { onStateClick: (state: string) => void }) => (
    <button onClick={() => onStateClick("IA")}>Select Iowa</button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clock.currentTurn = 12;
});
const data = {
  states: [
    {
      stateId: "IA",
      level: 2,
      totalInvested: 10,
      nextCost: 100_000,
      updatedAt: "2026-01-01T12:00:00Z",
      builtThisTurn: true,
    },
  ],
  racePresence: [
    { characterId: "self", name: "Candidate", isSelf: true, party: "1", levelsByState: { IA: 2 } },
    { characterId: "other", name: "Rival", isSelf: false, party: "2", levelsByState: { IA: 3 } },
  ],
};
it("keeps the build disabled when selecting your own candidate's presence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => data }))
  );
  render(<StateOrganizationTab />);
  fireEvent.click(await screen.findByRole("button", { name: "Candidate (you)" }));
  fireEvent.click(screen.getByRole("button", { name: "Select Iowa" }));
  expect(screen.getByText("Built this turn. Available again next turn.")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Build \(\+1\)/ }).hasAttribute("disabled")).toBe(true);
});
it("refreshes the marker at the next turn boundary", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => data })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...data,
        states: data.states.map((row) => ({ ...row, builtThisTurn: false })),
      }),
    });
  vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<StateOrganizationTab />);
  await screen.findByText("Built this turn: IA");
  clock.currentTurn = 13;
  rerender(<StateOrganizationTab />);
  await vi.waitFor(() => expect(screen.queryByText("Built this turn: IA")).toBeNull());
  expect(fetch).toHaveBeenCalledTimes(2);
});
