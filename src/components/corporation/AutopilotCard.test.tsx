/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutopilotCard } from "./AutopilotCard";

const onRefresh = vi.fn();
const onTabChange = vi.fn();

function renderCard(overrides: Record<string, unknown> = {}) {
  render(
    <AutopilotCard
      corporation={
        {
          ceoVacant: false,
          ceoCharacterId: "human-ceo",
          currentTurn: 120,
          autopilot: null,
          ...overrides,
        } as never
      }
      corpId="446"
      onTabChange={onTabChange}
      onRefresh={onRefresh}
    />
  );
}

describe("AutopilotCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) })
    );
  });

  it("switches autopilot on for the CEO", async () => {
    renderCard();
    expect(screen.getByText(/never borrows/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("/api/corporations/446/autopilot", { method: "POST" });
  });

  it("lists what autopilot leaves to the owner, with a way to act on each", () => {
    renderCard({
      autopilot: {
        enabledTurn: 100,
        advisories: [
          { kind: "debt", sinceTurn: 110 },
          { kind: "tech", sinceTurn: 120, subject: "Assembly Robotics" },
        ],
      },
    });
    expect(screen.getByText("Debt is eating the profit")).toBeTruthy();
    expect(screen.getByText("For 10 hours")).toBeTruthy();
    expect(screen.getByText(/You can afford Assembly Robotics/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open bonds" }));
    expect(onTabChange).toHaveBeenCalledWith("credit");
  });

  it("says when nothing needs the owner", () => {
    renderCard({ autopilot: { enabledTurn: 100, advisories: [] } });
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Turn off" })).toBeTruthy();
  });

  it("is hidden while a caretaker runs the corporation", () => {
    const { container } = render(
      <AutopilotCard
        corporation={{ ceoVacant: false, ceoCharacterId: null, currentTurn: 1 } as never}
        corpId="446"
        onTabChange={onTabChange}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});
