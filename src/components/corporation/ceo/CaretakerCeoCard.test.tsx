/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("lets the owner select a passive caretaker mandate", async () => {
    renderCard({ ceoCharacterId: null, caretakerMandate: "active" });
    const select = await screen.findByLabelText("Caretaker mandate");

    fireEvent.change(select, { target: { value: "passive" } });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/corporations/446/ceo/caretaker",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ mandate: "passive" }) })
      )
    );
    expect(screen.getByText(/existing debt and operating costs still settle/i)).toBeTruthy();
  });
});
