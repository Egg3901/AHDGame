/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { StageField, type StageFieldRow } from "./StageField";

const row: StageFieldRow = {
  id: "candidate-1",
  name: "Alex Exampleton",
  href: "/character/candidate-1",
  avatarUrl: null,
  partyName: "Forward Example Party",
  partyId: "1",
  partyHref: "/country/us/parties/1",
  color: "#2563eb",
  figure: "63.6%",
  sub: "1,585 proj. · 953 won",
  campaignHref: "/campaign/candidate-1",
  action: (
    <div data-testid="mobile-campaign-line">
      <span>$1,803,010.26 · 8 act. · 5 lvl</span>
      <button type="button">View campaign</button>
    </div>
  ),
};

describe("StageField", () => {
  it("stacks a phone row and keeps candidate names on whole words", () => {
    render(
      <div data-testid="phone-viewport" style={{ width: 390 }}>
        <StageField rows={[row]} countryId="US" title="The field" />
      </div>
    );

    const viewport = screen.getByTestId("phone-viewport");
    const name = screen.getByRole("link", { name: "Alex Exampleton" });
    const fieldRow = name.closest('[data-field-row="candidate-1"]');
    if (!fieldRow) throw new Error("Expected the candidate field row");
    const nameColumn = name.closest('[data-field-part="name-column"]');
    const identity = fieldRow.querySelector<HTMLElement>('[data-field-part="identity"]');
    const subline = fieldRow.querySelector<HTMLElement>('[data-field-part="subline"]');
    const action = fieldRow.querySelector<HTMLElement>('[data-field-part="action"]');
    const nameParts = [name, ...Array.from(name.querySelectorAll<HTMLElement>("*"))];

    expect(viewport.style.width).toBe("390px");
    expect(nameParts.every((part) => !part.classList.contains("break-all"))).toBe(true);
    expect(nameParts.every((part) => part.style.overflowWrap === "")).toBe(true);
    expect(nameColumn?.classList.contains("min-w-0")).toBe(true);
    expect(nameColumn?.classList.contains("flex-1")).toBe(true);
    expect(identity?.style.gridColumn).toBe("2");
    expect(identity?.querySelector('[data-field-part="figure"]')?.textContent).toContain("63.6%");
    expect(subline?.style.gridColumn).toBe("2");
    expect(subline?.textContent).toContain("1,585 proj. · 953 won");
    expect(action?.style.gridColumn).toBe("2");
    expect(action?.textContent).toContain("$1,803,010.26 · 8 act. · 5 lvl");
    expect(action?.textContent).toContain("View campaign");
    expect(screen.getByRole("link", { name: "Campaign" }).parentElement).toBe(subline);
    expect(
      Array.from(fieldRow.children).map((child) => child.getAttribute("data-field-part"))
    ).toEqual(["avatar", "identity", "metadata", "subline", "action"]);
  });

  it("keeps party details and badges below the name without losing links or actions", () => {
    let endorsements = 0;
    const { container } = render(
      <StageField
        rows={[
          {
            ...row,
            isYou: true,
            isWinner: true,
            action: (
              <button type="button" onClick={() => endorsements++}>
                Endorse
              </button>
            ),
          },
        ]}
        countryId="US"
      />
    );

    const identity = container.querySelector('[data-field-part="identity"]');
    const metadata = container.querySelector<HTMLElement>('[data-field-part="metadata"]');
    expect(identity?.textContent).toBe("Alex Exampleton63.6%");
    expect(metadata).not.toBeNull();
    if (!metadata) throw new Error("Expected party details below the name");
    expect(metadata.style.gridColumn).toBe("2");
    expect(metadata.style.flexWrap).toBe("wrap");
    expect(within(metadata).getByRole("link", { name: row.partyName }).getAttribute("href")).toBe(
      row.partyHref
    );
    expect(within(metadata).getByText("YOU")).toBeTruthy();
    expect(within(metadata).getByText("★")).toBeTruthy();
    expect(screen.getByRole("link", { name: row.name }).getAttribute("href")).toBe(row.href);
    expect(screen.getByRole("link", { name: "Campaign" }).getAttribute("href")).toBe(
      row.campaignHref
    );
    fireEvent.click(screen.getByRole("button", { name: "Endorse" }));
    expect(endorsements).toBe(1);
  });

  it("ellipsizes an oversized single word instead of splitting it", () => {
    const longName = "UnreasonablyLongCandidateWord";
    render(
      <div style={{ width: 120 }}>
        <StageField
          rows={[{ ...row, name: longName, sub: undefined, campaignHref: null, action: undefined }]}
          countryId="US"
        />
      </div>
    );

    const name = screen.getByRole("link", { name: longName });
    const word = name.querySelector("span");
    expect(word?.style.maxWidth).toBe("100%");
    expect(word?.style.whiteSpace).toBe("nowrap");
    expect(word?.style.textOverflow).toBe("ellipsis");
    expect(word?.style.overflow).toBe("hidden");
    expect(name.style.overflowWrap).toBe("");
  });
});
