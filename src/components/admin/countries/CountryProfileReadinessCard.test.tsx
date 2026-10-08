// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CountryProfileReadinessCard,
  type CountryProfileReadiness,
} from "./CountryProfileReadinessCard";

const readiness: CountryProfileReadiness = {
  presetId: "2019-default",
  source: "reset-preset",
  activeLevel: "economy-preview",
  presetLevel: "economy-preview",
  backgroundMode: null,
  contentStatus: "gaps",
  contentGaps: [
    {
      capabilityId: "wikiMaterial",
      label: "Wiki material",
      evidence: "No authored wiki material declared for this preset.",
    },
  ],
  profiles: [
    { level: "background", label: "Background", status: "ready", blockers: [] },
    {
      level: "economy-preview",
      label: "Economy Preview",
      status: "not-ready",
      blockers: [
        {
          capabilityId: "fullAutonomousTier",
          label: "Full-autonomous simulation tier",
          evidence: "Manifest tier is background-macro; full-autonomous required.",
        },
      ],
    },
    {
      level: "player-enabled",
      label: "Player Enabled",
      status: "not-ready",
      blockers: [
        {
          capabilityId: "adminDiagnostics",
          label: "Admin readiness diagnostics registered",
          evidence: "No readiness expectations entry.",
        },
      ],
    },
  ],
};

describe("CountryProfileReadinessCard", () => {
  it("shows all profile results, the reset preset, and blockers", () => {
    render(<CountryProfileReadinessCard readiness={readiness} />);

    expect(screen.getByText("2019 reset profile")).toBeTruthy();
    expect(screen.getByText("Background")).toBeTruthy();
    expect(screen.getByText("Economy Preview")).toBeTruthy();
    expect(screen.getByText("Player Enabled")).toBeTruthy();
    expect(screen.getAllByText("Not ready")).toHaveLength(2);
    expect(screen.getByText("Full-autonomous simulation tier")).toBeTruthy();
    expect(screen.getByText("Admin readiness diagnostics registered")).toBeTruthy();
    expect(screen.getByText("1 tracked gap")).toBeTruthy();
    expect(screen.getByText("Wiki material:")).toBeTruthy();
  });

  it("labels the preset's background mode", () => {
    render(
      <CountryProfileReadinessCard
        readiness={{
          ...readiness,
          activeLevel: "background",
          presetLevel: "background",
          backgroundMode: "latent",
        }}
      />
    );

    expect(screen.getByText("Preset mode: Latent and seeded")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
  });
});
