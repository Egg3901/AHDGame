/** @vitest-environment happy-dom */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartyChip } from "./PartyChip";

describe("PartyChip", () => {
  it("renders the abbreviation with a title of the full name", () => {
    render(
      <PartyChip
        party={{ partyId: "8", abbreviation: "SF", color: "#326760", name: "Sinn Féin" }}
      />
    );
    const el = screen.getByText("SF");
    expect(el).toBeTruthy();
    expect(el.closest("[title]")?.getAttribute("title")).toBe("Sinn Féin");
  });
});
