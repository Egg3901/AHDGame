/**
 * Suites 6–10: Approval under attack, party org, factor decomposition, vote splitting, field size
 *
 * All state-election suites. Political Influence (PI) capped at 100.
 */

import {
  flag,
  table,
  pct,
  makeCandidate,
  runRace,
  normalizeNPI,
  approvalScalar,
  partyOrgScalar,
  PI_LEVELS,
  REPRESENTATIVE_STATES,
} from "../helpers";

// ── Suite 6: Approval Under Attack ────────────────────────────────────────
export function suite6_approvalAttack(): string {
  const lines: string[] = [
    "## Suite 6: Approval Under Attack\n\n" +
      "**Setup:** Candidate A starts at fav=70, opponent B fixed at fav=60. A's approval is progressively reduced.\n\n" +
      "**Question:** How much does each 10-point drop cost? At what approval does A lose?\n",
  ];

  lines.push("### Approval erosion: A drops 10 per step vs B fav=60. PI=100 both. PA.\n");
  const erosionRows: string[][] = [];
  let flipPoint: number | null = null;
  for (let favA = 70; favA >= 0; favA -= 10) {
    const a = makeCandidate("a", `A fav=${favA}`, 0, 0, 100, favA);
    const b = makeCandidate("b", "B fav=60", 0, 0, 100, 60);
    const r = runRace([a, b], "PA");
    if (r["b"] > r["a"] && flipPoint === null) flipPoint = favA;
    erosionRows.push([
      String(favA),
      pct(r["a"]),
      pct(r["b"]),
      r["a"] > r["b"] ? "A leads" : "B leads ⚠️",
    ]);
  }
  lines.push(table(["A favorability", "A share", "B share", "Leader"], erosionRows));
  if (flipPoint !== null) {
    lines.push(`\n**Race flips at A fav = ${flipPoint}** (B fav=60)`);
    if (flipPoint > 50)
      flag(6, "Approval Attack", `Race flips when A drops to fav=${flipPoint} vs fav=60 opponent`);
  }

  // PI buffer test — can high PI compensate for low approval? (PI capped at 100)
  lines.push(
    "\n### PI buffer: A fav=30 vs B fav=70 (both PI=100). Does PI level matter when capped?\n"
  );
  lines.push(
    "_With PI capped at 100 for both, reach is equal — approval difference is the only lever._\n"
  );
  const bufR = runRace(
    [
      makeCandidate("a", "A fav=30 PI=100", 0, 0, 100, 30),
      makeCandidate("b", "B fav=70 PI=100", 0, 0, 100, 70),
    ],
    "PA"
  );
  lines.push(`A (fav=30): ${pct(bufR["a"])} — B (fav=70): ${pct(bufR["b"])}`);
  lines.push(
    "\n**Expected:** B wins cleanly. If A is competitive at half B's approval with equal PI, approval has too little weight."
  );
  if (bufR["a"] > 40)
    flag(
      6,
      "Approval Attack",
      `fav=30 candidate gets ${bufR["a"].toFixed(1)}% against fav=70 with equal PI — approval is too weak`
    );

  // Edge case: fav=10 vs fav=60, varying PI
  lines.push("\n### Edge case: A fav=10 vs B fav=60, PI varies\n");
  const edgeRows: string[][] = [];
  for (const pi of PI_LEVELS) {
    const a = makeCandidate("a", `A fav=10 PI=${pi}`, 0, 0, pi, 10);
    const b = makeCandidate("b", `B fav=60 PI=${pi}`, 0, 0, pi, 60);
    const r = runRace([a, b], "PA");
    edgeRows.push([String(pi), pct(r["a"]), pct(r["b"])]);
  }
  lines.push(table(["PI (both)", "A (fav=10)", "B (fav=60)"], edgeRows));

  return lines.join("\n");
}

// ── Suite 7: Party Org Impact ─────────────────────────────────────────────
export function suite7_partyOrg(): string {
  const lines: string[] = [
    "## Suite 7: Party Org Impact\n\n" +
      "**Setup:** Two candidates (pos 0/0, PI=100, fav=70). Party org varies.\n\n" +
      "**Question:** Does the 0.5–1.0× org scalar create meaningful differentiation?\n",
  ];

  const orgLevels = [0, 10, 25, 50, 75, 100];
  const presScalar = (org: number) => 0.05 + (Math.min(100, Math.max(0, org)) / 100) * 0.95;

  lines.push("### partyOrgScalar values (standard vs presidential curve)\n");
  lines.push(
    table(
      ["Org", "Standard (0.5–1.0)", "Presidential (0.05–1.0)"],
      orgLevels.map((o) => [String(o), partyOrgScalar(o).toFixed(3), presScalar(o).toFixed(3)])
    )
  );

  // Head-to-head: Dem (varying org) vs Rep (org=50). PA.
  lines.push("\n### Dem org varies vs Rep org=50. PI=100, fav=70, pos=0/0. PA.\n");
  const orgRows: string[][] = [];
  for (const orgA of orgLevels) {
    const orgMap = new Map([
      ["democrat", orgA],
      ["republican", 50],
    ]);
    const a = makeCandidate("a", `Dem org=${orgA}`, 0, 0, 100, 70, "democrat");
    const b = makeCandidate("b", "Rep org=50", 0, 0, 100, 70, "republican");
    const r = runRace([a, b], "PA", orgMap);
    orgRows.push([String(orgA), pct(r["a"]), pct(r["b"]), pct(r["a"] - r["b"])]);
    if (orgA === 0 && r["b"] - r["a"] > 25)
      flag(
        7,
        "Party Org",
        `Zero party org results in ${(r["b"] - r["a"]).toFixed(1)}pp deficit vs org=50`
      );
  }
  lines.push(table(["Dem org", "Dem share", "Rep share (org=50)", "Dem advantage"], orgRows));

  // Independent (org=undefined → 1.0×) vs partisan at varying org
  lines.push("\n### Independent (org=null → 1.0×) vs partisan. Same pos/PI/fav.\n");
  const indRows: string[][] = [];
  for (const partyOrg of orgLevels) {
    const orgMap = new Map([["republican", partyOrg]]);
    const ind = makeCandidate("ind", "Independent", 0, 0, 100, 70, "independent");
    const rep = makeCandidate("rep", `Rep org=${partyOrg}`, 0, 0, 100, 70, "republican");
    const r = runRace([ind, rep], "PA", orgMap);
    indRows.push([
      String(partyOrg),
      pct(r["ind"]),
      pct(r["rep"]),
      r["ind"] > r["rep"] ? "Ind wins" : "Rep wins",
    ]);
  }
  lines.push(table(["Rep org", "Independent share", "Republican share", "Winner"], indRows));
  lines.push(
    "\n**Note:** Independent uses org=null → 1.0×. Shows the crossover where a well-organized party beats an independent."
  );

  // Edge case: org=0 vs org=100
  lines.push("\n### Edge case: org=0 vs org=100 (full range)\n");
  const fullOrgMap = new Map([
    ["democrat", 0],
    ["republican", 100],
  ]);
  const fullA = makeCandidate("a", "Dem org=0", 0, 0, 100, 70, "democrat");
  const fullB = makeCandidate("b", "Rep org=100", 0, 0, 100, 70, "republican");
  const fullR = runRace([fullA, fullB], "PA", fullOrgMap);
  lines.push(`Dem org=0: ${pct(fullR["a"])} — Rep org=100: ${pct(fullR["b"])} in PA`);
  if (fullR["b"] - fullR["a"] > 30)
    flag(
      7,
      "Party Org",
      `org=0 vs org=100 gap is ${(fullR["b"] - fullR["a"]).toFixed(1)}pp — org differential too large`
    );

  return lines.join("\n");
}

// ── Suite 8: Per-Factor Weight Decomposition ──────────────────────────────
export function suite8_factorDecomposition(): string {
  const lines: string[] = [
    "## Suite 8: Per-Factor Weight Decomposition\n\n" +
      "**Setup:** New player (aligned, PI=10, fav=50) vs veteran (misaligned, PI=100, fav=75).\n" +
      "PI=100 = max state cap. Breaks down where the veteran's advantage comes from.\n\n" +
      "**Question:** Which factor is doing the most work?\n",
  ];

  const demoEP = 0,
    demoSP = 0;
  const profiles: Array<[string, number, number, number, number]> = [
    ["New player (aligned, PI=10, fav=50)", 0, 0, 10, 50],
    ["Veteran (misaligned +2, PI=100, fav=75)", 2, 2, 100, 75],
  ];

  lines.push("### Factor breakdown for center voter group (lean 0,0)\n");
  const decomRows: string[][] = [];
  for (const [label, econ, social, pi, fav] of profiles) {
    const posRaw = Math.max(0, 50 - Math.abs(econ - demoEP) * 5 - Math.abs(social - demoSP) * 5);
    const posScore = Math.pow(posRaw, 2) / 100;
    const reach = normalizeNPI(pi);
    const approval = approvalScalar(fav);
    const org = partyOrgScalar(undefined);
    const weight = posScore * reach * approval * org;
    decomRows.push([
      label,
      posScore.toFixed(2),
      reach.toFixed(3),
      approval.toFixed(3),
      org.toFixed(3),
      weight.toFixed(3),
    ]);
  }
  lines.push(
    table(["Profile", "posScore (0–25)", "reach (0–1.0)", "approval", "org", "weight"], decomRows)
  );

  // Counterfactual: swap each stat from veteran to new player level
  const calc = (ep: number, sp: number, pi: number, fav: number) => {
    const posRaw = Math.max(0, 50 - Math.abs(ep - demoEP) * 5 - Math.abs(sp - demoSP) * 5);
    return (
      (Math.pow(posRaw, 2) / 100) *
      normalizeNPI(pi) *
      approvalScalar(fav) *
      partyOrgScalar(undefined)
    );
  };
  const [, e1, s1, n1, f1] = profiles[0];
  const [, e2, s2, n2, f2] = profiles[1];
  const wA = calc(e1, s1, n1, f1);
  const wB = calc(e2, s2, n2, f2);

  lines.push("\n### Counterfactual: what if veteran had new-player stats?\n");
  lines.push(
    table(
      ["Scenario", "Weight", "vs actual B", "Gap vs A"],
      [
        ["Actual B (veteran)", wB.toFixed(3), "—", (wB - wA).toFixed(3)],
        [
          "B with PI=10 (new player PI)",
          calc(e2, s2, n1, f2).toFixed(3),
          (calc(e2, s2, n1, f2) - wB).toFixed(3),
          (calc(e2, s2, n1, f2) - wA).toFixed(3),
        ],
        [
          "B with fav=50 (new player fav)",
          calc(e2, s2, n2, f1).toFixed(3),
          (calc(e2, s2, n2, f1) - wB).toFixed(3),
          (calc(e2, s2, n2, f1) - wA).toFixed(3),
        ],
        [
          "B with pos 0/0 (aligned)",
          calc(0, 0, n2, f2).toFixed(3),
          (calc(0, 0, n2, f2) - wB).toFixed(3),
          (calc(0, 0, n2, f2) - wA).toFixed(3),
        ],
      ]
    )
  );

  if (wB / wA > 3)
    flag(
      8,
      "Factor Decomp",
      `Veteran (PI=100, +2/+2) has ${(wB / wA).toFixed(1)}× the vote weight of an aligned new player (PI=10) in a center group`
    );

  return lines.join("\n");
}

// ── Suite 9: Vote Splitting ────────────────────────────────────────────────
export function suite9_voteSplitting(): string {
  const lines: string[] = [
    "## Suite 9: Vote Splitting\n\n" +
      "**Question:** Do votes split realistically in multi-candidate races? PI capped at 100.\n",
  ];

  // 9a. Two similar left + one outlier (PI varies up to 100)
  lines.push(
    "### A: Two similar left (-2/-2 and -1/-1) + right outlier (+3/+3). PI varies. PA and CA.\n"
  );
  for (const [stateId, label] of [
    ["PA", "Purple"],
    ["CA", "Deep Blue"],
  ] as [string, string][]) {
    lines.push(`\n**${label} (${stateId}):**\n`);
    const rows: string[][] = [];
    for (const outPI of [10, 50, 100]) {
      const l1 = makeCandidate("l1", "Left A (-2/-2)", -2, -2, 50, 70);
      const l2 = makeCandidate("l2", "Left B (-1/-1)", -1, -1, 50, 70);
      const out = makeCandidate("out", `Right+3 PI=${outPI}`, 3, 3, outPI, 70);
      const r = runRace([l1, l2, out], stateId);
      const splitDiff = Math.abs(r["l1"] - r["l2"]);
      rows.push([
        String(outPI),
        pct(r["l1"]),
        pct(r["l2"]),
        pct(r["out"]),
        splitDiff < 5 ? "even split ✓" : `uneven (${splitDiff.toFixed(1)}pp diff)`,
      ]);
      if (r["out"] > r["l1"] + r["l2"])
        flag(
          9,
          "Vote Splitting",
          `${label}: outlier (PI=${outPI}) absorbs more votes than combined similar pair`
        );
    }
    lines.push(table(["Outlier PI", "Left A", "Left B", "Outlier", "Split quality"], rows));
  }

  // 9b. PI absorption: 3 identical candidates, one with high PI
  lines.push("\n### B: PI absorption — 3 identical candidates (pos 0/0, fav 70), PI varies\n");
  lines.push("Expected: near-equal split when PI equal; proportional advantage when different.\n");
  const absRows: string[][] = [];
  for (const [p1, p2, p3] of [
    [10, 10, 10],
    [10, 10, 100],
    [10, 100, 100],
  ] as [number, number, number][]) {
    const a = makeCandidate("a", "A", 0, 0, p1, 70);
    const b = makeCandidate("b", "B", 0, 0, p2, 70);
    const c = makeCandidate("c", "C", 0, 0, p3, 70);
    const r = runRace([a, b, c], "PA");
    absRows.push([`${p1}/${p2}/${p3}`, pct(r["a"]), pct(r["b"]), pct(r["c"])]);
    if (Math.abs(r["a"] - 33.3) > 10 && p1 === p2)
      flag(
        9,
        "Vote Splitting",
        `Identical-position candidates PI ${p1}/${p2}/${p3} split ${r["a"].toFixed(1)}/${r["b"].toFixed(1)}/${r["c"].toFixed(1)}% — expected near-even`
      );
  }
  lines.push(table(["PI A/B/C", "A share", "B share", "C share"], absRows));

  // 9c. Left-centrist-right three-way with equal PI=100
  lines.push("\n### C: Left (-3/-3) vs Centrist (0/0) vs Right (+3/+3). PI=100 all. 5 states.\n");
  const threeWayRows: string[][] = [];
  for (const [stateId, label] of REPRESENTATIVE_STATES) {
    const left = makeCandidate("l", "Left", -3, -3, 100, 70);
    const center = makeCandidate("c", "Center", 0, 0, 100, 70);
    const right = makeCandidate("r", "Right", 3, 3, 100, 70, "republican");
    const r = runRace([left, center, right], stateId);
    threeWayRows.push([`${label} (${stateId})`, pct(r["l"]), pct(r["c"]), pct(r["r"])]);
  }
  lines.push(table(["State", "Left", "Center", "Right"], threeWayRows));
  lines.push(
    "\n**Expected:** Center wins or is competitive in purple states. Deep partisan states favor the matching extreme."
  );

  // 9d. Edge case: 6-way identical field
  lines.push(
    "\n### D: 6-way identical field (pos 0/0, PI=100, fav=70, all same party). Should split ~16.7%.\n"
  );
  const sixCands = Array.from({ length: 6 }, (_, i) =>
    makeCandidate(String(i), `C${i}`, 0, 0, 100, 70)
  );
  const sixR = runRace(sixCands, "PA");
  const sixShares = Object.values(sixR);
  const maxDev6 = Math.max(...sixShares.map((s) => Math.abs(s - 100 / 6)));
  lines.push(
    `Shares: ${sixShares.map(pct).join(", ")}. Max deviation from 16.7%: ${maxDev6.toFixed(2)}pp`
  );
  if (maxDev6 > 2)
    flag(
      9,
      "Vote Splitting",
      `6-way identical field deviates ${maxDev6.toFixed(1)}pp from even split`
    );

  return lines.join("\n");
}

// ── Suite 10: Field Size Scaling ──────────────────────────────────────────
export function suite10_fieldSize(): string {
  const lines: string[] = [
    "## Suite 10: Field Size Scaling\n\n" +
      "**Setup:** N identical candidates (pos 0/0, PI=100, fav=70). N = 2..6. PA.\n\n" +
      "**Question:** Does vote share scale as 100%/N?\n",
  ];

  const rows: string[][] = [];
  for (let n = 2; n <= 6; n++) {
    const candidates = Array.from({ length: n }, (_, i) =>
      makeCandidate(String(i), `C${i}`, 0, 0, 100, 70)
    );
    const r = runRace(candidates, "PA");
    const expected = 100 / n;
    const shares = Object.values(r);
    const maxDev = Math.max(...shares.map((s) => Math.abs(s - expected)));
    rows.push([
      String(n),
      pct(expected),
      pct(Math.max(...shares)),
      pct(Math.min(...shares)),
      pct(maxDev),
      maxDev > 2 ? "⚠️ uneven" : "✓ even",
    ]);
    if (maxDev > 2)
      flag(
        10,
        "Field Size",
        `${n}-candidate identical field: max deviation ${maxDev.toFixed(1)}pp from expected ${expected.toFixed(1)}%`
      );
  }
  lines.push(
    table(
      ["N candidates", "Expected share", "Max share", "Min share", "Max deviation", "Quality"],
      rows
    )
  );

  // PI disparity in a 5-candidate field (state-realistic: 1 max PI vs 4 low PI)
  lines.push(
    "\n### 5-candidate field: 4 at PI=10 (starter) + 1 at PI=100 (max). Same positions.\n"
  );
  const bigFieldCands = [
    makeCandidate("h", "PI=100", 0, 0, 100, 70),
    ...Array.from({ length: 4 }, (_, i) =>
      makeCandidate(String(i), `PI=10 #${i + 1}`, 0, 0, 10, 70)
    ),
  ];
  const bigR = runRace(bigFieldCands, "PA");
  const avgLow = [bigR["0"], bigR["1"], bigR["2"], bigR["3"]].reduce((s, v) => s + v, 0) / 4;
  lines.push(
    `PI=100 candidate: ${pct(bigR["h"])} — avg PI=10 candidate: ${pct(avgLow)} — advantage: ${pct(bigR["h"] - avgLow)}`
  );
  if (bigR["h"] > 30)
    flag(
      10,
      "Field Size",
      `Max-PI candidate takes ${bigR["h"].toFixed(1)}% in 5-field vs expected 20% — PI absorption in crowded field`
    );

  // Edge case: mixed PI in a 4-way race
  lines.push("\n### 4-way: PI=10, PI=25, PI=75, PI=100. Same positions and approval.\n");
  const mixCands = [
    makeCandidate("a", "PI=10", 0, 0, 10, 70),
    makeCandidate("b", "PI=25", 0, 0, 25, 70),
    makeCandidate("c", "PI=75", 0, 0, 75, 70),
    makeCandidate("d", "PI=100", 0, 0, 100, 70),
  ];
  const mixR = runRace(mixCands, "PA");
  const mixRows = [
    ["PI=10", pct(mixR["a"])],
    ["PI=25", pct(mixR["b"])],
    ["PI=75", pct(mixR["c"])],
    ["PI=100", pct(mixR["d"])],
  ];
  lines.push(table(["Candidate", "Share"], mixRows));
  lines.push(
    "\n**Expected:** Shares should increase proportionally with PI. Large jumps indicate disproportionate PI leverage."
  );

  return lines.join("\n");
}
