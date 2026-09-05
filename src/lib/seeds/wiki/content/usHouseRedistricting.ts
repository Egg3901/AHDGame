export const usHouseRedistrictingContent = `# US House Redistricting & Gerrymandering

## In short

When redistricting is enabled, **US House elections resolve per congressional district** instead of statewide proportional allocation. Each district has its own lean derived from a 16-square voter map. Maps are rebuilt neutrally at each decennial census. In a census year, the **governor** of a state whose party also holds the state legislature (a **trifecta**) may redraw the map once, but only where state law puts the pen in the legislature's hands, and only within the compactness and fairness caps that state law sets. Drawing past the fairness ceiling is illegal; a live map that ends up past it costs approval.

## When redistricting happens

- **The census** fires in the first week of every year ending in 0. It reapportions the 435 House seats between states and rebuilds the district maps of every state whose seat count changed. States under an independent commission are also rebuilt neutrally at every census.
- **A redraw** is only allowed **in the census year itself**, and **once per census** per state. Outside a census year the editor refuses to save.
- Seat changes and any redraw take effect for the next House cycle in that state.

## District maps

Each state's House delegation is represented as **N districts × 16 squares**. Every square is tagged **left**, **right**, or **grey** (swing). District lean comes from the square mix: a district heavy on right squares is safer for Republicans; packed left or right squares create lopsided seats.

House races in a redistricted state run **one election per district**. Candidates compete for a single seat using the same vote-accumulation engine as other races, but the underlying electorate is the district's lean, not the whole state average.

## Who can draw maps

Map authority depends on **state legislation** (three policy levers):

| Law | Options | Effect |
| --- | --- | --- |
| **Redistricting authority** | Independent commission / Bipartisan commission / Legislature-drawn | Only legislature-drawn maps can be gerrymandered by the trifecta holder; commissions block partisan draws |
| **Compactness** | Strict / Moderate / Loose | Caps how far any district's lean may deviate from the state mean |
| **Fairness** | Strict / Moderate / Loose | Caps the statewide **efficiency gap** (a measure of wasted votes across districts) |

Both gates apply to a save: the acting character must be the **governor** of the state, and the governor's party must hold **more than half** of the state legislature's seats (a **trifecta**). Independent and bipartisan commissions refuse every proposed map outright. Independent-commission states are additionally reset to a neutral map at each census.

The three tiers as the code sets them:

| Tier | Max deviation from state mean | Packed districts allowed | Efficiency-gap ceiling |
| --- | --- | --- | --- |
| Strict | 4 | none | 10% |
| Moderate (default) | 8 | up to one third of districts | 20% |
| Loose | 12 | up to half of districts | 35% |

Deviation is measured in net squares (right minus left) against the state average. If the state's natural balance makes even the fairest possible map exceed the fairness ceiling, the ceiling is relaxed to the best achievable gap, so a state can always be drawn to its own lean but never beyond it.

## Drawing rules

Proposed maps must satisfy all active caps:

- Each district totals exactly **16 squares** (no negative counts).
- Statewide square totals are **conserved**: you redistribute voters, not invent them.
- **Per-district deviation**: no district may lean more than the compactness tier allows away from the state mean.
- **Packed districts**: districts with 12 or more of their 16 squares in one color count toward the packed-district limit.
- **Efficiency gap**: the statewide gap between wasted left and wasted right votes must stay below the fairness ceiling.

Illegal maps cannot be saved. Auto-map presets respect the same legality checks: strategies blocked by current law are disabled in the UI.

## Map editor tools

Trifecta holders use the state redistricting editor to:

- Drag squares between districts manually.
- Apply **auto-map strategies** within legal caps: Competitive (maximize toss-ups), Fair (low efficiency gap), Lean Left, Lean Right, Max Left and Max Right.
- Review a **composition summary**: seat lean breakdown, compactness indicators, and efficiency-gap readout before committing.

Committed maps take effect for the next House cycle in that state.

## How a district decides its seat

Each party's statewide vote total is the baseline. In a district, that baseline is scaled by the district's lean: a party on the right side of a right-leaning district is boosted, the other side is cut, and a 16-0 district is a guaranteed seat. Grey squares lean nowhere. The highest-scoring party takes the seat.

## Gerrymandering in practice

A gerrymander is a legal map that spends the state's squares unevenly: pack the other side into a few lopsided districts and spread your own voters thinly across the rest. The compactness tier limits how lopsided any one district can be, the packed-district limit caps how many of those you can build, and the efficiency gap caps how much of the state's vote you can waste in total. At Strict the tools barely move seats; at Loose a leaning state can sweep and a balanced one can swing about three seats.

**The approval cost.** A live map whose efficiency gap exceeds the state's fairness ceiling carries a per-state approval penalty of 2 to 5 points, growing with how far over the ceiling it is, until the map is corrected. The penalty is labelled as an unfair congressional map on the approval breakdown.

## Campaign effects

District-level races mean **ground game and ads target a smaller electorate**. Statewide popularity still matters, but winning a gerrymandered map often requires contesting the handful of grey or lightly leaning districts rather than running up margins everywhere.

**Campaign Here.** While redistricting is enabled, a party can spend political strength (base cost 2) to boost its score in one district. Each action adds 2.5 points for a candidate's own party and half that for an allied party, capped at 7.5, and the boost decays by 0.5 each turn.

## Where to find it in game

The map editor lives on the state's **Redistrict** page under the region. State redistricting, compactness and fairness laws are proposed as state bills. Approval penalties show on the state's approval breakdown.

## Related

- [Election Mechanics](/wiki/election-mechanics): vote accumulation and FPTP resolution
- [General Elections](/wiki/general-elections): closing-sprint tactics at district scale
- [Demographics](/wiki/demographics): how state texture feeds district leans
- [Bills & Legislation](/wiki/bills-legislation): state redistricting, compactness, and fairness laws
`;
