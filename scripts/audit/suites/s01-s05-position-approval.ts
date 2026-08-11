/**
 * Suites 1–5: Position alignment, PI dominance, approval
 *
 * All state-election suites. Political Influence (PI) is capped at 100.
 */

import {
  flag,
  table,
  pct,
  makeCandidate,
  runRace,
  normalizeNPI,
  approvalScalar,
  PI_LEVELS,
  REPRESENTATIVE_STATES,
} from "../helpers";

// ── Suite 1: PI Dominance ──────────────────────────────────────────────────
// State elections only. PI capped at 100.
export function suite1_piDominance(): string {
  const lines: string[] = [
    "## Suite 1: Political Influence (PI) Dominance — State Elections\n\n" +
      "**Setup:** Two candidates, identical position (0,0) and approval (70). Only PI varies.\n" +
      "PI is capped at 100 in state elections. Max reach = normalizePI(100) = 1.0.\n\n" +
      "**Question:** How much does PI alone shift vote share when positions are equal?\n",
  ];

  // 1a. normalizeNPI reference across the full state PI range
  lines.push("### normalizePI reference (state range 0–100)\n");
  lines.push(
    table(
      ["PI", "normalizePI(PI)", "reach multiplier"],
      PI_LEVELS.map((n) => [
        String(n),
        normalizeNPI(n).toFixed(4),
        `×${normalizeNPI(n).toFixed(2)}`,
      ])
    )
  );
  lines.push("\n_At PI=100 (max), reach = 1.0 — every turned-out voter is reached._");

  // 1b. Pairwise head-to-head in PA
  lines.push("\n### Pairwise head-to-head in PA (purple baseline)\n");
  const paRows: string[][] = [];
  for (const piA of PI_LEVELS) {
    for (const piB of PI_LEVELS) {
      if (piA >= piB) continue;
      const a = makeCandidate("a", "A", 0, 0, piA, 70);
      const b = makeCandidate("b", "B", 0, 0, piB, 70);
      const r = runRace([a, b], "PA");
      const adv = r["b"] - r["a"];
      paRows.push([String(piA), String(piB), pct(r["a"]), pct(r["b"]), pct(adv)]);
      if (adv > 20)
        flag(
          1,
          "PI Dominance",
          `PI ${piA} vs ${piB} — ${adv.toFixed(1)}pp gap in PA when positions equal`
        );
    }
  }
  lines.push(table(["PI A", "PI B", "A share", "B share", "B advantage"], paRows));

  // 1c. Cross-state: PI 10 vs PI 100
  lines.push(
    "\n### Cross-state: PI 10 (starter) vs PI 100 (max), same position (0,0), approval 70\n"
  );
  const crossRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const a = makeCandidate("a", "PI=10 (starter)", 0, 0, 10, 70);
    const b = makeCandidate("b", "PI=100 (max)", 0, 0, 100, 70);
    const r = runRace([a, b], stateId);
    const adv = r["b"] - r["a"];
    crossRows.push([`${label} (${stateId})`, pct(r["a"]), pct(r["b"]), pct(adv)]);
    if (adv > 20)
      flag(
        1,
        "PI Dominance",
        `PI=100 wins by ${adv.toFixed(1)}pp in ${stateId} over equal-position PI=10 opponent`
      );
  }
  lines.push(table(["State", "PI=10 share", "PI=100 share", "PI-100 advantage"], crossRows));

  // 1d. Edge case: both at max PI (100) — should be 50/50
  lines.push("\n### Edge case: both candidates PI=100, equal positions — should split 50/50\n");
  const eqRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const a = makeCandidate("a", "A", 0, 0, 100, 70);
    const b = makeCandidate("b", "B", 0, 0, 100, 70);
    const r = runRace([a, b], stateId);
    const dev = Math.abs(r["a"] - 50);
    eqRows.push([
      `${label} (${stateId})`,
      pct(r["a"]),
      pct(r["b"]),
      dev < 1 ? "✓ even" : `⚠️ skewed (${dev.toFixed(1)}pp off)`,
    ]);
    if (dev > 2)
      flag(
        1,
        "PI Dominance",
        `${stateId}: identical candidates don't split 50/50 (${r["a"].toFixed(1)}% vs ${r["b"].toFixed(1)}%)`
      );
  }
  lines.push(table(["State", "A share", "B share", "Split quality"], eqRows));

  return lines.join("\n");
}

// ── Suite 2: Position vs PI Tradeoff ──────────────────────────────────────
export function suite2_positionVsPI(): string {
  const lines: string[] = [
    "## Suite 2: Position vs PI Tradeoff — State Elections\n\n" +
      "**Setup:** Candidate A = center-aligned (0,0), PI=10. Candidate B = misaligned (+2/+2), PI varies.\n" +
      "PI range 10–100 (state cap).\n\n" +
      "**Question:** At what PI does misalignment stop mattering in a state race?\n",
  ];

  const piLevels = [10, 25, 50, 75, 100];

  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    lines.push(`\n### ${label} (${stateId})\n`);
    const rows: string[][] = [];
    let crossover: number | null = null;

    for (const piB of piLevels) {
      const a = makeCandidate("a", "Aligned PI=10", 0, 0, 10, 70);
      const b = makeCandidate("b", `Misaligned (+2/+2) PI=${piB}`, 2, 2, piB, 70);
      const r = runRace([a, b], stateId);
      const winner = r["b"] > r["a"] ? "B ⚠️" : "A ✓";
      if (r["b"] > r["a"] && crossover === null) crossover = piB;
      rows.push([String(piB), pct(r["a"]), pct(r["b"]), winner]);
    }

    lines.push(table(["B PI", "A (aligned)", "B (misaligned +2/+2)", "Winner"], rows));
    if (crossover !== null) {
      lines.push(
        `\n**Crossover PI in ${stateId}: ${crossover}** — misalignment overridden at this PI`
      );
      if (crossover < 75)
        flag(
          2,
          "Position vs PI",
          `${label} (${stateId}) — misaligned candidate wins at PI=${crossover}. Ideological fit overridden too easily.`
        );
    } else {
      lines.push(`\n✓ Aligned candidate holds lead at all PI levels (up to 100) in ${stateId}`);
    }
  }

  // Additional: vary misalignment distance at fixed PI=100 (max) in PA
  lines.push("\n### Misalignment distance vs PI=100 (max) in PA\n");
  lines.push("Candidate A always PI=10, aligned. Candidate B PI=100, misalignment varies.\n");
  const distRows: string[][] = [];
  for (let dist = 0; dist <= 5; dist++) {
    const a = makeCandidate("a", "A", 0, 0, 10, 70);
    const b = makeCandidate("b", `B (+${dist}/+${dist})`, dist, dist, 100, 70);
    const r = runRace([a, b], "PA");
    distRows.push([
      String(dist),
      pct(r["a"]),
      pct(r["b"]),
      r["b"] > r["a"] ? "B wins ⚠️" : "A wins ✓",
    ]);
    if (dist >= 3 && r["b"] > r["a"])
      flag(
        2,
        "Position vs PI",
        `PA: misaligned by ${dist} units with PI=100 still beats aligned PI=10`
      );
  }
  lines.push(table(["Misalignment (each axis)", "A share", "B share", "Winner"], distRows));

  return lines.join("\n");
}

// ── Suite 3: Position Score Curve ─────────────────────────────────────────
export function suite3_positionCurve(): string {
  const lines: string[] = [
    "## Suite 3: Position Score Curve\n\n" +
      "**Setup:** Pure position score — no PI, no approval. Maps the quadratic penalty.\n\n" +
      "**Question:** Is the quadratic penalty proportionate?\n",
  ];

  lines.push("### Single-axis misalignment (econ varies, social perfect)\n");
  const singleRows: string[][] = [];
  for (let econDiff = 0; econDiff <= 5; econDiff += 0.5) {
    const posRaw = Math.max(0, 50 - econDiff * 5);
    const posScore = Math.pow(posRaw, 2) / 100;
    singleRows.push([
      econDiff.toFixed(1),
      posRaw.toFixed(0),
      posScore.toFixed(2),
      pct((posScore / 25) * 100),
    ]);
  }
  lines.push(table(["Econ diff", "positionRaw", "positionScore", "% of max (25)"], singleRows));

  lines.push("\n### Both axes misaligned equally\n");
  const dualRows: string[][] = [];
  for (let d = 0; d <= 5; d += 0.5) {
    const posRaw = Math.max(0, 50 - d * 5 - d * 5);
    const posScore = Math.pow(posRaw, 2) / 100;
    const pctOfMax = (posScore / 25) * 100;
    dualRows.push([
      d.toFixed(1),
      posRaw.toFixed(0),
      posScore.toFixed(2),
      pct(pctOfMax),
      pct(100 - pctOfMax),
    ]);
    if (d === 1 && 100 - pctOfMax > 40)
      flag(
        3,
        "Position Curve",
        `1 unit off each axis reduces position score by ${(100 - pctOfMax).toFixed(1)}% — quadratic cliff may be too steep`
      );
  }
  lines.push(
    table(["Diff (each axis)", "positionRaw", "positionScore", "% of max", "Penalty %"], dualRows)
  );

  lines.push("\n### Position score grid (econ diff × social diff)\n");
  const gridHeader = ["econ\\social", "0", "1", "2", "3", "4", "5"];
  const gridRows: string[][] = [];
  for (let e = 0; e <= 5; e++) {
    const row = [String(e)];
    for (let s = 0; s <= 5; s++) {
      row.push((Math.pow(Math.max(0, 50 - e * 5 - s * 5), 2) / 100).toFixed(1));
    }
    gridRows.push(row);
  }
  lines.push(table(gridHeader, gridRows));

  return lines.join("\n");
}

// ── Suite 4: Economic vs Social Axis Symmetry ─────────────────────────────
export function suite4_axisSym(): string {
  const lines: string[] = [
    "## Suite 4: Economic vs Social Axis Symmetry\n\n" +
      "**Setup:** Candidate B misaligned by 2 units on one or both axes. Candidate A aligned (0,0).\n" +
      "PI levels: 10 (starter), 50 (mid), 100 (max).\n\n" +
      "**Question:** Are both axes penalized equally?\n",
  ];

  lines.push("### PA — misalignment of 2 units, econ-only vs social-only vs both\n");
  const rows: string[][] = [];

  for (const pi of [10, 50, 100]) {
    const a = makeCandidate("a", "A (aligned)", 0, 0, pi, 70);
    const rEcon = runRace([a, makeCandidate("bE", "B(econ+2)", 2, 0, pi, 70)], "PA");
    const rSocial = runRace([a, makeCandidate("bS", "B(social+2)", 0, 2, pi, 70)], "PA");
    const rBoth = runRace([a, makeCandidate("bB", "B(both+2)", 2, 2, pi, 70)], "PA");
    rows.push([`PI=${pi}`, pct(rEcon["a"]), pct(rSocial["a"]), pct(rBoth["a"])]);
    if (Math.abs(rEcon["a"] - rSocial["a"]) > 3)
      flag(
        4,
        "Axis Symmetry",
        `PI=${pi} — econ mismatch gives A ${pct(rEcon["a"])} vs social mismatch ${pct(rSocial["a"])} — axes not symmetric`
      );
  }
  lines.push(table(["PI (both)", "A% vs econ-only", "A% vs social-only", "A% vs both"], rows));
  lines.push(
    "\n**Expected:** Econ-only and social-only rows should be identical. If not, a bug exists in the formula."
  );

  lines.push("\n### Raw position scores (formula verification)\n");
  const posRows = [
    ["Econ+2, social 0", Math.pow(Math.max(0, 50 - 10 - 0), 2) / 100],
    ["Econ 0, social+2", Math.pow(Math.max(0, 50 - 0 - 10), 2) / 100],
    ["Both+2", Math.pow(Math.max(0, 50 - 10 - 10), 2) / 100],
  ].map(([label, score]) => [label as string, (score as number).toFixed(2)]);
  lines.push(table(["Mismatch type", "positionScore"], posRows));

  return lines.join("\n");
}

// ── Suite 5: Approval Scalar Range ────────────────────────────────────────
export function suite5_approvalScalar(): string {
  const lines: string[] = [
    "## Suite 5: Approval Scalar Range\n\n" +
      "**Setup:** Two candidates, identical position (0,0). A's approval varies. B fixed at fav=50.\n\n" +
      "**Question:** Is approval a meaningful differentiator? Does it matter enough?\n",
  ];

  const favLevels = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  lines.push("### approvalScalar values\n");
  lines.push(
    table(
      ["Favorability", "Scalar (fav/100)", "vs default-50 (×ratio)"],
      favLevels.map((f) => [
        String(f),
        approvalScalar(f).toFixed(3),
        (approvalScalar(f) / approvalScalar(50)).toFixed(3) + "×",
      ])
    )
  );

  // Head-to-head vs fav=50 at PI=100 (max state), PA
  lines.push("\n### Head-to-head: A (varying fav) vs B (fav=50), PI=100, PA\n");
  const h2hRows: string[][] = [];
  for (const fav of favLevels) {
    const a = makeCandidate("a", `A fav=${fav}`, 0, 0, 100, fav);
    const b = makeCandidate("b", "B fav=50", 0, 0, 100, 50);
    const r = runRace([a, b], "PA");
    h2hRows.push([String(fav), pct(r["a"]), pct(r["b"])]);
  }
  lines.push(table(["A favorability", "A share", "B share"], h2hRows));

  // Approval × PI interaction — does PI dilute approval's impact?
  lines.push("\n### Approval × PI interaction: A fav=20 vs B fav=80, PI varies (0–100)\n");
  const intRows: string[][] = [];
  for (const pi of PI_LEVELS) {
    const a = makeCandidate("a", `A fav=20 PI=${pi}`, 0, 0, pi, 20);
    const b = makeCandidate("b", `B fav=80 PI=${pi}`, 0, 0, pi, 80);
    const r = runRace([a, b], "PA");
    intRows.push([String(pi), pct(r["a"]), pct(r["b"]), pct(r["b"] - r["a"])]);
  }
  lines.push(table(["PI (both)", "A (fav=20)", "B (fav=80)", "B advantage"], intRows));
  lines.push(
    "\n**Expected:** B's approval advantage should be consistent across PI levels — PI should not neutralize favorability."
  );

  // Edge case: fav=100 vs fav=50 — minimum expected advantage
  const topR = runRace(
    [makeCandidate("a", "fav=100", 0, 0, 100, 100), makeCandidate("b", "fav=50", 0, 0, 100, 50)],
    "PA"
  );
  const uplift = topR["a"] - 50;
  if (uplift < 15)
    flag(
      5,
      "Approval Scalar",
      `100% approval only gives +${uplift.toFixed(1)}pp over fav=50 — approval range too narrow`
    );

  // Edge case: fav=0 — should get near-zero votes
  const zeroR = runRace(
    [makeCandidate("a", "fav=0", 0, 0, 100, 0), makeCandidate("b", "fav=70", 0, 0, 100, 70)],
    "PA"
  );
  if (zeroR["a"] > 10)
    flag(
      5,
      "Approval Scalar",
      `fav=0 candidate still gets ${zeroR["a"].toFixed(1)}% — zero-approval floor too permissive`
    );
  lines.push(
    `\n**Edge case:** fav=0 vs fav=70 in PA — fav=0 gets ${pct(zeroR["a"])}, fav=70 gets ${pct(zeroR["b"])}`
  );

  return lines.join("\n");
}
