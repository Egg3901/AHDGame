/**
 * Suite 25: Full State Demographic Census
 *
 * For EVERY state, show:
 *   - Each demographic group: population %, effective turnout, voter share, econ/social lean
 *   - Turnout-weighted aggregate econ + social lean
 *   - Display lean (averaged or dominant axis)
 *   - Lean label (Very Left / Left / Center / Right / Very Right)
 *   - 2020 election margin & derived lean for comparison
 */

import {
  flag,
  table,
  pct,
  categories,
  STATE_DEMOGRAPHICS,
  calculateStateLean,
  ELECTION_2020_MARGIN,
  marginToLean,
} from "../helpers";
import { getDisplayLean, getLeanLabel } from "../../../src/lib/utils/demographics";
import { ELECTORAL_VOTES } from "../../../src/lib/constants/states";

export function suite25_allStateDemographicCensus(): string {
  const lines: string[] = [
    "## Suite 25: Full State Demographic Census\n\n" +
      "**All states.** Per-group voter shares and aggregate lean derived from turnout-weighted demographics.\n" +
      "Lean scale: −5 (Very Left) → 0 (Center) → +5 (Very Right).\n",
  ];

  const stateIds = Object.keys(STATE_DEMOGRAPHICS).sort();
  const category = categories[0]; // primary demographic category

  // ── Summary table: one row per state ──────────────────────────────────────
  lines.push("### Summary — all states\n");
  const summaryRows: string[][] = [];

  for (const stateId of stateIds) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;

    const { economicLean, socialLean } = calculateStateLean(demo, categories);
    const displayLean = getDisplayLean(economicLean, socialLean);
    const label = getLeanLabel(displayLean);

    const margin2020 = (ELECTION_2020_MARGIN as Record<string, number>)[stateId];
    const lean2020 = margin2020 !== undefined ? marginToLean(margin2020) : null;
    const diff = lean2020 !== null ? displayLean - lean2020 : null;
    const diffStr = diff !== null ? (diff >= 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2)) : "N/A";
    const flagMark = diff !== null && Math.abs(diff) > 1.0 ? "⚠️" : "";

    const ev = (ELECTORAL_VOTES as Record<string, number>)[stateId] ?? 0;
    summaryRows.push([
      stateId,
      String(ev),
      economicLean.toFixed(2),
      socialLean.toFixed(2),
      displayLean.toFixed(2),
      label,
      lean2020 !== null ? lean2020.toFixed(2) : "N/A",
      diffStr,
      flagMark,
    ]);
  }

  lines.push(
    table(
      [
        "State",
        "EV",
        "Econ",
        "Social",
        "Display lean",
        "Label",
        "2020 lean",
        "Diff vs 2020",
        "Flag",
      ],
      summaryRows
    )
  );

  // ── Per-state group breakdown ──────────────────────────────────────────────
  lines.push("\n---\n\n### Per-state group breakdown\n");

  for (const stateId of stateIds) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;

    const { economicLean, socialLean } = calculateStateLean(demo, categories);
    const displayLean = getDisplayLean(economicLean, socialLean);
    const label = getLeanLabel(displayLean);

    lines.push(
      `\n#### ${stateId} — Econ: ${economicLean.toFixed(2)}, Social: ${socialLean.toFixed(2)}, Display: ${displayLean.toFixed(2)} (${label})\n`
    );

    const groupRows: string[][] = [];
    let totalWeight = 0;
    const groupData: Array<{
      name: string;
      pop: number;
      turnout: number;
      econ: number;
      social: number;
      weight: number;
    }> = [];

    for (const group of category.groups) {
      const sg = demo.groups[group.id];
      const pop = sg?.population ?? 0;
      const turnout = typeof sg?.turnout === "number" ? sg.turnout : (group.defaultTurnout ?? 55);
      const econ = sg?.economicLean ?? group.defaultEconomicLean;
      const social = sg?.socialLean ?? group.defaultSocialLean;
      const weight = pop * (turnout / 100);
      totalWeight += weight;
      groupData.push({ name: group.name, pop, turnout, econ, social, weight });
    }

    // Sort by voter share descending
    groupData.sort((a, b) => b.weight - a.weight);

    for (const g of groupData) {
      const share = totalWeight > 0 ? (g.weight / totalWeight) * 100 : 0;
      const econLabel = g.econ > 0.5 ? "R" : g.econ < -0.5 ? "L" : "C";
      const socialLabel = g.social > 0.5 ? "R" : g.social < -0.5 ? "L" : "C";
      groupRows.push([
        g.name,
        `${g.pop.toFixed(1)}%`,
        `${g.turnout}%`,
        pct(share),
        g.econ.toFixed(2),
        g.social.toFixed(2),
        `${econLabel}/${socialLabel}`,
      ]);
    }

    lines.push(
      table(["Group", "Pop%", "Turnout", "Voter share", "Econ", "Social", "Axis"], groupRows)
    );

    // Flag states where top group holds >50% of vote
    const topSharePct = totalWeight > 0 ? (groupData[0].weight / totalWeight) * 100 : 0;
    if (topSharePct > 50)
      flag(
        25,
        "Demo Concentration",
        `${stateId}: "${groupData[0].name}" holds ${topSharePct.toFixed(1)}% of vote — single group dominates`
      );
  }

  // ── Lean distribution summary ──────────────────────────────────────────────
  lines.push("\n---\n\n### Lean distribution across all states\n");
  const buckets: Record<string, string[]> = {
    "Very Left (≤−0.6)": [],
    "Left (−0.6 to −0.2)": [],
    "Center (−0.2 to +0.2)": [],
    "Right (+0.2 to +0.6)": [],
    "Very Right (≥+0.6)": [],
  };

  for (const stateId of stateIds) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;
    const { economicLean, socialLean } = calculateStateLean(demo, categories);
    const d = getDisplayLean(economicLean, socialLean);
    if (d <= -0.6) buckets["Very Left (≤−0.6)"].push(stateId);
    else if (d <= -0.2) buckets["Left (−0.6 to −0.2)"].push(stateId);
    else if (d < 0.2) buckets["Center (−0.2 to +0.2)"].push(stateId);
    else if (d < 0.6) buckets["Right (+0.2 to +0.6)"].push(stateId);
    else buckets["Very Right (≥+0.6)"].push(stateId);
  }

  const evByBucket: Record<string, number> = {};
  for (const [bucket, states] of Object.entries(buckets)) {
    evByBucket[bucket] = states.reduce(
      (sum, s) => sum + ((ELECTORAL_VOTES as Record<string, number>)[s] ?? 0),
      0
    );
  }
  const distRows = Object.entries(buckets).map(([label, states]) => [
    label,
    String(states.length),
    String(evByBucket[label]),
    states.join(", ") || "—",
  ]);
  lines.push(table(["Bucket", "States", "EVs", "State list"], distRows));

  // EV totals by partisan side
  const leftEV = (evByBucket["Very Left (≤−0.6)"] ?? 0) + (evByBucket["Left (−0.6 to −0.2)"] ?? 0);
  const centerEV = evByBucket["Center (−0.2 to +0.2)"] ?? 0;
  const rightEV =
    (evByBucket["Right (+0.2 to +0.6)"] ?? 0) + (evByBucket["Very Right (≥+0.6)"] ?? 0);
  lines.push(
    `\n**Electoral vote totals: Left ${leftEV} | Center ${centerEV} | Right ${rightEV} | Total ${leftEV + centerEV + rightEV}**`
  );
  lines.push(`_270 needed to win. Center states (${centerEV} EVs) are the battleground._`);

  const leftCount = buckets["Very Left (≤−0.6)"].length + buckets["Left (−0.6 to −0.2)"].length;
  const rightCount = buckets["Right (+0.2 to +0.6)"].length + buckets["Very Right (≥+0.6)"].length;
  if (leftCount === 0 || rightCount === 0)
    flag(
      25,
      "Demo Balance",
      `All states lean the same direction — no ideological spread (L=${leftCount}, R=${rightCount})`
    );

  return lines.join("\n");
}
