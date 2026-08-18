/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  clamp01,
  formatPct,
  memberInGameName,
  memberProfileHref,
  noisyOr,
  previewClusterConfidence,
  type AltMemberIdentity,
  type AltSignalWeights,
  type ClusterLink,
} from "./altTypes";
import { ConfidenceMeter } from "./ConfidenceMeter";
import { SignalBreakdown } from "./SignalBreakdown";
import { SuspectNameButton, SuspectPeekProvider } from "./SuspectPeek";
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

  it("prefers the in-game character name and sequential profile href", () => {
    const member: AltMemberIdentity = {
      userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      name: "acct",
      banned: false,
      characterName: "Andrew the Geo",
      characterId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      sequentialId: 42,
      avatarUrl: null,
      discordId: null,
      discordUsername: null,
      discordAvatar: null,
      discordCreatedAt: null,
      email: "a@b.c",
      lastKnownIp: "1.2.3.4",
      registrationIp: null,
      trackingId: "cookie",
    };
    expect(memberInGameName(member)).toBe("Andrew the Geo");
    expect(memberProfileHref(member)).toBe("/character/42");
    expect(memberInGameName({ ...member, characterName: null })).toBe("acct");
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

describe("SuspectNameButton peek", () => {
  it("opens a window with username, email, IP, cookie, ban, and profile link", () => {
    const member: AltMemberIdentity = {
      userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      name: "acct",
      banned: false,
      characterName: "Andrew the Geo",
      characterId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      sequentialId: 42,
      avatarUrl: null,
      discordId: null,
      discordUsername: null,
      discordAvatar: null,
      discordCreatedAt: null,
      email: "acct@example.com",
      lastKnownIp: "198.51.100.42",
      registrationIp: "198.51.100.42",
      trackingId: "cookie-abc",
    };

    render(
      <SuspectPeekProvider context="admin" onMemberBanned={vi.fn()} notify={vi.fn()}>
        <SuspectNameButton member={member} />
      </SuspectPeekProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Andrew the Geo" }));
    expect(screen.getByText("Username")).toBeTruthy();
    expect(screen.getByText("acct")).toBeTruthy();
    expect(screen.getByText("acct@example.com")).toBeTruthy();
    expect(screen.getByText("198.51.100.42")).toBeTruthy();
    expect(screen.getByText("cookie-abc")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open profile" }).getAttribute("href")).toBe(
      "/character/42"
    );
    expect(screen.getByRole("button", { name: "Ban" })).toBeTruthy();
  });
});
