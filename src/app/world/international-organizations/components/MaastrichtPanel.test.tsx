/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/worldOrganizations.json";
import { MaastrichtPanel } from "./MaastrichtPanel";
import type { OrgSummary } from "../orgTypes";

afterEach(cleanup);
function view(
  stage: "community" | "union",
  source: "historical-seed" | "ratified-treaty" = "historical-seed"
) {
  const org = {
    europeanIntegration: {
      stage,
      source,
      establishedTurn: 1,
      ratifications: {
        DK: {
          approved: false,
          decisionId: "dk",
          turn: 55,
          reasons: ["Domestic instability prevents treaty commitments."],
        },
      },
    },
    members: [
      { countryId: "DK", countryName: "Denmark", flagEmoji: "🇩🇰" },
      { countryId: "UK", countryName: "United Kingdom", flagEmoji: "🇬🇧" },
    ],
  } as unknown as OrgSummary;
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MaastrichtPanel org={org} />
    </NextIntlClientProvider>
  );
}
describe("Maastricht decision visibility", () => {
  it("shows rejection reasons and members awaiting a decision", () => {
    view("community");
    expect(screen.getByText(/Rejected/)).toBeTruthy();
    expect(screen.getByText("Domestic instability prevents treaty commitments.")).toBeTruthy();
    expect(screen.getByText(/Awaiting decision/)).toBeTruthy();
  });
  it("does not invent outstanding ratifications in historical union saves", () => {
    view("union");
    expect(screen.getByText("The European Union treaty is in effect.")).toBeTruthy();
    expect(screen.queryByText(/Awaiting decision/)).toBeNull();
  });
});
