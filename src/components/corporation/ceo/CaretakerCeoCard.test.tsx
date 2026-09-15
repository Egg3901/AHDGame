/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CaretakerCeoCard } from "./CaretakerCeoCard";

const onRefresh = vi.fn();

function renderCard(overrides: Record<string, unknown> = {}) {
  render(
    <CaretakerCeoCard
      corporation={
        {
          countryId: "US",
          ceoVacant: false,
          ceoCharacterId: "human-ceo",
          ...overrides,
        } as never
      }
      corpId="446"
      onRefresh={onRefresh}
    />
  );
}

describe("CaretakerCeoCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ json: () => Promise.resolve({ enabled: true }) })
    );
  });

  it("explains the cooldown before a player hands the corporation back", async () => {
    renderCard();

    expect(await screen.findByText(/resume control immediately/i)).toBeTruthy();
    expect(screen.getByText(/cooldown of three real days/i)).toBeTruthy();
    expect(screen.queryByText(/reclaim it anytime/i)).toBeNull();
  });

  it("keeps immediate reclaim clear while the caretaker is seated", async () => {
    renderCard({ ceoCharacterId: null });

    expect(await screen.findByText(/resume control immediately/i)).toBeTruthy();
    expect(screen.getByText(/owner-initiated handoff/i)).toBeTruthy();
  });
});
