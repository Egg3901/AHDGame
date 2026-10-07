/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegislationSystemGate } from "./LegislationSystemGate";

afterEach(cleanup);

describe("LegislationSystemGate", () => {
  it("blocks proposal entry while the version is loading", () => {
    render(<LegislationSystemGate failed={false} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Loading legislation system" })).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("reports a failed version check and remains closable", () => {
    const onClose = vi.fn();
    render(<LegislationSystemGate failed onClose={onClose} />);

    expect(screen.getByRole("heading", { name: "Legislation system unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
