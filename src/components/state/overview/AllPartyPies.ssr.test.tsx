/**
 * SSR regression test for React #418 on region pages (GlitchTip AHD-7U).
 *
 * React's server renderer emits an EMPTY `<title>` element when the JSX
 * children form an array (e.g. `{label} {value}%`), while the client render
 * fills it — an SSR/client mismatch that made every region-overview load
 * throw hydration error #418. The pies must render each SVG `<title>` from a
 * single string child so the server output already contains the text.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { AllPartyOrgPie } from "./AllPartyOrgPie";
import { AllPartyRegPie } from "./AllPartyRegPie";
import type { OverviewViewModel } from "@/lib/states/overview/types";

function makeVm(overrides: Partial<OverviewViewModel> = {}): OverviewViewModel {
  return {
    stateId: "NIR",
    countryId: "UK",
    partyOrg: [
      { id: "p1", abbr: "CON", color: "#0087DC", orgPct: 56.9, regPct: 31.7 },
      { id: "p2", abbr: "SF", color: "#326760", orgPct: 34.0, regPct: 40.4 },
    ],
    unaffiliatedPct: 9.1,
    registrationPool: {
      parties: [
        { id: "p1", abbr: "CON", color: "#0087DC", regPct: 31.7 },
        { id: "p2", abbr: "SF", color: "#326760", regPct: 40.4 },
      ],
      independent: 18.8,
      unregistered: 9.1,
      seeded: true,
    },
    pieFocusPartyId: "p1",
    focusPartyColor: "#0087DC",
    focusPartyAbbr: "CON",
    focusPartyOrgPct: 56.9,
    narrative: { rank: 1, totalParties: 2, gapToTop: 0 },
    hotRaces: [],
    contestedPrimaries: [],
    ...overrides,
  } as OverviewViewModel;
}

describe("overview pies SSR <title> content (React #418 regression)", () => {
  it("AllPartyOrgPie server-renders populated slice titles", () => {
    const html = renderToString(<AllPartyOrgPie vm={makeVm()} />);
    expect(html).toContain("<title>CON 56.9%</title>");
    expect(html).toContain("<title>SF 34.0%</title>");
    expect(html).not.toContain("<title></title>");
  });

  it("AllPartyOrgPie single-slice branch server-renders a populated title", () => {
    const vm = makeVm({
      partyOrg: [{ id: "p1", abbr: "CON", color: "#0087DC", orgPct: 100, regPct: 100 }],
      unaffiliatedPct: 0,
    });
    const html = renderToString(<AllPartyOrgPie vm={vm} />);
    expect(html).toContain("<title>CON 100.0%</title>");
    expect(html).not.toContain("<title></title>");
  });

  it("AllPartyRegPie server-renders populated slice titles", () => {
    const html = renderToString(<AllPartyRegPie vm={makeVm()} />);
    expect(html).toContain("<title>CON 31.7%</title>");
    expect(html).toContain("<title>Independent 18.8%</title>");
    expect(html).not.toContain("<title></title>");
  });

  it("AllPartyRegPie single-slice branch server-renders a populated title", () => {
    const vm = makeVm({
      registrationPool: {
        parties: [{ id: "p1", abbr: "CON", color: "#0087DC", regPct: 100 }],
        independent: 0,
        unregistered: 0,
        seeded: true,
      },
    });
    const html = renderToString(<AllPartyRegPie vm={vm} />);
    expect(html).toContain("<title>CON 100.0%</title>");
    expect(html).not.toContain("<title></title>");
  });
});
