/**
 * @vitest-environment happy-dom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { OrgSummary } from "../orgTypes";
import { WarEntryStatusPanel } from "./WarEntryStatusPanel";

describe("WarEntryStatusPanel", () => {
  it("surfaces offensive chamber tallies on NATO", () => {
    render(
      <WarEntryStatusPanel
        org={
          {
            id: "NATO",
            members: [
              {
                countryId: "FR",
                countryName: "France",
                flagEmoji: "🇫🇷",
              },
            ],
            warEntryOperations: [
              {
                conflictId: "germany",
                conflictName: "The War for Germany",
                conflictStatus: "active",
                militaryOrganizationId: "NATO",
                resolutionId: "resolution",
                side: "A",
                stake: "offensive_coalition",
                opposingNames: ["East Germany", "Soviet Union"],
                members: [
                  {
                    countryId: "FR",
                    stake: "offensive_coalition",
                    status: "pending",
                    lower: { for: 139, against: 135, abstain: 353 },
                    upper: { for: 315, against: 215, abstain: 177 },
                  },
                ],
              },
            ],
          } as unknown as OrgSummary
        }
      />
    );

    const panel = screen.getByText("War entry").parentElement;
    expect(panel?.textContent).toContain("Alliance call enacted");
    expect(panel?.textContent).toContain("Offensive coalition, national votes required");
    expect(panel?.textContent).toContain("National vote open");
    expect(panel?.textContent).toContain("Entry means war with East Germany and Soviet Union");
    expect(panel?.textContent).toContain("Lower 139 for, 135 against");
    expect(panel?.textContent).toContain("Upper 315 for, 215 against");
  });
});
