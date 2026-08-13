/**
 * Pool legend rows must carry party identity: logo + full party name, with
 * the abbreviation kept as a secondary tag so the row still maps to the
 * pie's slice labels. Non-party buckets (Unaffiliated / Independent /
 * Unregistered) have no party, so they keep the plain colour dot.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { PoolLegend, type PoolLegendRow } from "./PoolLegend";

const ROWS: PoolLegendRow[] = [
  {
    key: "3",
    label: "Democratic Party",
    abbr: "DEM",
    partyId: "3",
    color: "#2563eb",
    value: 46.7,
  },
  {
    key: "unaffiliated",
    label: "Unaffiliated",
    color: "var(--card-border)",
    value: 18.4,
  },
];

describe("PoolLegend", () => {
  it("renders the full party name, the abbreviation, and the share", () => {
    const html = renderToString(<PoolLegend rows={ROWS} countryId="US" />);
    expect(html).toContain("Democratic Party");
    expect(html).toContain("DEM");
    // SSR splits the number and the "%" with a text-separator comment.
    expect(html).toContain("46.7");
  });

  it("renders a party logo for party rows only", () => {
    const html = renderToString(<PoolLegend rows={ROWS} countryId="US" />);
    // Party row → logo route with the country param; bucket row → colour dot.
    expect(html).toContain("/api/logos/parties/3");
    expect(html).toContain("country=us");
    expect(html.match(/<img/g) ?? []).toHaveLength(1);
    expect(html).toContain("Unaffiliated");
  });
});
