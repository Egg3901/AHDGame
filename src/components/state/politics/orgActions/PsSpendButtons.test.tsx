/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PsSpendButtons } from "./PsSpendButtons";

const baseProps = {
  color: "#2563eb",
  busy: false,
  label: "Build Org",
  busyLabel: "Building…",
  singleDisabled: false,
  stateDisabled: false,
  nationalDisabled: false,
};

describe("PsSpendButtons", () => {
  it("renders a single unlabeled button when scopes is null and spends with no explicit pool", () => {
    const onSpend = vi.fn();
    render(<PsSpendButtons {...baseProps} scopes={null} onSpend={onSpend} />);
    fireEvent.click(screen.getByRole("button", { name: "Build Org" }));
    expect(onSpend).toHaveBeenCalledTimes(1);
    expect(onSpend.mock.calls[0]).toEqual([]); // no explicit pool
  });

  it("renders a single unlabeled button when eligible for neither pool", () => {
    const onSpend = vi.fn();
    render(
      <PsSpendButtons {...baseProps} scopes={{ state: false, national: false }} onSpend={onSpend} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Build Org" }));
    expect(onSpend.mock.calls[0]).toEqual([]);
  });

  it("renders both labeled buttons when eligible for both pools", () => {
    const onSpend = vi.fn();
    render(
      <PsSpendButtons
        {...baseProps}
        scopes={{ state: true, national: true }}
        nationalDisabled
        onSpend={onSpend}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /State PS/ }));
    expect(onSpend).toHaveBeenCalledWith("state");
    expect((screen.getByRole("button", { name: /Nat'l PS/ }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it("renders only the Nat'l PS button when eligible for national only", () => {
    const onSpend = vi.fn();
    render(
      <PsSpendButtons {...baseProps} scopes={{ state: false, national: true }} onSpend={onSpend} />
    );
    expect(screen.queryByRole("button", { name: /State PS/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Nat'l PS/ }));
    expect(onSpend).toHaveBeenCalledWith("national");
  });

  it("renders only the State PS button when eligible for state only", () => {
    const onSpend = vi.fn();
    render(
      <PsSpendButtons {...baseProps} scopes={{ state: true, national: false }} onSpend={onSpend} />
    );
    expect(screen.queryByRole("button", { name: /Nat'l PS/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /State PS/ }));
    expect(onSpend).toHaveBeenCalledWith("state");
  });
});
