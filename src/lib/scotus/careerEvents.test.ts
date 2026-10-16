import { describe, expect, it } from "vitest";
import {
  buildScotusConfirmationCareerEvent,
  hasScotusConfirmationEvent,
  scotusSeatCareerLabel,
} from "./careerEvents";

describe("scotus career events", () => {
  const date = new Date("2026-10-01T00:00:00Z");

  it("builds an office-less appointed event for the seat", () => {
    const event = buildScotusConfirmationCareerEvent({
      seatNumber: 4,
      party: "7",
      partyCountryId: "US",
      date,
    });
    expect(event).toEqual({
      type: "appointed",
      officeLabel: "Supreme Court Justice (Seat 4)",
      party: "7",
      partyCountryId: "US",
      date,
    });
    expect(event.office).toBeUndefined();
  });

  it("omits party fields when the nominee has none", () => {
    const event = buildScotusConfirmationCareerEvent({
      seatNumber: 1,
      partyCountryId: "US",
      date,
    });
    expect(event).not.toHaveProperty("party");
  });

  it("detects an existing confirmation for the same seat only", () => {
    const history = [
      buildScotusConfirmationCareerEvent({ seatNumber: 4, partyCountryId: "US", date }),
    ];
    expect(hasScotusConfirmationEvent(history, 4)).toBe(true);
    expect(hasScotusConfirmationEvent(history, 5)).toBe(false);
    expect(hasScotusConfirmationEvent(undefined, 4)).toBe(false);
    expect(scotusSeatCareerLabel(4)).toBe("Supreme Court Justice (Seat 4)");
  });
});
