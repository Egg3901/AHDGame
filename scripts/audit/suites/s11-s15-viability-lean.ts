/**
 * Suites 11–15: New player viability, turnout bias, state lean accuracy, NPI crossover
 *
 * All state-election suites. PI capped at 100.
 */

import {
  flag,
  table,
  pct,
  makeCandidate,
  runRace,
  categories,
  STATE_DEMOGRAPHICS,
  calculateStateLean,
  ELECTION_2020_MARGIN,
  marginToLean,
  PI_LEVELS,
  REPRESENTATIVE_STATES,
} from "../helpers";

// ── Suite 11: New Player Viability ────────────────────────────────────────
export function suite11_newPlayerViability(): string {
  const lines: string[] = [
    "## Suite 11: New Player Viability — State Elections\n\n" +
      "**Question:** Can a new player (PI=10, fav=50) compete against a veteran (PI=100, fav=75)?\n" +
      "PI=100 is the max in state elections.\n",
  ];

  // 11a. New player (aligned 0/0) vs veteran at varying misalignment
  lines.push("### A: New player (0/0, PI=10, fav=50) vs veteran at varying misalignment. PA.\n");
  const misRows: string[][] = [];
  for (let d = 0; d <= 5; d++) {
    const np = makeCandidate("np", "New player (0/0)", 0, 0, 10, 50);
    const vet = makeCandidate("vet", `Veteran (+${d}/+${d}, PI=100)`, d, d, 100, 75);
    const r = runRace([np, vet], "PA");
    misRows.push([
      String(d),
      pct(r["np"]),
      pct(r["vet"]),
      r["np"] > r["vet"] ? "New player ✓" : "Veteran",
    ]);
    if (d === 0 && r["vet"] > 50)
      flag(
        11,
        "New Player Viability",
        `Veteran wins even at d=0 — new player can't beat veteran even with same positions`
      );
    if (d >= 3 && r["np"] < 30)
      flag(
        11,
        "New Player Viability",
        `New player only ${r["np"].toFixed(1)}% even with veteran ${d}-unit misaligned`
      );
  }
  lines.push(
    table(["Veteran misalignment", "New player share", "Veteran share", "Winner"], misRows)
  );

  // 11b. At what PI does new player become competitive? (veteran aligned 0/0, PI=100)
  lines.push(
    "\n### B: Veteran well-aligned (0/0, PI=100, fav=75). New player grows PI. Same position. PA.\n"
  );
  const piRows: string[][] = [];
  for (const pi of PI_LEVELS) {
    const np = makeCandidate("np", `New player PI=${pi}`, 0, 0, pi, 50);
    const vet = makeCandidate("vet", "Veteran PI=100, fav=75", 0, 0, 100, 75);
    const r = runRace([np, vet], "PA");
    piRows.push([String(pi), pct(r["np"]), pct(r["vet"])]);
  }
  lines.push(table(["New player PI", "New player share", "Veteran share"], piRows));

  // 11c. Cross-state viability at PI=10 vs PI=100
  lines.push(
    "\n### C: Cross-state new player viability (PI=10, fav=50 vs PI=100, fav=75, same position 0/0)\n"
  );
  const crossRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const np = makeCandidate("np", "New player", 0, 0, 10, 50);
    const vet = makeCandidate("vet", "Veteran", 0, 0, 100, 75);
    const r = runRace([np, vet], stateId);
    crossRows.push([`${label} (${stateId})`, pct(r["np"]), pct(r["vet"])]);
  }
  lines.push(table(["State", "New player (PI=10, fav=50)", "Veteran (PI=100, fav=75)"], crossRows));

  // 11d. Edge case: can a perfectly-aligned new player ever win?
  lines.push(
    "\n### D: Edge case — new player perfectly aligned (0/0), veteran maximally misaligned (+5/+5)\n"
  );
  const edgeNP = makeCandidate("np", "New player (0/0, PI=10, fav=50)", 0, 0, 10, 50);
  const edgeVet = makeCandidate("vet", "Veteran (+5/+5, PI=100, fav=75)", 5, 5, 100, 75);
  const edgeR = runRace([edgeNP, edgeVet], "PA");
  lines.push(`New player: ${pct(edgeR["np"])} — Veteran: ${pct(edgeR["vet"])}`);
  if (edgeR["np"] < 40)
    flag(
      11,
      "New Player Viability",
      `New player (perfectly aligned) only gets ${edgeR["np"].toFixed(1)}% against maximally misaligned veteran in PA`
    );

  return lines.join("\n");
}

// ── Suite 12: Demographic Turnout Bias ────────────────────────────────────
export function suite12_turnoutBias(): string {
  const lines: string[] = [
    "## Suite 12: Demographic Turnout Bias\n\n" +
      "**Question:** Do turnout defaults create a systematic partisan tilt independent of policy?\n",
  ];

  const category = categories[0];

  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;

    lines.push(`\n### ${label} (${stateId})\n`);
    const groupData: Array<{ name: string; econ: number; social: number; voterShare: number }> = [];
    let totalWeight = 0;

    for (const group of category.groups) {
      const sg = demo.groups[group.id];
      const pop = sg?.population ?? 0;
      const turnout = typeof sg?.turnout === "number" ? sg.turnout : (group.defaultTurnout ?? 55);
      const econ = sg?.economicLean ?? group.defaultEconomicLean;
      const social = sg?.socialLean ?? group.defaultSocialLean;
      const w = pop * (turnout / 100);
      totalWeight += w;
      groupData.push({ name: group.name, econ, social, voterShare: w });
    }

    groupData.sort((a, b) => b.voterShare - a.voterShare);
    let weightedEcon = 0,
      weightedSocial = 0;
    const rows: string[][] = [];

    for (const g of groupData) {
      const share = totalWeight > 0 ? (g.voterShare / totalWeight) * 100 : 0;
      weightedEcon += (share / 100) * g.econ;
      weightedSocial += (share / 100) * g.social;
      rows.push([
        g.name,
        g.econ.toFixed(1),
        g.social.toFixed(1),
        pct(share),
        g.econ > 0.2 ? "R" : g.econ < -0.2 ? "L" : "C",
      ]);
    }

    lines.push(table(["Group", "Econ", "Social", "Voter share", "Lean"], rows));
    lines.push(
      `\n**Electorate lean (turnout-weighted): Econ=${weightedEcon.toFixed(2)}, Social=${weightedSocial.toFixed(2)}**`
    );

    if (Math.abs(weightedEcon) > 0.2)
      flag(
        12,
        "Turnout Bias",
        `${label} electorate tilts economically ${weightedEcon > 0 ? "RIGHT" : "LEFT"} (${weightedEcon.toFixed(2)}) from turnout alone`
      );
  }

  return lines.join("\n");
}

// ── Suite 13: Turnout Sensitivity ─────────────────────────────────────────
export function suite13_turnoutSensitivity(): string {
  const lines: string[] = [
    "## Suite 13: Turnout Sensitivity\n\n" +
      "**Setup:** Boost low-turnout left-leaning groups (Young Renters 38%→55%, New Americans 42%→55%).\n\n" +
      "**Question:** How much does correcting low-turnout groups shift state lean and outcomes?\n",
  ];

  const category = categories[0];

  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;
    lines.push(`\n### ${label} (${stateId})\n`);

    const calcLean = (overrides: Record<string, number>) => {
      let total = 0,
        wEcon = 0,
        wSocial = 0;
      for (const group of category.groups) {
        const sg = demo.groups[group.id];
        const pop = sg?.population ?? 0;
        const base = typeof sg?.turnout === "number" ? sg.turnout : group.defaultTurnout;
        const turnout = overrides[group.id] ?? base;
        const econ = sg?.economicLean ?? group.defaultEconomicLean;
        const social = sg?.socialLean ?? group.defaultSocialLean;
        const w = pop * (turnout / 100);
        total += w;
        wEcon += w * econ;
        wSocial += w * social;
      }
      return { econ: total > 0 ? wEcon / total : 0, social: total > 0 ? wSocial / total : 0 };
    };

    const before = calcLean({});
    const after = calcLean({ young_renters: 55, new_immigrants: 55 });

    lines.push(
      table(
        ["Scenario", "Econ lean", "Social lean"],
        [
          ["Current defaults", before.econ.toFixed(3), before.social.toFixed(3)],
          ["Young Renters 55%, New Americans 55%", after.econ.toFixed(3), after.social.toFixed(3)],
          [
            "Difference",
            (after.econ - before.econ).toFixed(3),
            (after.social - before.social).toFixed(3),
          ],
        ]
      )
    );
  }

  lines.push(
    "\n**Interpretation:** If lean shifts significantly from small turnout changes, the model is highly sensitive to low-turnout left-leaning groups."
  );
  return lines.join("\n");
}

// ── Suite 14: State Lean Accuracy ─────────────────────────────────────────
export function suite14_stateLeanAccuracy(): string {
  const lines: string[] = [
    "## Suite 14: State Lean Accuracy vs 2020 Results\n\n" +
      "**Question:** Does demographic-derived lean match actual voting patterns? Flag divergences > 1.0.\n",
  ];

  const rows: string[][] = [];
  const flagged: string[] = [];
  const diffs: number[] = [];

  for (const stateId of Object.keys(STATE_DEMOGRAPHICS).sort()) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;
    const { economicLean, socialLean } = calculateStateLean(demo, categories);
    const avgDerived = (economicLean + socialLean) / 2;
    const margin2020 = (ELECTION_2020_MARGIN as Record<string, number>)[stateId];
    const lean2020 = margin2020 !== undefined ? marginToLean(margin2020) : null;
    const diff = lean2020 !== null ? Math.abs(avgDerived - lean2020) : null;
    if (diff !== null) diffs.push(diff);
    const isFlagged = diff !== null && diff > 1.0;
    if (isFlagged) flagged.push(stateId);
    const directionError =
      lean2020 !== null &&
      ((avgDerived > 0.2 && lean2020 < -0.2) || (avgDerived < -0.2 && lean2020 > 0.2));
    if (directionError)
      flag(
        14,
        "State Lean",
        `${stateId} — derived lean ${avgDerived.toFixed(2)} disagrees in direction with 2020 lean ${lean2020!.toFixed(2)}`
      );
    rows.push([
      stateId,
      economicLean.toFixed(2),
      socialLean.toFixed(2),
      avgDerived.toFixed(2),
      lean2020 !== null ? lean2020.toFixed(2) : "N/A",
      diff !== null ? diff.toFixed(2) : "N/A",
      isFlagged ? "⚠️" : "",
    ]);
  }

  lines.push(table(["State", "Econ", "Social", "Avg derived", "2020 lean", "Diff", "Flag"], rows));
  if (flagged.length > 0) {
    lines.push(`\n⚠️ **${flagged.length} states diverge > 1.0 from 2020:** ${flagged.join(", ")}`);
    flag(14, "State Lean", `${flagged.length} states diverge > 1.0 from 2020 election lean`);
  }
  const avgDiff = diffs.length > 0 ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
  lines.push(`\n**Average divergence: ${avgDiff.toFixed(3)}**`);
  return lines.join("\n");
}

// ── Suite 15: PI Crossover Map (State Elections) ───────────────────────────
export function suite15_piCrossoverMap(): string {
  const lines: string[] = [
    "## Suite 15: PI Crossover Map — State Elections\n\n" +
      "**Setup:** For every state, find the PI level at which a misaligned (+2/+2) candidate beats\n" +
      "an aligned (0/0, PI=10) candidate. PI range 25–100 (state cap).\n\n" +
      "**Question:** Which states are most susceptible to PI overriding ideological fit?\n",
  ];

  const piTestLevels = [25, 50, 75, 100];
  const crossoverRows: string[][] = [];
  const crossoverCounts: Record<number | string, number> = {};

  for (const stateId of Object.keys(STATE_DEMOGRAPHICS).sort()) {
    const demo = STATE_DEMOGRAPHICS[stateId];
    if (!demo) continue;

    let crossoverPI: number | null = null;
    for (const piB of piTestLevels) {
      try {
        const a = makeCandidate("a", "Aligned", 0, 0, 10, 70);
        const b = makeCandidate("b", "Misaligned", 2, 2, piB, 70);
        const r = runRace([a, b], stateId);
        if (r["b"] > r["a"] && crossoverPI === null) {
          crossoverPI = piB;
          crossoverCounts[piB] = (crossoverCounts[piB] ?? 0) + 1;
        }
      } catch {
        /* skip states with missing data */
      }
    }

    if (crossoverPI === null) crossoverCounts["never"] = (crossoverCounts["never"] ?? 0) + 1;
    crossoverRows.push([
      stateId,
      crossoverPI !== null ? String(crossoverPI) : "never",
      crossoverPI !== null && crossoverPI <= 50
        ? "⚠️ easy override"
        : crossoverPI !== null
          ? "moderate"
          : "✓ holds",
    ]);
  }

  lines.push(table(["State", "Crossover PI", "Risk"], crossoverRows));

  const easyOverride = crossoverRows.filter((r) => r[2].includes("⚠️")).length;
  if (easyOverride > 10)
    flag(
      15,
      "PI Crossover",
      `${easyOverride} states overridden by misaligned candidate at PI ≤ 50`
    );

  lines.push("\n### States per crossover PI level\n");
  const summaryRows = piTestLevels.map((n) => [String(n), String(crossoverCounts[n] ?? 0)]);
  summaryRows.push(["never", String(crossoverCounts["never"] ?? 0)]);
  lines.push(table(["Crossover PI", "# states"], summaryRows));

  return lines.join("\n");
}
