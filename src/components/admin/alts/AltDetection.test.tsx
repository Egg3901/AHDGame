/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  clamp01,
  formatPct,
  noisyOr,
  previewClusterConfidence,
  type AltSignalWeights,
  type ClusterLink,
} from "./altTypes";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { SignalBreakdown } from "./SignalBreakdown";
import { DEFAULT_ALT_SCORING_WEIGHTS } from "@/lib/altDetection/config";

describe("altTypes helpers", () => {
  it("formats confidence as a rounded percent", () => {
    expect(formatPct(0.823)).toBe("82%");
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-1)).toBe(0);
  });

  it("noisy-OR accumulates but saturates below 1", () => {
    // two strong signals: 1 - (0.1 * 0.1) = 0.99
    expect(noisyOr([0.9, 0.9])).toBeCloseTo(0.99, 5);
    // weak signals accumulate but stay < 1
    expect(noisyOr([0.15, 0.15, 0.15])).toBeLessThan(1);
    expect(noisyOr([0.15, 0.15, 0.15])).toBeGreaterThan(0.15);
  });

  it("keeps guarded (weight-0) signals immovable in the live preview", () => {
    const baseline: AltSignalWeights = { ...DEFAULT_ALT_SCORING_WEIGHTS };
    const link: ClusterLink = {
      userA: "a",
      userB: "b",
      confidence: 0,
      signals: [
        // a guarded IP (CF-edge) scored to 0 — must never contribute
        {
          type: "ip_exact_nonCF",
          weight: 0,
          contribution: 0,
          evidence: "Shared IP is Cloudflare edge — excluded",
        },
        // a real firing signal
        {
          type: "ip_exact_nonCF",
          weight: 0.35,
          contribution: 0.35,
          evidence: "Shared residential IP",
        },
      ],
    };

    // Cranking the ip_exact_nonCF weight up scales the firing signal but the
    // guarded copy stays at 0.
    const edited: AltSignalWeights = { ...baseline, ip_exact_nonCF: 0.7 };
    const withEdit = previewClusterConfidence([link], baseline, edited, /* strongLink */ 0.8);
    const atBaseline = previewClusterConfidence([link], baseline, baseline, 0.8);

    expect(atBaseline).toBeCloseTo(0.35, 5); // only the firing signal counts
    expect(withEdit).toBeGreaterThan(atBaseline); // firing signal scaled up
    expect(withEdit).toBeCloseTo(0.7, 5); // exactly the scaled firing weight, guard added nothing
  });
});

describe("ConfidenceMeter", () => {
  it("renders the confidence percent prominently", () => {
    render(<ConfidenceMeter value={0.82} />);
    expect(screen.getByText("82%")).toBeTruthy();
  });
});

describe("SignalBreakdown", () => {
  it("shows the total confidence and makes guards visible as non-inflating", () => {
    render(
      <SignalBreakdown
        confidence={0.9}
        contributions={[
          {
            type: "device_fingerprint_exact",
            weight: 0.95,
            contribution: 0.9,
            evidence: "Exact fingerprint match (a1b2c3d4…)",
          },
        ]}
        guards={[
          {
            type: "ip_exact_nonCF",
            evidence: "Shared IP is Cloudflare edge — excluded from scoring",
          },
        ]}
      />
    );
    expect(screen.getByText(/= 90% ring confidence/)).toBeTruthy();
    expect(screen.getByText(/did NOT inflate this score/i)).toBeTruthy();
    expect(screen.getByText(/Cloudflare edge/)).toBeTruthy();
  });
});
