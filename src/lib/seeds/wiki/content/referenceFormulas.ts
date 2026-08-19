export const referenceFormulasContent = `# Reference: Formulas

Complete formula reference for A House Divided. All values are sourced directly from game code. Formulas marked with (*) use diminishing-return normalization curves: see the NPI normalization section below.

---

## Primary score formulas

### State-level primary score

Used for: US House, US Senate, US Governor, US State Senate, UK Commons, UK Regional Council, DE Bundestag, JP Shūgiin, JP Sangiin.

**Maximum: 100 points** (raw), then multiplied by an infamy penalty.

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

## Campaign upgrade costs and effects

### Fundraising (10 levels, no maintenance)

| Level | Upgrade cost | Actions | Income/turn |
|---|---|---|---|
| 0 (base) | n/a | n/a | ₳20,000 |
| 1 | ₳50,000 | 10 | ₳35,000 |
| 2 | ₳120,000 | 15 | ₳60,000 |
| 3 | ₳250,000 | 20 | ₳100,000 |
| 4 | ₳500,000 | 25 | ₳150,000 |
| 5 | ₳900,000 | 30 | ₳200,000 |
| 6 | ₳1,500,000 | 40 | ₳350,000 |
| 7 | ₳2,500,000 | 50 | ₳600,000 |
| 8 | ₳4,000,000 | 60 | ₳1,000,000 |
| 9 | ₳6,500,000 | 75 | ₳2,500,000 |
| 10 | ₳10,000,000 | 90 | ₳5,000,000 |

### Ground game (5 levels, ongoing maintenance)

Passive effect applies to presidential general elections only. Maintenance is cumulative across all purchased levels.

| Level | Upgrade cost | Actions | Effect | Maintenance/turn |
|---|---|---|---|---|
| 1 | ₳55,000 | 10 | +3% swing states | ₳5,500 |
| 2 | ₳110,000 | 15 | +6% swing states | ₳16,500 |
| 3 | ₳220,000 | 20 | +9% swing states | ₳38,500 |
| 4 | ₳440,000 | 25 | +12% swing states | ₳82,500 |
| 5 | ₳880,000 | 30 | +15% swing states | ₳170,500 |

### Media spending (5 levels, ongoing maintenance)

Passive effect: +0.5% favorability per level per turn (presidential races only). Doubles during final 4 turns (season multiplier 2×).

| Level | Upgrade cost | Actions | Effect | Maintenance/turn |
|---|---|---|---|---|
| 1 | ₳60,000 | 12 | +0.5%/turn favorability | ₳6,000 |
| 2 | ₳120,000 | 16 | +1.0%/turn favorability | ₳18,000 |
| 3 | ₳240,000 | 20 | +1.5%/turn favorability | ₳42,000 |
| 4 | ₳480,000 | 24 | +2.0%/turn favorability | ₳90,000 |
| 5 | ₳960,000 | 28 | +2.5%/turn favorability | ₳186,000 |

### Opposition research (5 levels, no maintenance)

Passive effect: Debuffs target candidate favorability by level × 0.5% per turn. Presidential races only.

| Level | Upgrade cost | Actions | Effect |
|---|---|---|---|
| 1 | ₳40,000 | 8 | −0.5%/turn to target |
| 2 | ₳80,000 | 12 | −1.0%/turn to target |
| 3 | ₳160,000 | 16 | −1.5%/turn to target |
| 4 | ₳320,000 | 20 | −2.0%/turn to target |
| 5 | ₳640,000 | 24 | −2.5%/turn to target |

**Campaign season multiplier:** All campaign passive effects (Media Spending, Opposition Research, Travel Presence, Primary Campaign bonus) double during the **final 4 turns** of an election.

---

## Vote accumulation (general elections)

### Per-turn vote pool weighting

\`\`\`
Early turns (all turns except final 4):
  turnPool = 0.75 × totalPool / (totalTurns − 4)

Final 4 turns:
  turnPool = 0.25 × totalPool / 4
\`\`\`

The final 4 turns collectively deliver **25% of all votes** cast in an election.

### Total appeal pipeline (per demographic group, per candidate, per turn)

\`\`\`
reach        = normalizeNPI(influence)         // sqrt curve, capped at 1.0 (PI/NPI ≥ 100)
appeal       = (50 − |econDiff|×5 − |socialDiff|×5)² / 100 + normalizeNPI(influence) × 25
approval     = favorability / 100
partyOrg     = 0.5 + (statePartyOrg / 100) × 0.5      // 0.5× to 1.0×
infamyMult   = 1 − 0.05 × (min(100, max(0, infamy))/100)   // 0.95× at infamy=100; 1.0× for NPPs
weight       = appeal × reach × approval × partyOrg × infamyMult
\`\`\`

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
| General election vote scalar | \`0.5 + (statePartyOrg / 100) × 0.5\` (range 0.5× to 1.0×) |
| Presidential primary score | \`(statePartyOrg / 100) × 25\` (range 0 to 25 pts) |

A state party org of 0 cuts your general vote total in half compared to a fully organized state.

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
