# NPP production-method lane qualification

This is a decision and paid-capacity invariant experiment, not a world trajectory or profit forecast.

The old decision path indexed the strategy catalog by the persisted parent type. A vehicle plant could choose a generic metal or electronics recipe, and an entertainment plant could choose a news-broadcast recipe. The turn resolver reads the operating lane, so those IDs are invalid there. This report qualifies the writer correction; it does not qualify changing existing invalid records or the resolver fallback.

Run `npx tsx scripts/sim/nppOperatingLaneStrategies.ts`.

The script exercises the actual decision, availability and capacity-rescale helpers in 96 cases: four plant identities, three world years (1953, 1994 and 2027), four fixed price profiles, and tech gating enabled or disabled. It produced 63 retool decisions. Every selected recipe belonged to the operating lane and passed the existing availability policy. Every decision preserved paid capacity value, calibrated operating-cost value, queued paid value, order cost and completion turn. No cash write was returned.

Two native regression cases failed before the change: entertainment selected `legacy_broadcast`, and vehicles selected `heavy_metals`. Both pass with operating-lane catalog selection. Commercial media retains its valid legacy broadcast choice; existing transitions remain untouched.

The experiment does not simulate demand, market prices, future margins, NPP strength, migration, or a live world's response. Existing invalid target/source IDs still require a separately qualified unit-preserving correction before changing their fallback semantics. No blanket recipe rate or funding change is included.
