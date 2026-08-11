/**
 * Suites 16–19: Primary vs general consistency, formula balance, field, pipeline
 */

import {
  flag,
  table,
  pct,
  makeCandidate,
  runRace,
  normalizeNPI,
  calcPrimaryScore,
  REPRESENTATIVE_STATES,
} from "../helpers";

// ── Suite 16: Primary vs General Consistency ──────────────────────────────
export function suite16_primaryVsGeneral(): string {
  const lines: string[] = [
    "## Suite 16: Primary vs General Consistency\n\n" +
      "**Setup:** Party position = (0,0). Vary candidate misalignment.\n" +
      "Compare primary score (linear) vs general position score (quadratic).\n\n" +
      "**Question:** Does the primary formula reward the same alignment as the general?\n",
  ];

  const distances = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5];
  const rows: string[][] = [];

  for (const d of distances) {
    const primaryAlign = Math.max(0, 40 - (d + d) * 2.0);
    const primaryPct = (primaryAlign / 40) * 100;
    const posRaw = Math.max(0, 50 - d * 5 - d * 5);
    const posScore = Math.pow(posRaw, 2) / 100;
    const generalPct = (posScore / 25) * 100;
    const diff = primaryPct - generalPct;
    rows.push([
      d.toFixed(1),
      primaryAlign.toFixed(1),
      pct(primaryPct),
      posScore.toFixed(2),
      pct(generalPct),
      (diff > 0 ? "+" : "") + diff.toFixed(1) + "pp",
      Math.abs(diff) > 30 ? "⚠️" : "",
    ]);
    if (d === 2 && Math.abs(diff) > 30)
      flag(
        16,
        "Primary/General Gap",
        `At distance 2, primary awards ${primaryPct.toFixed(0)}% vs general ${generalPct.toFixed(0)}% — ${diff.toFixed(1)}pp gap`
      );
  }
  lines.push(
    table(["Dist", "Primary align", "Primary %", "Gen posScore", "Gen %", "Diff", "Flag"], rows)
  );
  lines.push(
    "\n**Key issue:** If primary penalizes misalignment far less than the general, candidates can win primaries and then be structurally weak in the general."
  );

  return lines.join("\n");
}

// ── Suite 17: Primary 60/40 Balance ───────────────────────────────────────
export function suite17_primary6040(): string {
  const lines: string[] = [
    "## Suite 17: Primary 60/40 Balance\n\n" +
      "**Design target:** 60% stats (influence + favorability), 40% position.\n" +
      "**Old formula (50/50):** alignment 0–50, fav 0–30, influence 0–20\n" +
      "**Current formula (40/60):** alignment 0–40, fav 0–35, influence 0–25\n",
  ];

  // Old 50/50 for comparison
  const oldPrimary = (e: number, s: number, pe: number, ps: number, fav: number, pi: number) => {
    const alignment = Math.max(0, 50 - (Math.abs(e - pe) + Math.abs(s - ps)) * 5);
    return Math.round((alignment + (fav / 100) * 30 + normalizeNPI(pi) * 20) * 10) / 10;
  };

  const partyE = 0,
    partyS = 0;
  const profiles: Array<[string, number, number, number, number]> = [
    // [label, econ, social, pi, fav]
    ["Perfect align, starter stats", 0, 0, 10, 50],
    ["Good align, moderate stats", -1, -1, 50, 60],
    ["Moderate misalign, good stats", -2, -2, 100, 70],
    ["Poor align, high stats", -3, -3, 100, 85],
    ["Bad align, max stats", -4, -4, 100, 95],
  ];

  const rows: string[][] = [];
  for (const [label, e, s, pi, fav] of profiles) {
    const old = oldPrimary(e, s, partyE, partyS, fav, pi);
    const current = calcPrimaryScore(e, s, partyE, partyS, fav, pi);
    const shift = current - old;
    rows.push([label, String(old), String(current), (shift >= 0 ? "+" : "") + shift.toFixed(1)]);
  }
  lines.push(table(["Profile", "Old (50/50)", "Current (40/60)", "Shift"], rows));

  // Head-to-head
  lines.push("\n### Head-to-head: perfect-align-starter vs moderate-misalign-high-stats\n");
  const [, e1, s1, n1, f1] = profiles[0];
  const [, e2, s2, n2, f2] = profiles[2];
  const a_old = oldPrimary(e1, s1, partyE, partyS, f1, n1);
  const b_old = oldPrimary(e2, s2, partyE, partyS, f2, n2);
  const a_curr = calcPrimaryScore(e1, s1, partyE, partyS, f1, n1);
  const b_curr = calcPrimaryScore(e2, s2, partyE, partyS, f2, n2);
  lines.push(
    table(
      ["Formula", "Aligned (starter)", "Misaligned (high stats)", "Winner"],
      [
        ["Old 50/50", String(a_old), String(b_old), a_old > b_old ? "Aligned ✓" : "Misaligned ⚠️"],
        [
          "Current 40/60",
          String(a_curr),
          String(b_curr),
          a_curr > b_curr ? "Aligned ✓" : "Misaligned ⚠️",
        ],
      ]
    )
  );
  if (b_curr > a_curr)
    flag(
      17,
      "Primary 60/40",
      `Even with 40/60 rebalance, misaligned high-stats beats aligned starter (${b_curr} vs ${a_curr})`
    );

  // Edge case: what alignment score is needed to beat a capped-PI high-fav candidate?
  lines.push("\n### Edge case: minimum alignment to beat PI=100, fav=90 candidate\n");
  const strongOpponent = calcPrimaryScore(-5, -5, partyE, partyS, 90, 100); // maximally misaligned but high stats
  lines.push(`Maximally misaligned (−5/−5) with PI=100, fav=90: score = **${strongOpponent}**`);
  for (const d of [0, 1, 2, 3]) {
    const aligned = calcPrimaryScore(-d, -d, partyE, partyS, 60, 50);
    lines.push(
      `Aligned candidate at d=${d}, PI=50, fav=60: score = **${aligned}** ${aligned > strongOpponent ? "✓ wins" : "✗ loses"}`
    );
  }

  return lines.join("\n");
}

// ── Suite 18: Primary Multi-candidate Field ───────────────────────────────
export function suite18_primaryField(): string {
  const lines: string[] = [
    "## Suite 18: Primary Multi-candidate Field\n\n" +
      "**Setup:** 5-candidate Democrat primary (party pos: −1/−2). Varied archetypes.\n\n" +
      "**Question:** Does the ranking match design intent? Celebrity should not win on stats alone.\n",
  ];

  const partyE = -1,
    partyS = -2;
  const candidates: Array<[string, number, number, number, number]> = [
    // [label, econ, social, pi, fav]  (PI capped at 100 for state primaries)
    ["True Believer (aligned, starter PI)", -1, -2, 8, 55],
    ["Party Centrist (slightly off)", -0.5, -1.5, 40, 62],
    ["Popular Moderate (drifted, known)", 0, -1, 80, 72],
    ["Local Celebrity (misaligned, max PI)", -3, 0, 100, 78],
    ["Dark Horse (perfect align, low PI)", -1, -2, 15, 58],
  ];

  const rows: string[][] = [];
  const scores: Array<[string, number]> = [];
  for (const [label, e, s, pi, fav] of candidates) {
    const score = calcPrimaryScore(e, s, partyE, partyS, fav, pi);
    const align = Math.max(0, 40 - (Math.abs(e - partyE) + Math.abs(s - partyS)) * 2.0);
    scores.push([label, score]);
    rows.push([label, `${e}/${s}`, String(pi), String(fav), align.toFixed(1), String(score)]);
  }
  scores.sort((a, b) => b[1] - a[1]);

  lines.push(table(["Candidate", "Pos", "PI", "Fav", "Alignment (0-40)", "Primary score"], rows));
  lines.push("\n**Ranked results:**\n");
  scores.forEach(([label, score], i) => lines.push(`${i + 1}. ${label} — ${score}`));

  const winner = scores[0][0];
  if (winner === "Local Celebrity (misaligned, max PI)")
    flag(18, "Primary Field", "Local celebrity (misaligned, PI=100) wins primary purely on stats");

  // Edge case: two perfectly aligned candidates, different PI
  lines.push("\n### Edge case: two perfectly aligned candidates — PI=10 vs PI=100\n");
  const low = calcPrimaryScore(-1, -2, partyE, partyS, 55, 10);
  const high = calcPrimaryScore(-1, -2, partyE, partyS, 55, 100);
  lines.push(`PI=10, fav=55, aligned: score = **${low}**`);
  lines.push(
    `PI=100, fav=55, aligned: score = **${high}** (advantage: +${(high - low).toFixed(1)})`
  );
  if (high - low > 20)
    flag(
      18,
      "Primary Field",
      `PI=100 vs PI=10 with same alignment/fav gives ${(high - low).toFixed(1)}pt advantage — PI still dominant in primary`
    );

  return lines.join("\n");
}

// ── Suite 19: Primary → General Pipeline ──────────────────────────────────
export function suite19_primaryToGeneral(): string {
  const lines: string[] = [
    "## Suite 19: Primary → General Pipeline\n\n" +
      "**Setup:** Simulate a Democrat primary (party −1/−2). Take the winner. Run general vs aligned Republican.\n\n" +
      "**Question:** Does the primary produce a viable general election candidate?\n",
  ];

  const partyE = -1,
    partyS = -2;
  const primaryCandidates: Array<[string, number, number, number, number]> = [
    ["Purist (aligned)", -1, -2, 20, 55],
    ["Moderate (slight drift)", 0, -1, 60, 65],
    ["Populist (stats-heavy)", -2, 0, 100, 75],
    ["Celebrity (misaligned, max)", -3, 1, 100, 80],
  ];

  lines.push("### Democrat Primary (party −1 econ / −2 social)\n");
  const primaryRows = primaryCandidates.map(([label, e, s, pi, fav]) => {
    const score = calcPrimaryScore(e, s, partyE, partyS, fav, pi);
    return [label, `${e}/${s}`, String(pi), String(fav), String(score)];
  });
  lines.push(table(["Candidate", "Position", "PI", "Fav", "Primary score"], primaryRows));

  const winner = primaryCandidates.reduce((best, c) =>
    calcPrimaryScore(c[1], c[2], partyE, partyS, c[4], c[3]) >
    calcPrimaryScore(best[1], best[2], partyE, partyS, best[4], best[3])
      ? c
      : best
  );
  lines.push(
    `\n**Primary winner: ${winner[0]}** (pos: ${winner[1]}/${winner[2]}, PI: ${winner[3]}, fav: ${winner[4]})\n`
  );

  // General: winner vs aligned Republican
  const [wLabel, wE, wS, wN, wF] = winner;
  const dem = makeCandidate("dem", wLabel, wE, wS, wN, wF, "democrat");
  const rep = makeCandidate("rep", "Rep (aligned +2/+2, PI=75)", 2, 2, 75, 65, "republican");

  lines.push("### General Election: Primary winner vs well-aligned Republican\n");
  const generalRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const r = runRace([dem, rep], stateId);
    generalRows.push([
      `${label} (${stateId})`,
      pct(r["dem"]),
      pct(r["rep"]),
      r["dem"] > 50 ? "DEM ✓" : "REP",
    ]);
  }
  lines.push(table(["State", "Dem (primary winner)", "Rep (aligned)", "Outcome"], generalRows));

  // Counterfactual: all primary candidates in the general
  lines.push("\n### Counterfactual: general performance for each primary candidate\n");
  const cfRows: string[][] = [];
  for (const [label, e, s, pi, fav] of primaryCandidates) {
    const d = makeCandidate("dem", label, e, s, pi, fav, "democrat");
    const r = makeCandidate("rep", "Rep", 2, 2, 75, 65, "republican");
    const pa = runRace([d, r], "PA");
    const mi = runRace([d, r], "MI");
    cfRows.push([
      label,
      pct(pa["dem"]),
      pct(mi["dem"]),
      pa["dem"] > 50 && mi["dem"] > 50 ? "Competitive ✓" : "Underperforms",
    ]);
  }
  lines.push(table(["Candidate", "PA share", "MI share", "Viability"], cfRows));
  lines.push(
    "\n**Expected:** The primary winner should be competitive in PA and MI. If the formula-winner is the weakest general candidate, the primary is misaligned with electability."
  );

  return lines.join("\n");
}
