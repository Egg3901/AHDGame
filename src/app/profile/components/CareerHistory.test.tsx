/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Character } from "@/lib/db/types";
import enProfile from "../../../../messages/en/profile.json";
import { CareerHistory } from "./CareerHistory";

type CareerCharacter = Pick<Character, "careerHistory" | "currentOffice" | "countryId">;

function renderHistory(character: CareerCharacter) {
  return render(
    <NextIntlClientProvider locale="en" messages={enProfile}>
      <CareerHistory character={character} partyNames={{ "US:1": "Democratic Party" }} />
    </NextIntlClientProvider>
  );
}

const history: CareerCharacter = {
  countryId: "US",
  currentOffice: { type: "stateSenate", state: "PA", seatsHeld: 1 },
  careerHistory: [
    {
      type: "lost_election",
      office: { type: "house", state: "PA", seatsHeld: 1 },
      officeLabel: "US House (PA)",
      party: "1",
      partyCountryId: "US",
      date: new Date("2026-08-04T12:00:00Z"),
    },
    {
      type: "elected",
      office: { type: "stateSenate", state: "PA", seatsHeld: 1 },
      officeLabel: "State Senate (PA)",
      party: "1",
      partyCountryId: "US",
      date: new Date("2026-09-01T12:00:00Z"),
    },
  ],
};

describe("CareerHistory", () => {
  it("is a plain dated list, newest first, led by the office held now", () => {
    const { container } = renderHistory(history);

    // Secondary column: the smaller aside heading, never muted.
    const heading = screen.getByRole("heading", { name: "Career history" });
    expect(heading.className).toContain("text-body-lg");
    expect(heading.className).toContain("text-foreground");
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Incumbent");
    expect(items[1].textContent).toContain("Sep 1, 2026");
    expect(items[1].textContent).toMatch(/^Sep 1, 2026Elected to /);
    expect(items[2].textContent).toContain("Lost race for");
    expect(screen.getAllByText("Democratic Party")).toHaveLength(2);
    // No timeline rail and no coloured status dots.
    expect(container.querySelector(".border-l-2")).toBeNull();
    expect(container.querySelector(".rounded-full")).toBeNull();
  });

  it("offers an election search when there is no history yet", () => {
    renderHistory({ countryId: "US", currentOffice: null, careerHistory: [] });
    expect(screen.getByText("Career start")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find an election" }).getAttribute("href")).toBe(
      "/elections"
    );
  });
});
