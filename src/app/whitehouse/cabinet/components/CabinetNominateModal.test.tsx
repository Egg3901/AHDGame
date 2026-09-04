/**
 * @vitest-environment happy-dom
 *
 * Ticket #1273: a seat held by an acting secretary disappeared from the
 * Propose Nomination picker, so the President could not nominate over the
 * caretaker even though confirmation replaces an acting holder at once.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CabinetNominateModal } from "./CabinetNominateModal";

const noop = () => {};

interface TestPosition {
  id: string;
  name: string;
  member: { acting?: boolean } | null;
  nomination: unknown;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    positions: [
      { id: "vacant_seat", name: "Vacant Seat", member: null, nomination: null },
      { id: "vacant_seat", name: "Vacant Seat", member: null, nomination: null },
      {
        id: "acting_seat",
        name: "Acting Seat",
        member: { acting: true },
        nomination: null,
      },
      {
        id: "confirmed_seat",
        name: "Confirmed Seat",
        member: { acting: false },
        nomination: null,
      },
    ] as TestPosition[],
    characters: [],
    selectedPositionId: "",
    selectedCharId: "",
    message: "",
    submitting: false,
    onPositionChange: noop,
    onCharChange: noop,
    onSubmit: noop,
    onCancel: noop,
    ...overrides,
  };
}

function positionOptions() {
  const select = document.getElementById("cabinet-position") as HTMLSelectElement;
  return within(select)
    .getAllByRole("option")
    .map((o) => (o as HTMLOptionElement).text);
}

describe("CabinetNominateModal acting-held seats", () => {
  it("lists vacant seats but hides held seats by default (acting flow)", () => {
    render(<CabinetNominateModal {...baseProps()} />);
    const options = positionOptions();
    expect(options.some((t) => t.includes("Vacant Seat"))).toBe(true);
    expect(options.some((t) => t.includes("Acting Seat"))).toBe(false);
    expect(options.some((t) => t.includes("Confirmed Seat"))).toBe(false);
  });

  it("lists acting-held seats with an acting label when includeActingHeld", () => {
    render(<CabinetNominateModal {...baseProps({ includeActingHeld: true })} />);
    const options = positionOptions();
    expect(options.some((t) => t.includes("Vacant Seat"))).toBe(true);
    expect(options.some((t) => t.includes("Acting Seat") && t.includes("(acting)"))).toBe(true);
    // A confirmed holder still cannot be nominated over.
    expect(options.some((t) => t.includes("Confirmed Seat"))).toBe(false);
  });

  it("keeps the pending-nomination suffix alongside the acting label", () => {
    const props = baseProps({ includeActingHeld: true });
    props.positions = [
      {
        id: "acting_seat",
        name: "Acting Seat",
        member: { acting: true },
        nomination: { id: "nom-1" },
      },
    ];
    render(<CabinetNominateModal {...props} />);
    const options = positionOptions();
    expect(
      options.some(
        (t) =>
          t.includes("Acting Seat") && t.includes("(acting)") && t.includes("(replace pending)")
      )
    ).toBe(true);
  });

  it("does not claim all positions are filled while an acting seat is nominatable", () => {
    const props = baseProps({ includeActingHeld: true });
    props.positions = [
      {
        id: "acting_seat",
        name: "Acting Seat",
        member: { acting: true },
        nomination: null,
      },
    ];
    render(<CabinetNominateModal {...props} />);
    expect(screen.queryByText(/all positions filled/i)).toBeNull();
  });

  it("still reports all filled when every seat has a confirmed holder", () => {
    const props = baseProps({ includeActingHeld: true });
    props.positions = [
      {
        id: "confirmed_seat",
        name: "Confirmed Seat",
        member: { acting: false },
        nomination: null,
      },
    ];
    render(<CabinetNominateModal {...props} />);
    expect(screen.getByText(/all positions filled/i)).toBeTruthy();
  });
});
