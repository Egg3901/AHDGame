/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { OfficePoolTopUpButton } from "./OfficePoolTopUpButton";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ready = { cost: 10, playerActions: 25, usedThisTurn: false };

function renderButton(props: Partial<Parameters<typeof OfficePoolTopUpButton>[0]> = {}) {
  const onUpdate = vi.fn();
  render(
    <OfficePoolTopUpButton
      countryCode="us"
      body={{ pool: "vp" }}
      remaining={0}
      cap={2}
      topUp={ready}
      onUpdate={onUpdate}
      {...props}
    />
  );
  return { onUpdate };
}

describe("OfficePoolTopUpButton", () => {
  it("is hidden at cap and for non-holders", () => {
    renderButton({ remaining: 2 });
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    renderButton({ topUp: null });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("disables with a reason after this turn's purchase or when short on AP", () => {
    renderButton({ topUp: { ...ready, usedThisTurn: true } });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Already bought one this turn.")).toBeTruthy();
    cleanup();
    renderButton({ topUp: { ...ready, playerActions: 4 } });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Needs 10 AP (you have 4).")).toBeTruthy();
  });

  it("posts the pool body and refreshes on success", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal("fetch", fetchMock);
    const { onUpdate } = renderButton({ body: { pool: "justice", seatNumber: 3 } });
    fireEvent.click(screen.getByRole("button", { name: "Buy 1 action (10 AP)" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/country/us/office-pool/top-up",
      expect.objectContaining({ body: JSON.stringify({ pool: "justice", seatNumber: 3 }) })
    );
  });
});
