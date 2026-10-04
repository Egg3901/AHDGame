/**
 * Server render of the Overview pool breakdown (donut plus legend).
 *
 * The slice <title> must come from a single string child: React's server
 * renderer emits an empty <title> for array children, which mismatched the
 * client render and threw hydration error #418 on every region overview
 * (GlitchTip AHD-7U).
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PoolBreakdown, type PoolSlice } from "./PoolBreakdown";

const SLICES: PoolSlice[] = [
  {
    key: "3",
    label: "Democratic Party",
    abbr: "DEM",
    partyId: "3",
    color: "#2563eb",
    value: 46.7,
  },
  { key: "4", label: "Republican Party", abbr: "REP", partyId: "4", color: "#dc2626", value: 34.9 },
  { key: "unaffiliated", label: "Unaffiliated", color: "var(--card-border)", value: 18.4 },
];

function render(slices: PoolSlice[], focusKey: string | null = "3", children?: React.ReactNode) {
  return renderToString(
    <PoolBreakdown
      title="Organization"
      slices={slices}
      focusKey={focusKey}
      countryId="US"
      stateId="PA"
      emptyMessage="No party has organization in this state yet."
    >
      {children}
    </PoolBreakdown>
  );
}

describe("PoolBreakdown", () => {
  it("server-renders populated slice titles", () => {
    const html = render(SLICES);
    expect(html).toContain("<title>DEM 46.7%</title>");
    expect(html).toContain("<title>Unaffiliated 18.4%</title>");
    expect(html).not.toContain("<title></title>");
  });

  it("shows the focus party in the donut centre", () => {
    const html = render(SLICES, "4");
    expect(html).toMatch(/<text[^>]*>REP<\/text>/);
    expect(html).toMatch(/<text[^>]*>34.9%<\/text>/);
  });

  it("falls back to the largest slice when the focus party has no share", () => {
    const html = render(SLICES, "99");
    expect(html).toMatch(/<text[^>]*>DEM<\/text>/);
  });

  it("links party rows to the party's page in this region, with its logo", () => {
    const html = render(SLICES);
    expect(html).toContain('href="/country/us/region/PA/party/3"');
    expect(html).toContain("/api/logos/parties/3");
    // Two party rows carry a logo; the Unaffiliated bucket keeps a colour dot.
    expect(html.match(/<img/g) ?? []).toHaveLength(2);
    expect(html).not.toContain("/party/unaffiliated");
  });

  it("draws a lone slice as a full ring", () => {
    const html = render([
      {
        key: "3",
        label: "Democratic Party",
        abbr: "DEM",
        partyId: "3",
        color: "#2563eb",
        value: 100,
      },
    ]);
    const paths = html.match(/<path[^>]* d="([^"]+)"/g) ?? [];
    expect(paths).toHaveLength(1);
    // Two half-turn arcs on each radius, so the ring is not a zero-length arc.
    expect(((paths[0] ?? "").match(/A76,76/g) ?? []).length).toBe(2);
  });

  it("shows the empty message and still renders the call to action", () => {
    const html = render(
      [{ key: "unaffiliated", label: "Unaffiliated", color: "#000", value: 0 }],
      null,
      <button type="button">Build Org</button>
    );
    expect(html).toContain("No party has organization in this state yet.");
    expect(html).toContain("Build Org");
    expect(html).not.toContain("<svg");
  });
});
