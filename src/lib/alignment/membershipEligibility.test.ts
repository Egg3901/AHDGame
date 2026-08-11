import { describe, expect, it } from "vitest";
import { polesForYear } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import { JOIN_SHARE, LEAVE_SHARE, standingFor } from "./membershipEligibility";

const at = (w: number, e: number) => normalizeShares({ WEST: w, EAST: e }, polesForYear(1979));

describe("standingFor — the share thresholds", () => {
  it("clears a nation at the join threshold", () => {
    const s = standingFor({ shares: at(JOIN_SHARE, 5), year: 1979, organizationId: "NATO" })!;
    expect(s.share).toBe(60);
    expect(s.eligible).toBe(true);
    expect(s.wantsOut).toBe(false);
  });

  it("shows a member at the leave threshold the door", () => {
    const s = standingFor({ shares: at(LEAVE_SHARE, 30), year: 1979, organizationId: "NATO" })!;
    expect(s.share).toBe(40);
    expect(s.wantsOut).toBe(true);
    expect(s.eligible).toBe(false);
  });

  it("leaves the 41-59 band neither joining nor leaving", () => {
    // The deadband is what stops a member flapping in and out of its bloc on a
    // couple of points of drift.
    for (const share of [41, 50, 59]) {
      const s = standingFor({ shares: at(share, 10), year: 1979, organizationId: "NATO" })!;
      expect(s.eligible, `${share} must not be eligible`).toBe(false);
      expect(s.wantsOut, `${share} must not want out`).toBe(false);
    }
  });

  it("reads the share in THIS org's pole, not the nation's best pole", () => {
    // 70 toward Moscow says nothing good about a NATO application.
    const s = standingFor({ shares: at(5, 70), year: 1979, organizationId: "NATO" })!;
    expect(s.share).toBe(5);
    expect(s.eligible).toBe(false);
    expect(s.wantsOut).toBe(true);
  });

  it("reads the Non-Aligned Movement from the remainder, not from a pole", () => {
    // Non-alignment is what no bloc persuaded, so the same 60/40 thresholds
    // apply to the leftover.
    const unclaimed = standingFor({
      shares: at(10, 10),
      year: 1979,
      organizationId: "NON_ALIGNED",
    })!;
    expect(unclaimed.poleId).toBeNull();
    expect(unclaimed.share).toBe(80);
    expect(unclaimed.eligible).toBe(true);

    const claimed = standingFor({ shares: at(60, 10), year: 1979, organizationId: "NON_ALIGNED" })!;
    expect(claimed.share).toBe(30);
    expect(claimed.eligible).toBe(false);
    expect(claimed.wantsOut).toBe(true);
  });

  it("scales with the channel's own pole in a modern world", () => {
    const s = standingFor({
      shares: normalizeShares({ WASHINGTON: 20, MOSCOW: 65, BEIJING: 5 }, polesForYear(2019)),
      year: 2019,
      organizationId: "NATO",
    })!;
    expect(s.poleId).toBe("WASHINGTON");
    expect(s.share).toBe(20);
    expect(s.wantsOut).toBe(true);
  });
});

describe("standingFor — orgs with no channel", () => {
  it("has no opinion about the UN", () => {
    expect(standingFor({ shares: at(60, 5), year: 1979, organizationId: "UN" })).toBeNull();
  });

  it("has no opinion about the EU before it carries influence", () => {
    expect(standingFor({ shares: at(60, 5), year: 1979, organizationId: "EU" })).toBeNull();
  });

  it("has an opinion about the EU once it does", () => {
    const s = standingFor({
      shares: normalizeShares({ WASHINGTON: 70, MOSCOW: 5 }, polesForYear(2019)),
      year: 2019,
      organizationId: "EU",
    });
    expect(s).not.toBeNull();
    expect(s!.poleId).toBe("WASHINGTON");
    expect(s!.eligible).toBe(true);
  });
});

describe("standingFor — which orgs alignment actually governs", () => {
  it("governs the blocs a nation joins by picking a side", () => {
    for (const org of ["NATO", "WARSAW_PACT", "NON_ALIGNED"]) {
      const s = standingFor({ shares: at(70, 5), year: 1979, organizationId: org })!;
      expect(s.governsMembership, `${org} should be alignment-governed`).toBe(true);
    }
  });

  it("has no opinion at all about the Commonwealth", () => {
    // It carries no channel in any era: a former-empire association is not an
    // instrument of the Cold War, and stacking it behind NATO handed the West a
    // permanent advantage the Warsaw Pact had no way to answer.
    expect(
      standingFor({ shares: at(70, 5), year: 1979, organizationId: "COMMONWEALTH" })
    ).toBeNull();
    expect(
      standingFor({
        shares: normalizeShares({ WASHINGTON: 70, MOSCOW: 5 }, polesForYear(2019)),
        year: 2019,
        organizationId: "COMMONWEALTH",
      })
    ).toBeNull();
  });

  it("does not govern the EU — it has its own accession criteria", () => {
    const s = standingFor({
      shares: normalizeShares({ WASHINGTON: 70, MOSCOW: 5 }, polesForYear(2019)),
      year: 2019,
      organizationId: "EU",
    })!;
    expect(s.governsMembership).toBe(false);
  });
});
