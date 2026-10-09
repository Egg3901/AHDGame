/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TreasuryGotvControl } from "./TreasuryGotvControl";
import type { PartyData } from "./types";

describe("TreasuryGotvControl demographic catalog", () => {
  it("renders the same section and bucket labels as the region demographics view", () => {
    render(
      <TreasuryGotvControl
        party={
          {
            countryId: "UK",
            economicPosition: -1,
            socialPosition: 0,
            expectedHourlyIncome: 100_000,
            regionCount: 12,
            gotvBudgetPercent: 10,
            gotvTargetCategory: "education",
            gotvTargetGroup: "degree_plus",
          } as PartyData
        }
        countryId="UK"
        gotvForm={{ percent: 10, category: "education", group: "degree_plus", saving: false }}
        dispatch={vi.fn()}
        onSave={vi.fn()}
        targetSections={[
          {
            dim: "ethnicity",
            dimLabel: "Background",
            options: [
              {
                id: "ethnicity:white_british",
                label: "White British",
                economicLean: 0.5,
                socialLean: 0.7,
              },
            ],
          },
          {
            dim: "education",
            dimLabel: "Education",
            options: [
              {
                id: "education:no_qualifications",
                label: "No qualifications",
                economicLean: 0.8,
                socialLean: 1.1,
              },
              {
                id: "education:degree_plus",
                label: "Degree or higher",
                economicLean: -1.2,
                socialLean: -1.5,
              },
            ],
          },
        ]}
      />
    );

    expect(screen.getByRole("option", { name: "Background" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Education" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "No qualifications" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Degree or higher" })).toBeTruthy();
    // Existing archetypes remain available after the matching census buckets,
    // so the party picker becomes a superset rather than invalidating targets.
    expect(screen.getByRole("option", { name: "Voter Group" })).toBeTruthy();
  });
});
