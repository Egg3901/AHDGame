export const usHouseRedistrictingContent = `# US House Redistricting

When redistricting is enabled, **US House elections resolve per congressional district** instead of statewide proportional allocation. Each district has its own lean derived from a 16-square voter map; a party holding a **state trifecta** (governor plus chamber majority from the same party) can redraw that map between cycles.

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

A **trifecta** (same party controls the governorship and the state legislature majority) is required to open the map editor in legislature-drawn states.

## Drawing rules

Proposed maps must satisfy all active caps:

- Each district totals exactly **16 squares** (no negative counts).
- Statewide square totals are **conserved**: you redistribute voters, not invent them.
- **Per-district deviation**: no district may lean more than the compactness tier allows away from the state mean.
- **Packed districts**: districts with ≥12 squares of one color count toward a packed-district limit.
- **Efficiency gap**: the statewide gap between wasted left and wasted right votes must stay below the fairness ceiling.

Illegal maps cannot be saved. Auto-map presets respect the same legality checks: strategies blocked by current law are disabled in the UI.

## Map editor tools

Trifecta holders use the state redistricting editor to:

- Drag squares between districts manually.
- Apply **auto-map strategies** (maximize seats, neutralize, protect incumbents, etc.) within legal caps.
- Review a **composition summary**: seat lean breakdown, compactness indicators, and efficiency-gap readout before committing.

Committed maps take effect for the next House cycle in that state.

## Campaign effects

District-level races mean **ground game and ads target a smaller electorate**. Statewide popularity still matters, but winning a gerrymandered map often requires contesting the handful of grey or lightly leaning districts rather than running up margins everywhere.

## Related

- [Election Mechanics](/wiki/election-mechanics): vote accumulation and FPTP resolution
- [General Elections](/wiki/general-elections): closing-sprint tactics at district scale
- [Demographics](/wiki/demographics): how state texture feeds district leans
- [Bills & Legislation](/wiki/bills-legislation): state redistricting, compactness, and fairness laws
`;
