/**
 * Suites 20–24: Presidential election tests
 *
 * Uses nationalInfluence (NPI) — uncapped, drives reach AND appeal.
 * Presidential party org uses the steep 0.05–1.0 curve.
 */

import {
  flag,
  table,
  pct,
  makeCandidate,
  makePresidentialCandidate,
  runRace,
  runPresidentialRace,
  normalizeNPI,
  partyOrgScalar,
  calcPresidentPrimaryScore,
  NPI_LEVELS,
  REPRESENTATIVE_STATES,
} from "../helpers";

// ── Suite 20: Presidential NPI Dominance ──────────────────────────────────
export function suite20_presNPIDominance(): string {
  const lines: string[] = [
    "## Suite 20: Presidential NPI (National Political Influence) Dominance\n\n" +
      "**Setup:** Two candidates, identical position (0,0) and approval (70). Only NPI varies.\n" +
      "NPI = nationalInfluence, uncapped. Includes influence in appeal (presidential rule).\n\n" +
      "**Question:** How dominant is NPI in a presidential race? Is a 40pp gap from reach+appeal combined expected?\n",
  ];

  // 20a. normalizeNPI reference — full presidential range
  lines.push("### normalizeNPI reference (presidential range 0–1000)\n");
  lines.push(
    table(
      ["NPI", "normalizeNPI", "reach ×", "as appeal bonus (+pts out of 25)"],
      NPI_LEVELS.map((n) => [
        String(n),
        normalizeNPI(n).toFixed(4),
        `×${normalizeNPI(n).toFixed(2)}`,
        (normalizeNPI(n) * 25).toFixed(1),
      ])
    )
  );
  lines.push(
    "\n_NPI adds to both reach (multiplicative) AND appeal (+0–25pts). This compounds at the top end._"
  );

  // 20b. Pairwise head-to-head in PA
  lines.push("\n### Pairwise head-to-head in PA (purple baseline)\n");
  const paRows: string[][] = [];
  for (const npiA of NPI_LEVELS) {
    for (const npiB of NPI_LEVELS) {
      if (npiA >= npiB) continue;
      const a = makePresidentialCandidate("a", "A", 0, 0, npiA, 70);
      const b = makePresidentialCandidate("b", "B", 0, 0, npiB, 70);
      const r = runPresidentialRace([a, b], "PA");
      const adv = r["b"] - r["a"];
      paRows.push([String(npiA), String(npiB), pct(r["a"]), pct(r["b"]), pct(adv)]);
      if (adv > 30)
        flag(
          20,
          "Presidential NPI",
          `NPI ${npiA} vs ${npiB} — ${adv.toFixed(1)}pp gap in PA (presidential) when positions equal`
        );
    }
  }
  lines.push(table(["NPI A", "NPI B", "A share", "B share", "B advantage"], paRows));

  // 20c. Cross-state: NPI 50 vs NPI 500
  lines.push(
    "\n### Cross-state: NPI 50 (regional figure) vs NPI 500 (national star), same position, approval 70\n"
  );
  const crossRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const a = makePresidentialCandidate("a", "NPI=50", 0, 0, 50, 70);
    const b = makePresidentialCandidate("b", "NPI=500", 0, 0, 500, 70);
    const r = runPresidentialRace([a, b], stateId);
    const adv = r["b"] - r["a"];
    crossRows.push([`${label} (${stateId})`, pct(r["a"]), pct(r["b"]), pct(adv)]);
    if (adv > 40)
      flag(
        20,
        "Presidential NPI",
        `NPI=500 wins by ${adv.toFixed(1)}pp in ${stateId} over NPI=50 (presidential)`
      );
  }
  lines.push(table(["State", "NPI=50 share", "NPI=500 share", "NPI-500 advantage"], crossRows));

  // 20d. NPI 10 vs NPI 1000 — extreme case (unknown vs mega-celebrity)
  lines.push("\n### Extreme case: NPI=10 vs NPI=1000 (same position, approval 70) in PA\n");
  const a = makePresidentialCandidate("a", "NPI=10", 0, 0, 10, 70);
  const b = makePresidentialCandidate("b", "NPI=1000", 0, 0, 1000, 70);
  const r = runPresidentialRace([a, b], "PA");
  lines.push(`NPI=10: ${pct(r["a"])} — NPI=1000: ${pct(r["b"])}`);

  return lines.join("\n");
}

// ── Suite 21: Presidential Position vs NPI Crossover ──────────────────────
export function suite21_presPositionVsNPI(): string {
  const lines: string[] = [
    "## Suite 21: Presidential Position vs NPI Crossover\n\n" +
      "**Setup:** Candidate A = center-aligned (0,0), NPI=50. Candidate B = misaligned (+2/+2), NPI varies.\n\n" +
      "**Question:** At what NPI does a misaligned presidential candidate override an aligned opponent?\n" +
      "Compared to state crossover (Suite 2) — presidential should allow higher crossover because national\n" +
      "recognition is a legitimate advantage.\n",
  ];

  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    lines.push(`\n### ${label} (${stateId})\n`);
    const rows: string[][] = [];
    let crossover: number | null = null;

    for (const npiB of NPI_LEVELS) {
      const a = makePresidentialCandidate("a", "Aligned NPI=50", 0, 0, 50, 70);
      const b = makePresidentialCandidate("b", `Misaligned NPI=${npiB}`, 2, 2, npiB, 70);
      const r = runPresidentialRace([a, b], stateId);
      const winner = r["b"] > r["a"] ? "B ⚠️" : "A ✓";
      if (r["b"] > r["a"] && crossover === null) crossover = npiB;
      rows.push([String(npiB), pct(r["a"]), pct(r["b"]), winner]);
    }

    lines.push(table(["B NPI", "A (aligned)", "B (misaligned +2/+2)", "Winner"], rows));
    if (crossover !== null) {
      lines.push(`\n**Crossover NPI in ${stateId}: ${crossover}**`);
      // For presidential, crossover at 200+ is reasonable — major national figure
      if (crossover < 200)
        flag(
          21,
          "Presidential Crossover",
          `${label} (${stateId}) — presidential misalignment overridden at NPI=${crossover}. Below 200 may be too easy.`
        );
    } else {
      lines.push(`\n✓ Aligned holds lead through NPI=1000 in ${stateId}`);
    }
  }

  // Vary misalignment at fixed NPI=500 in PA
  lines.push("\n### How much misalignment can NPI=500 overcome in PA? (vs aligned NPI=50)\n");
  const distRows: string[][] = [];
  for (let dist = 0; dist <= 5; dist++) {
    const a = makePresidentialCandidate("a", "Aligned NPI=50", 0, 0, 50, 70);
    const b = makePresidentialCandidate("b", `Misaligned NPI=500`, dist, dist, 500, 70);
    const r = runPresidentialRace([a, b], "PA");
    distRows.push([
      String(dist),
      pct(r["a"]),
      pct(r["b"]),
      r["b"] > r["a"] ? "B wins" : "A wins ✓",
    ]);
  }
  lines.push(
    table(["Misalignment (each axis)", "A (aligned NPI=50)", "B (NPI=500)", "Winner"], distRows)
  );

  return lines.join("\n");
}

// ── Suite 22: Presidential Party Org ──────────────────────────────────────
export function suite22_presPartyOrg(): string {
  const lines: string[] = [
    "## Suite 22: Presidential Party Org Curve\n\n" +
      "Presidential uses a steep 0.05–1.0× curve vs state's 0.5–1.0×.\n\n" +
      "**Question:** How devastating is weak party org in a presidential race?\n",
  ];

  const orgLevels = [0, 10, 25, 50, 75, 100];
  const presScalar = (org: number) => 0.05 + (Math.min(100, Math.max(0, org)) / 100) * 0.95;

  // Curve comparison
  lines.push("### Scalar comparison: state (0.5–1.0) vs presidential (0.05–1.0)\n");
  lines.push(
    table(
      ["Org", "State scalar", "Presidential scalar", "Presidential penalty vs state"],
      orgLevels.map((o) => [
        String(o),
        partyOrgScalar(o).toFixed(3),
        presScalar(o).toFixed(3),
        ((partyOrgScalar(o) - presScalar(o)) * 100).toFixed(1) + "pp worse",
      ])
    )
  );

  // Head-to-head: strong-org dem vs weak-org rep
  lines.push("\n### Head-to-head: Dem org=80 vs Rep org=20. NPI=300 both, same positions. PA.\n");
  const orgMap = new Map([
    ["democrat", 80],
    ["republican", 20],
  ]);
  const dem = makePresidentialCandidate("dem", "Dem org=80", 0, 0, 300, 70, "democrat");
  const rep = makePresidentialCandidate("rep", "Rep org=20", 0, 0, 300, 70, "republican");
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const r = runPresidentialRace([dem, rep], stateId, orgMap);
    lines.push(`${label} (${stateId}): Dem ${pct(r["dem"])} — Rep ${pct(r["rep"])}`);
  }

  // Does high NPI compensate for low party org?
  lines.push(
    "\n### Does NPI compensate for weak party org? Dem NPI varies, org=10. Rep NPI=300, org=80. PA.\n"
  );
  const compRows: string[][] = [];
  const repBase = makePresidentialCandidate(
    "rep",
    "Rep NPI=300, org=80",
    0,
    0,
    300,
    70,
    "republican"
  );
  for (const npiDem of NPI_LEVELS) {
    const d = makePresidentialCandidate(
      "dem",
      `Dem NPI=${npiDem}, org=10`,
      0,
      0,
      npiDem,
      70,
      "democrat"
    );
    const orgMapComp = new Map([
      ["democrat", 10],
      ["republican", 80],
    ]);
    const r = runPresidentialRace([d, repBase], "PA", orgMapComp);
    compRows.push([
      String(npiDem),
      pct(r["dem"]),
      pct(r["rep"]),
      r["dem"] > r["rep"] ? "Dem compensates ⚠️" : "Rep wins ✓",
    ]);
    if (r["dem"] > r["rep"] && npiDem < 500)
      flag(
        22,
        "Presidential Org",
        `NPI=${npiDem} compensates for org=10 in presidential race — org may not matter enough`
      );
  }
  lines.push(table(["Dem NPI", "Dem (org=10)", "Rep (NPI=300, org=80)", "Result"], compRows));

  return lines.join("\n");
}

// ── Suite 23: Independent Candidate Handicap ──────────────────────────────
export function suite23_independentHandicap(): string {
  const lines: string[] = [
    "## Suite 23: Independent Candidate Handicap\n\n" +
      "**Setup:** partyOrgScalar(null) = 1.0 for independents (no party, no org penalty).\n" +
      "Partisan candidates at varying org levels.\n\n" +
      "**Question:** Do independents get an unfair structural advantage over weak-org parties?\n",
  ];

  const orgLevels = [0, 10, 25, 50, 75, 100];

  // State elections
  lines.push(
    "### State election: Independent vs Partisan at varying org levels (PI=100, fav=70, pos=0/0)\n"
  );
  const stateRows: string[][] = [];
  for (const org of orgLevels) {
    const orgMap = new Map([["republican", org]]);
    const ind = makeCandidate("ind", "Independent (org=null → 1.0×)", 0, 0, 100, 70, "independent");
    const rep = makeCandidate("rep", `Republican org=${org}`, 0, 0, 100, 70, "republican");
    const r = runRace([ind, rep], "PA", orgMap);
    stateRows.push([
      String(org),
      pct(r["ind"]),
      pct(r["rep"]),
      r["ind"] > r["rep"] ? "Ind wins" : "Rep wins",
    ]);
    if (r["ind"] > r["rep"] && org >= 50)
      flag(
        23,
        "Independent Handicap",
        `State: Independent beats partisan at org=${org} — org≥50 should beat unaffiliated`
      );
  }
  lines.push(table(["Partisan org", "Independent share", "Partisan share", "Winner"], stateRows));

  // Presidential election
  lines.push(
    "\n### Presidential: Independent vs Partisan at varying org levels (NPI=300, fav=70, pos=0/0)\n"
  );
  const presRows: string[][] = [];
  for (const org of orgLevels) {
    const orgMap = new Map([["republican", org]]);
    const ind = makePresidentialCandidate(
      "ind",
      "Independent (org=null → 1.0×)",
      0,
      0,
      300,
      70,
      "independent"
    );
    const rep = makePresidentialCandidate(
      "rep",
      `Republican org=${org}`,
      0,
      0,
      300,
      70,
      "republican"
    );
    const r = runPresidentialRace([ind, rep], "PA", orgMap);
    presRows.push([
      String(org),
      pct(r["ind"]),
      pct(r["rep"]),
      r["ind"] > r["rep"] ? "Ind wins" : "Rep wins",
    ]);
    if (r["ind"] > r["rep"] && org >= 50)
      flag(
        23,
        "Independent Handicap",
        `Presidential: Independent beats partisan at org=${org} — strong org party should beat unaffiliated`
      );
  }
  lines.push(table(["Partisan org", "Independent share", "Partisan share", "Winner"], presRows));
  lines.push(
    "\n**Expected:** Independent should lose to any party with org ≥ 50. If they win at org=75+, the null-org=1.0 shortcut is too generous."
  );

  return lines.join("\n");
}

// ── Suite 24: Presidential Primary Celebrity ──────────────────────────────
export function suite24_presidentPrimaryField(): string {
  const lines: string[] = [
    "## Suite 24: Presidential Primary Celebrity Test\n\n" +
      "**Setup:** 5-candidate Democrat presidential primary. Varied profiles.\n" +
      "Uses calcPresidentPrimaryScore (heavier org/NPI weighting than state primary).\n\n" +
      "**Question:** Does the presidential primary formula prevent a nationally-famous\n" +
      "but ideologically misaligned candidate from winning?\n",
  ];

  const partyE = -1,
    partyS = -2;
  const candidates: Array<[string, number, number, number, number, number]> = [
    // [label, econ, social, npi, fav, homeStateOrg]
    ["True Believer (aligned, low NPI)", -1, -2, 50, 55, 60],
    ["Party Veteran (slightly off, known)", -0.5, -1.5, 200, 65, 75],
    ["Popular Moderate (drifted, known)", 0, -1, 300, 72, 55],
    ["National Celebrity (misaligned)", -3, 1, 800, 80, 30],
    ["Grassroots Hero (perfect align)", -1, -2, 100, 60, 65],
  ];

  const rows: string[][] = [];
  const scores: Array<[string, number]> = [];
  for (const [label, e, s, npi, fav, org] of candidates) {
    const score = calcPresidentPrimaryScore(e, s, partyE, partyS, fav, npi, org);
    const align = Math.max(0, 40 - (Math.abs(e - partyE) + Math.abs(s - partyS)) * 2.0);
    scores.push([label, score]);
    rows.push([
      label,
      `${e}/${s}`,
      String(npi),
      String(fav),
      String(org),
      align.toFixed(1),
      String(score),
    ]);
  }
  scores.sort((a, b) => b[1] - a[1]);

  lines.push(
    table(["Candidate", "Pos", "NPI", "Fav", "HomeOrg", "Alignment (0-40)", "Primary score"], rows)
  );
  lines.push("\n**Ranked results:**\n");
  scores.forEach(([label, score], i) => lines.push(`${i + 1}. ${label} — ${score}`));

  const winner = scores[0][0];
  if (winner === "National Celebrity (misaligned)")
    flag(
      24,
      "Presidential Primary",
      "National Celebrity (misaligned, NPI=800) wins presidential primary — NPI too dominant"
    );

  // Edge case: what's the minimum NPI for a perfectly-aligned candidate to beat a celebrity?
  lines.push(
    "\n### Edge case: minimum NPI for an aligned candidate (fav=60, org=65) to beat the celebrity\n"
  );
  const celScore = calcPresidentPrimaryScore(-3, 1, partyE, partyS, 80, 800, 30);
  lines.push(`Celebrity score: **${celScore}**`);
  for (const testNPI of [50, 100, 200, 300, 400, 500]) {
    const aligned = calcPresidentPrimaryScore(-1, -2, partyE, partyS, 60, testNPI, 65);
    lines.push(
      `Aligned candidate NPI=${testNPI}: **${aligned}** ${aligned > celScore ? "✓ wins" : "✗ loses"}`
    );
    if (aligned > celScore) {
      break;
    }
  }

  return lines.join("\n");
}
