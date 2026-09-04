import { describe, it, expect } from "vitest";
import {
  wireHeadlineCampaignOpsLevel,
  wireHeadlineCampaignRally,
  wireHeadlinePrimaryTierLocked,
  wireHeadlineStateCalled,
  wireHeadlineFavorabilitySwing,
  wireHeadlineStateAttack,
} from "./campaignWireHeadlines";

// Player-facing copy: CLAUDE.md forbids em and en dashes in any language.
const DASHES = /[–—]/;

// Every headline is generated many times because each picks at random from a
// template set; a single call would only exercise one template.
function every(make: () => string, assert: (headline: string) => void) {
  for (let i = 0; i < 60; i++) assert(make());
}

describe("wireHeadlineCampaignOpsLevel", () => {
  it("names the candidate, the lever and the new level", () => {
    every(
      () => wireHeadlineCampaignOpsLevel("Vance", "Ground Game", 9),
      (h) => {
        expect(h).toContain("VANCE");
        expect(h.toUpperCase()).toContain("GROUND GAME");
        expect(h).toContain("9");
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlineCampaignOpsLevel("Vance", "Ground Game", 9),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});

describe("wireHeadlineCampaignRally", () => {
  it("names the candidate and the support gained", () => {
    every(
      () => wireHeadlineCampaignRally("Vance", 7.2),
      (h) => {
        expect(h).toContain("VANCE");
        expect(h).toContain("7.2");
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlineCampaignRally("Vance", 7.2),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});

describe("wireHeadlinePrimaryTierLocked", () => {
  it("names the tier and the delegates awarded", () => {
    every(
      () => wireHeadlinePrimaryTierLocked(2, 1240),
      (h) => {
        expect(h).toContain("2");
        // Delegate counts are grouped for legibility in the strip.
        expect(h).toContain("1,240");
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlinePrimaryTierLocked(2, 1240),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});

describe("wireHeadlineStateCalled", () => {
  it("names the state, the winner and the margin", () => {
    every(
      () => wireHeadlineStateCalled("Pennsylvania", "Vance", 1.4),
      (h) => {
        expect(h).toContain("PENNSYLVANIA");
        expect(h).toContain("VANCE");
        expect(h).toContain("1.4");
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlineStateCalled("Pennsylvania", "Vance", 1.4),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});

describe("wireHeadlineFavorabilitySwing", () => {
  it("reads as a fall when the swing is negative", () => {
    every(
      () => wireHeadlineFavorabilitySwing("Hale", -2),
      (h) => {
        expect(h).toContain("HALE");
        expect(h).toContain("2.0");
        // The direction must be in words, not a bare signed number, because
        // the strip has no column header to interpret it against.
        expect(h.toUpperCase()).toMatch(/DOWN|SLIPS|FALLS|DROPS|SHEDS/);
      }
    );
  });

  it("reads as a rise when the swing is positive", () => {
    every(
      () => wireHeadlineFavorabilitySwing("Hale", 3.1),
      (h) => {
        expect(h).toContain("3.1");
        expect(h.toUpperCase()).toMatch(/UP|GAINS|CLIMBS|RISES|ADDS/);
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlineFavorabilitySwing("Hale", -2),
      (h) => expect(h).not.toMatch(DASHES)
    );
    every(
      () => wireHeadlineFavorabilitySwing("Hale", 3.1),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});

describe("wireHeadlineStateAttack", () => {
  it("names the attacker, the target and the state every time", () => {
    // An attack nobody can trace back to its buyer reads as a bug in the
    // favourability numbers rather than as a rival's move.
    every(
      () => wireHeadlineStateAttack("Stevenson", "Kefauver", "Iowa"),
      (h) => {
        expect(h).toContain("STEVENSON");
        expect(h).toContain("KEFAUVER");
        expect(h).toContain("IOWA");
      }
    );
  });

  it("uses no em or en dash", () => {
    every(
      () => wireHeadlineStateAttack("Stevenson", "Kefauver", "Iowa"),
      (h) => expect(h).not.toMatch(DASHES)
    );
  });
});
