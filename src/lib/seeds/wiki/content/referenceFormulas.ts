export const referenceFormulasContent = `# Reference: Formulas

Complete formula reference for A House Divided. All values are sourced directly from game code. Formulas marked with (*) use diminishing-return normalization curves: see the NPI normalization section below.

---

## Primary score formulas

### State-level primary score

Used for: US House, US Senate, US Governor, US State Senate, UK Commons, UK Regional Council, DE Bundestag, JP Shūgiin, JP Sangiin.

**Maximum: 100 points** (raw), then multiplied by an infamy penalty. The score is a candidate's **standing**: each turn of the primary's closing window it sets their share of the ballots the party's registered voters cast, and the cumulative ballot count decides the nominee. Only where a party has no registered voters on file does the raw score decide directly.

| Component | Range | Formula |
|---|---|---|
| Alignment (state) | 0 to 25 | \`max(0, 25 − (|econDiff_state| + |socialDiff_state|) × 1.25)\` vs. state cached lean |
| Alignment (party) | 0 to 15 | \`max(0, 15 − (|econDiff_party| + |socialDiff_party|) × 0.75)\` vs. party position |
| Favorability | 0 to 35 | \`(favorability / 100) × 35\` |
| Political Influence | 0 to 25 | \`normalizeNPI(politicalInfluence) × 25\` (*) |

- Alignment splits into two: 25 pts on the state's cached economic/social lean, 15 pts on party platform.
- When the state has no cached lean, scoring falls back to a single 40-pt party-only alignment: \`max(0, 40 − (|econDiff_party| + |socialDiff_party|) × 2.0)\`.
- Final score = raw × \`(1 − 0.05 × min(100, max(0, infamy))/100)\`, a 5% reduction at infamy=100.

**Quick alignment reference (state-vs-state-lean OR state-vs-party):**

| Manhattan distance | State alignment (0 to 25) | Party alignment (0 to 15) | Fallback (0 to 40) |
|---|---|---|---|
| 0 | 25 | 15 | 40 |
| 2 | 22.5 | 13.5 | 36 |
| 5 | 18.75 | 11.25 | 30 |
| 10 | 12.5 | 7.5 | 20 |
| 20 | 0 | 0 | 0 |

**NPP primary score penalty:** When at least one player is in the same party's primary, all NPP candidates in that primary receive a **×0.5 multiplier** on their total score. An NPP with a raw score of 70 competes at an effective 35 against you. NPPs aren't subject to the infamy penalty.

---

### Presidential primary score

Used for: US President only.

**Maximum: 100 points**

| Component | Range | Formula |
|---|---|---|
| Alignment (party only) | 0 to 40 | \`max(0, 40 − (|econDiff_party| + |socialDiff_party|) × 2.0)\` |
| Party Influence | 0 to 20 | \`normalizePartyInfluencePresidentialPrimary(partyInfluence) × 20\` (reference scale: partyInfluence 150) |
| National Reach | 0 to 15 | \`normalizeNationalReachPresidentialPrimary(NPI) × 15\` (*) |
| Favorability | 0 to 25 | \`(favorability / 100) × 25\` |

Same infamy penalty applies on the final score. Key differences from the state formula:
- **No state-position alignment**: presidential primaries are national, only the party platform matters.
- **Alignment stays dominant at 40 pts**, so parties still favor candidates who agree with them.
- **Favorability is worth 25 points**, high enough to matter but never enough on its own to outweigh alignment.
- **Party influence and national reach split the rest** (20 and 15 pts), with party influence still outranking raw reach.
- **NPI normalization curve is different**: uses a diminishing-returns curve \`1 − exp(−NPI/45)\` (\`normalizeNationalReachPresidentialPrimary\`), not the sqrt curve that state PI uses. The diminishing shape keeps favorability and reach meaningful against a moderate NPI gap.

---

## Canvassing formula

Cost: **₳100 + 1 action**. Home state / region only.

\`\`\`
baseBoost        = 0.05 (percentage points)
distance         = |charEcon − demoEcon| + |charSocial − demoSocial|
alignmentMult    = max(0.1, 1.0 − distance × 0.15)
seasonMult       = isCampaignSeason ? 2.0 : 1.0
rawBoost         = baseBoost × alignmentMult × seasonMult
adjustedBoost    = rawBoost × (1 − |currentModifier| / 20)   // diminishing returns
newModifier      = clamp(currentModifier + adjustedBoost, −20, +20)
\`\`\`

- Campaign season = election active with \`endTime\` within 4 hours (4 turns)
- Cap: ±20 percentage points turnout modifier
- Decay: 2% of current value per turn toward zero

**Alignment multiplier table:**

| Manhattan distance | Alignment multiplier |
|---|---|
| 0 | 1.0 × |
| 3 | 0.55 × |
| 5 | 0.25 × |
| 6.6+ | 0.1 × (floor) |

---

## Campaign ops trees

Fundraising, Ground Game, Media Spending, and Opposition Research are each a **branch tree** on the campaign page (\`/campaign/[id]\`), not a flat level ladder. Each tree unlocks a starter node, then up to three further branches (for example Media Spending's Broadcast and Television branches, Opposition Research's Dossier, Scandal Leak, and Counter-Intel). Branch magnitudes stack with the starter and with each other. Maintenance is deducted from campaign funds each turn; branches that can't be covered auto-downgrade rather than collapsing the whole tree, with no refund.

Full per-tree cost and effect tables, current to the live constants: [Campaign Strategy](/wiki/campaign-strategy) and [Campaign Manager](/wiki/campaign-manager).

**Campaign season multiplier:** All campaign passive effects (Media Spending, Opposition Research, Travel Presence, Primary Campaign bonus) double during the **final 4 turns** of an election.

---

## Vote accumulation (general elections)

### Per-turn vote pool weighting

\`\`\`
Early band:
  turnPool = 0.50 × totalPool / earlyTurnCount

Ramp band (up to 8 turns before the final band):
  turnPool = 0.20 × totalPool / rampTurnCount

Final 4 turns:
  turnPool = 0.30 × totalPool / 4
\`\`\`

The final 4 turns collectively deliver **30% of all votes** cast in an election. Races of 4 turns or fewer split the pool evenly.

### Total appeal pipeline (per demographic group, per candidate, per turn)

\`\`\`
reach         = normalizeNPI(influence)         // sqrt curve, capped at 1.0 when PI/NPI reaches 100
positionRaw   = max(0, 50 − |econDiff|×5 − |socialDiff|×5)
positionScore = 25 × (positionRaw / 50)^1.5 + 0.5
direction     = up to 5 per aligned ideological axis
influenceAppeal = includeInfluence ? normalizeNPI(influence) × 12.5 : 0
appeal        = positionScore + direction + influenceAppeal
effectiveFav  = clamp(favorability + groupApproval × 0.5, 0, 100)
approval      = (effectiveFav / 100)^0.8
orgShare      = statePartyOrg / sum(all party Org in the state)
partyOrg      = orgShare^0.2
personalFloor = 0.1 × reach × approval
effectiveOrg  = max(partyOrg, personalFloor)
infamyMult    = 1 − 0.05 × (min(100, max(0, infamy))/100)
weight        = appeal × reach × approval × effectiveOrg × infamyMult × other configured general-election factors
\`\`\`

State races use influence for reach but not \`influenceAppeal\`; presidential generals include it. Directional bonuses are continuous around the center and may be suppressed when a leaning candidate points against their party on that axis. General-election factors also include registration resistance, seeded registration baseline, candidate Support, campaign presence, NPP and regime multipliers, and race-specific coattails where configured.

**Tenure erosion.** Both \`influence\` and \`favorability\` are scaled down before they enter the lines above, once the seat has been held for more than one consecutive term. Each term beyond the first costs 3% of both, stopping at 15%, so a long-serving officeholder still carries 85% of their reach and approval into the race at worst. A first-term holder, an open seat and a fresh nominee are all untouched. This is separate from party-tenure fatigue in the National Mood channel: that one prices how a party wears a bad economy, this one prices the standing that accumulates from holding office.

Which run is counted depends on the office. Senate seats and each returning House nominee count that person's own unbroken run in the seat. The presidency counts the **party's** run, so the erosion follows the incumbent party's nominee whether or not they personally held the office before.

### Office strength multipliers

| Office | Strength weight |
|---|---|
| Governor | 1.0 |
| President | 1.0 |
| House / State Senate | 0.9 / 0.85 |
| Senate | 0.8 |

---

## NPI normalization (*)

Political Influence (PI) and National Political Influence (NPI) pass through normalizing curves before use in formulas. \`normalizeNPI\` is a **sqrt curve clamped to [0, 100]**: meaningful spread at the high end, hard-capped at 1.0:

| PI value | normalizeNPI output |
|---|---|
| 0 | 0.00 |
| 25 | 0.50 |
| 50 | ~0.71 |
| 85 | ~0.92 |
| 99 | ~0.995 |
| 100 | 1.00 (cap) |
| 200+ | 1.00 (clamped) |

\`normalizeNPI\` is used by state-level primary scoring AND by general-election reach (state and presidential).

Presidential **primaries** use a separate curve (\`normalizeNationalReachPresidentialPrimary\`): diminishing returns via \`1 − exp(−NPI/45)\`. NPI=25 → 0.426, NPI=55 → 0.706, NPI=80 → 0.831, NPI=100 → 0.892, NPI=200 → 0.988. Above the high end the curve continues to creep toward 1.0 but never reaches it, so the celebrity-bonus regime is naturally bounded.

---

## Party organization scalars

Party org (0 to 100) affects:

| Effect | Formula |
|---|---|
| General election vote weight | \`(ownOrg / totalStateOrg) ^ 0.2\` |
| Personal floor | \`max(orgWeight, 0.1 × reach × approval)\` |
| Presidential primary score | Party Org does not enter; party influence and national reach are separate components |

An empty state Org map gives every party a neutral 1× fallback. In a populated map, a party with 0 Org has 0 Org weight before the personal floor. A 3:1 Org lead produces about a 1.25:1 Org-weight advantage because of the 0.2 exponent.

---

## Turnout modifier decay

Each turn: \`newModifier = currentModifier × 0.98\`

Effect accumulates over turns:

| Turns since canvassing | Modifier remaining |
|---|---|
| 0 | 100% |
| 4 | ~92% |
| 10 | ~82% |
| 20 | ~67% |

---

## Related

- [Reference: Turn Order](/wiki/reference-turn-order): phase execution order.
- [Election Mechanics](/wiki/election-mechanics): full election structure and vote accumulation.
- [Primaries](/wiki/primaries): declaration rules and NPP dynamics.
- [Canvassing](/wiki/canvassing): turnout boost formula in detail.
- [Campaign Strategy](/wiki/campaign-strategy): upgrade tables and action allocation.
`;
