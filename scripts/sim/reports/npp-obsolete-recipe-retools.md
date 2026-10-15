# Bounded correction of obsolete NPP parent recipes

Question: can a computer-run vehicle or entertainment plant leave a known
foreign parent recipe through the existing gradual retool without granting
capacity, cash, technology or construction value?

Run `npx tsx scripts/sim/nppObsoleteRecipeRetools.ts`.

Result: 36 synthetic cases passed across 1953, 1994 and 2027, technology gating
on/off and plants on/off. The 18 plants cases replay all 13 blend samples from
commitment through completion, 234 samples total. The actual decision and
retool helpers preserve:

- Paid stock value at the destination RPU and every intermediate recipe mix.
- Queued paid value, cost already paid and construction completion turn.
- Stock times calibrated operating-cost anchor.
- Physical supply and demand at the instant of commitment.
- Input records, cash and technology unlocks.

The existing eight-turn company cohort still selects at most one retool per
eligible company. Focused native tests cover the normal decision shell's cohort
and state-owned-company exclusions, active transitions, cooldown, divestment,
mothballing, player control, explicit advanced methods, unknown IDs and
corrective priority over optional price-driven shifts. Three known invalid-ID
regressions failed before the correction and pass after it.

Scope is exactly `legacy_broadcast` in entertainment and `heavy_metals` or
`electronics_manufacturing` in vehicle manufacturing. Existing blends complete
before becoming eligible; valid advanced recipes are not rewritten. Unknown
shapes remain unsupported. The old source ID is retained during the blend so
its physical fallback remains readable on the paid source basis. The general
unknown-ID fallback is unchanged.

This is a normal-transition rules and accounting replay, not an integrated world
trajectory or a claim of future profitability. Returning to the standard method
can change output mix, advertising eligibility and policy modifiers as a normal
recipe change does. No bulk data migration or historical compensation is part
of this patch. Rollout requires the normal CI and staging gates, followed by
live observation of correction starts and completions.
