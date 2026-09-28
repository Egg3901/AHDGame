# Investigation: AHDGame issues #2087, #2088, and #2089

Date: 2026-09-18<br>
Source revision: [`ad16368fec7a45daa559cebafc138ff039ba43c2`](https://github.com/Egg3901/AHDGame/commit/ad16368fec7a45daa559cebafc138ff039ba43c2), `origin/development`

## Scope and method

I read the full bodies and comments for [#2087](https://github.com/Egg3901/AHDGame/issues/2087), [#2088](https://github.com/Egg3901/AHDGame/issues/2088), and [#2089](https://github.com/Egg3901/AHDGame/issues/2089) with the authenticated `gh` CLI. Each issue has one comment; the comments explicitly link the three tickets as companions: [#2087 comment](https://github.com/Egg3901/AHDGame/issues/2087#issuecomment-5722877873), [#2088 comment](https://github.com/Egg3901/AHDGame/issues/2088#issuecomment-5722878030), and [#2089 comment](https://github.com/Egg3901/AHDGame/issues/2089#issuecomment-5722878278).

I searched repository issues, pull requests, and commit messages for the exact requested terms: `inflationIndex`, `P/Pbase`, `CPI`, `service D/S`, `scarcityMult`, `plants`, `capital control`, `CCC`, `UK`, `1953`, and `1957`. I then traced the relevant definitions in the source at the revision above. The issue-run tables are treated as primary reported observations, but were not independently rerun in this pass.

## Executive finding

| Issue | Finding                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #2087 | Confirmed. `economy.inflationIndex` is an unweighted cross-sectional commodity price-level ratio, `mean(globalPrice / basePrice)`, not household CPI. The current CPI/inflation path uses annualized price changes, although one input comment still documents the retired level-vs-base formula.                                                                                                                        |
| #2088 | The rail mechanics are confirmed, and the reported service behavior is plausible. The stronger claim that supply never responds is not established by source inspection: there are shortage-aware, but gated and rate-limited, NPP entry and production paths. The ticket's `D/S > 1.15` threshold is slightly wrong for the current implementation; the code's 15% unmet-demand threshold corresponds to `D/S > 1.176`. |
| #2089 | The era-blind debt-rating ladder is confirmed, including `CCC` only above 250% debt/GDP. The 1953 UK seed itself starts at about 181% debt/GDP while authoring `AAA`, and current development explicitly ignores the seed anchor when assessing risk, so the first fiscal resync can re-rate it to `B`. The plants/full-to-UK-deficit causal chain is not isolated by the current source trace.                          |

## Search coverage and related primary sources

The exact-term search found the following useful anchors. The commit-message searches had no direct hits for the exact terms, but source history identified the commits listed below.

| Topic                                      | Related primary sources                                                                                                                                                     | Relevance                                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPI and commodity pressure                 | [PR #509](https://github.com/Egg3901/AHDGame/pull/509), merged in [commit `ccbd7427`](https://github.com/Egg3901/AHDGame/commit/ccbd7427cbb8ff8671be1b7e3c60c14a0489032a)   | Replaced the old commodity level-vs-frozen-base inflation contribution with annualized price change.                                                                                     |
| Demand calibration and plants              | [PR #365](https://github.com/Egg3901/AHDGame/pull/365), merged in [commit `6403cca1`](https://github.com/Egg3901/AHDGame/commit/6403cca1c789d187ce4d2d9833e56ac603bd5c3a)   | Recalibrated advertising, healthcare, and gas after plant-era gluts. This is historical context, not proof that current service shortages clear.                                         |
| Market completion and supply access        | [#968](https://github.com/Egg3901/AHDGame/issues/968), [#991](https://github.com/Egg3901/AHDGame/issues/991)                                                                | Broader market-fill, entry-funnel, and fragile-market work that overlaps #2088.                                                                                                          |
| Clearing and supply measurement            | [#2054](https://github.com/Egg3901/AHDGame/issues/2054), [PR #2066](https://github.com/Egg3901/AHDGame/pull/2066)                                                           | Adjacent order-book versus lagged-supply unit-basis issue that could worsen observed shortages, but is not the scarcity-drift formula.                                                   |
| Plants and macro signals                   | [#2056](https://github.com/Egg3901/AHDGame/issues/2056), [PR #2064](https://github.com/Egg3901/AHDGame/pull/2064)                                                           | GDP-growth snapshot rollover can confound plants/full fiscal and growth comparisons.                                                                                                     |
| Debt stock and fiscal state                | [PR #2062](https://github.com/Egg3901/AHDGame/pull/2062), which fixes [#1975](https://github.com/Egg3901/AHDGame/issues/1975)                                               | Open work on using the active sovereign bond stock rather than allowing cash movements to rewrite principal. Relevant to #2089's fiscal attribution.                                     |
| Capital-control terminology and securities | [#1001](https://github.com/Egg3901/AHDGame/issues/1001), [PR #1020](https://github.com/Egg3901/AHDGame/pull/1020), [PR #1955](https://github.com/Egg3901/AHDGame/pull/1955) | These concern sovereign-bond demand and capital-control eligibility. #2089's compared `capital` posture is a worldsim capital-tier posture, not necessarily this capital-control policy. |
| Monetary observability and seed integrity  | [#2021](https://github.com/Egg3901/AHDGame/issues/2021), [#2072](https://github.com/Egg3901/AHDGame/issues/2072), [#2073](https://github.com/Egg3901/AHDGame/issues/2073)   | Adjacent issues. #2021 is an M2/bond-pool pulse problem; #2072/#2073 concern seed and budget integrity. None directly explains the three headline claims.                                |

## #2087: `inflationIndex` is P/Pbase, not CPI

### Confirmed

The headline metric is exactly a price-level ratio. `collectEconomyMetrics` reads each commodity's `globalPrice` and `basePrice`, forms `(globalPrice ?? basePrice) / basePrice`, and returns the unweighted arithmetic mean as `inflationIndex` ([`src/lib/sim/metrics.ts#L618-L632`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/sim/metrics.ts#L618-L632)). The metric's type comment also describes `priceVolatility` as the cross-sectional population standard deviation of `globalPrice / basePrice`, rather than a time series ([`src/lib/sim/metrics.ts#L156-L160`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/sim/metrics.ts#L156-L160)).

The simulation collector logs this field as `inflation` ([`scripts/sim/collectMetrics.ts#L55-L71`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/scripts/sim/collectMetrics.ts#L55-L71)), and the worldsim UI labels it “Inflation index” ([`src/app/singleplayer/worldsim/WorldsimPageClient.tsx#L141-L148`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/app/singleplayer/worldsim/WorldsimPageClient.tsx#L141-L148)). Therefore the issue is correct that the name and presentation invite a CPI interpretation that the implementation does not support.

This metric also aggregates the full commodity type list, which includes goods, services, and logistics ([`src/lib/constants/commodities.ts#L38-L67`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/constants/commodities.ts#L38-L67)). It is thus an unweighted all-commodity price-level signal, not a household consumption basket.

The player-facing household price index is a separate state path. Its module describes a CPI signal with sticky prices and advances HPI from an annual inflation input ([`src/lib/economy/householdPriceIndex.ts#L3-L19`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/economy/householdPriceIndex.ts#L3-L19), [`src/lib/economy/householdPriceIndex.ts#L21-L37`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/economy/householdPriceIndex.ts#L21-L37)).

### Refuted or qualified

The claim that the current CPI engine still uses the retired level-vs-frozen-base formula is not supported by the current source. The inflation recalculation comments distinguish the retired `avg(P_national / P_base - 1)` measure from the current median annualized price change ([`src/lib/turn/inflationRecalc.ts#L286-L306`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/inflationRecalc.ts#L286-L306)). The implementation takes a prior price snapshot, annualizes each commodity's change, clamps it, and takes the median ([`src/lib/turn/inflationRecalc.ts#L307-L330`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/inflationRecalc.ts#L307-L330)). The same design is documented in the budget inflation module ([`src/lib/budget/inflation.ts#L132-L165`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/inflation.ts#L132-L165)) and was the purpose of [PR #509](https://github.com/Egg3901/AHDGame/pull/509).

There is documentation drift worth fixing. `InflationInputs` still describes `commodityPressure` as `avg(P_national / P_base - 1)` ([`src/lib/budget/inflation.ts#L268-L294`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2)), while the caller calculates a median annualized change. Also, the recalculation comments refer to a one-game-year snapshot while the active lookback constant is `TURNS_PER_YEAR / 2` ([`src/lib/turn/inflationRecalc.ts#L40-L52`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2), [`src/lib/turn/inflationRecalc.ts#L192-L215`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2)). These do not change the confirmed metric identity, but they make the CPI path harder to audit.

The numerical divergences in the issue body, including the 1953 runs and live-world values, remain reported observations here rather than independently reproduced measurements. The code identity of `inflationIndex` is independently confirmed.

### Open questions and enhancement

The cleanest semantic separation would be to rename the current field to something like `commodityPriceLevelIndex` or expose separate fields for:

- the unweighted commodity `P/Pbase` level;
- annualized commodity price change;
- household CPI/inflation rate; and
- HPI.

That would preserve the useful scarcity/price-level diagnostic while preventing it from being presented as the same object that households experience. #2088 is directly related: scarcity drift can raise a persistent price level, while a CPI measure based on subsequent price changes can fall or flatten after the level has already reset upward.

## #2088: service D/S never closes and `scarcityMult` rails at 2.5

### Confirmed mechanics

The scarcity multiplier is explicitly stateful. The module documents the ordinary step as 0.4%, sets the multiplier range to 0.6 through 2.5, and reserves the hard endpoints for severe imbalance ([`src/lib/market/scarcityDrift.ts#L1-L41`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/market/scarcityDrift.ts#L1-L41), [`src/lib/market/scarcityDrift.ts#L44-L62`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/market/scarcityDrift.ts#L44-L62)).

`updateScarcityMultiplier` calculates unmet demand as `(demand - supply) / demand`. Above the 15% unmet threshold it moves toward a severity-scaled target, reaching 2.5 at 45% unmet demand. Inside the dead band it decays toward 1; surplus has a symmetric path ([`src/lib/market/scarcityDrift.ts#L78-L118`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/market/scarcityDrift.ts#L78-L118), [`src/lib/market/scarcityDrift.ts#L120-L142`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/market/scarcityDrift.ts#L120-L142)). A D/S of 2.2 or 2.9 is well into the severe region: the corresponding unmet shares are about 54.5% and 65.5%.

The multiplier feeds directly into the effective nominal base price before the market-price calculation ([`src/lib/market/globalCommodityPrice.ts#L10-L38`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/market/globalCommodityPrice.ts#L10-L38)). The turn pricing path computes the global scarcity multiplier from global supply and demand and persists supply, demand, and `scarcityMult` ([`src/lib/turn/commodity/pricing.ts#L145-L188`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/commodity/pricing.ts#L145-L188), [`src/lib/turn/commodity/pricing.ts#L394-L425`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/commodity/pricing.ts#L394-L425)). Thus the ticket is right that a persistent shortage can leave a lasting price-level component even after the per-turn drift stops increasing.

At a 0.4% relative step, moving from 1.21 to 2.5 takes roughly 182 steps if severe conditions persist. That is consistent with reaching the cap during a 240-turn run. This timing is an inference from the source constants, not a rerun of the issue jobs.

### Refuted or qualified

The ticket's precise “D/S > 1.15” trigger should be corrected. The implementation triggers on unmet share greater than 0.15, which is equivalent to:

```text
(D - S) / D > 0.15
D / S > 1 / 0.85 = 1.17647...
```

So D/S = 1.15 remains inside the dead band under the current code. The observed D/S values around 2 to 3 do trigger severe drift, so this threshold wording does not undermine the main rail observation.

The stronger “supply does not respond” conclusion is not established by source inspection. The plants-era supply code creates produced units from plants and unowned-sector headroom, while the unowned growth module explicitly grows plants headroom from GDP growth rather than from price or shortage ([`src/lib/constants/commodities.ts#L2142-L2205`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/constants/commodities.ts#L2142-L2205), [`src/lib/turn/unownedSectorGrowth.ts#L25-L60`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/unownedSectorGrowth.ts#L25-L60), [`src/lib/turn/unownedSectorGrowth.ts#L95-L165`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/unownedSectorGrowth.ts#L95-L165)). This is a weak macro feedback loop, but not proof of zero supply response.

There is also a shortage-aware NPP path. Entry decisions use shortage scores, market eligibility, logistics, and anti-glut gates ([`src/lib/turn/npp/nppCorporationBehavior.ts#L1253-L1311`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/npp/nppCorporationBehavior.ts#L1253-L1311)); shortage signals route NPP capital ([`src/lib/turn/npp/marketSignals.ts#L417-L465`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/npp/marketSignals.ts#L417-L465)). But it is rate-limited: cohort slots occur every eight turns and only one shortage entry can be founded per turn ([`src/lib/turn/npp/nppCorporationTuning.ts#L73-L102`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/turn/npp/nppCorporationTuning.ts#L73-L102)). Therefore the supported conclusion is “the available supply response may be too conditional or too slow to close these service shortages,” not “there is no response path.”

### Open questions and relationships

The reported service D/S tables were not independently reproduced. The next diagnostic should separate, per commodity and turn, owned-plant output, unowned headroom, reachable demand, cleared demand, entry rejection reason, and scarcity drift state. That would distinguish a missing supply path from a gate, unit mismatch, or demand-leg problem.

Relevant relationships:

- [#968](https://github.com/Egg3901/AHDGame/issues/968) is the broad market-completion and fragile-market umbrella; [#991](https://github.com/Egg3901/AHDGame/issues/991) specifically asks for entry-funnel reasons and coverage of empty state-sector cells.
- [#2054](https://github.com/Egg3901/AHDGame/issues/2054) and [PR #2066](https://github.com/Egg3901/AHDGame/pull/2066) may explain some clearing/fill failures through order-book versus lagged-supply units, but do not explain the 2.5 cap itself.
- [PR #365](https://github.com/Egg3901/AHDGame/pull/365) shows that plant-era demand calibration has previously caused large service-sector distortions. It supports checking demand calibration, but does not establish that the current code has the same defect.
- #2088 provides the mechanical explanation for #2087's persistent P/Pbase divergence: the level multiplier has memory, while the CPI path is rate-based.

## #2089: 1953 plants/full drives the UK to CCC by 1957

### Confirmed mechanics

The debt-rating ladder is currently era-blind. It assigns AAA through 60% debt/GDP, AA through 80%, A through 100%, BBB through 120%, BB through 150%, B through 250%, and CCC above 250%, with corresponding interest-rate and penalty schedules ([`src/lib/budget/debt.ts#L27-L89`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/debt.ts#L27-L89), [`src/lib/budget/debt.ts#L109-L149`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/debt.ts#L109-L149)). The boundary comparison is inclusive, so exactly 2.5 is still B; CCC begins above 2.5. The issue's reported 2.63 ratio is therefore in CCC, while wording should say “above 250%,” not “at 250%.”

Annual debt processing derives principal from the negative treasury balance, calculates the ratio against national GDP, recalculates the rating, and applies the new interest rate ([`src/lib/budget/debt.ts#L165-L209`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/debt.ts#L165-L209)). The same fiscal-state convention is used by the treasury-balance helper ([`src/lib/budget/treasuryBalance.ts#L8-L49`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/treasuryBalance.ts#L8-L49)). This supports the issue's concern that a high debt ratio rapidly reprices interest without an explicit 1953 or wartime-debt treatment.

### Seed inconsistency and qualified claim

The UK 1953 reference seed declares GDP of £14.4bn, debt principal of £26bn, a 4% interest rate, and `AAA` credit rating ([`src/lib/seeds/reference/budgets.ts#L3871-L3902`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/seeds/reference/budgets.ts#L3871-L3902)). The authored debt/GDP ratio is therefore about 1.81, which falls in the current B band, not AAA. The seed also initializes treasury balance as the negative debt principal ([`src/lib/seeds/reference/budgets.ts#L869-L925`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/seeds/reference/budgets.ts#L869-L925)).

The current development source is explicit about the transition: `normalizeDebtToGdpForRisk` returns the current ratio unchanged and retains `sovereignRiskAnchor` only for provenance/compatibility ([`src/lib/budget/debt.ts#L91-L107`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/debt.ts#L91-L107)). `calculateInterestRate` likewise uses the current ladder tier rather than rescaling from the anchor ([`src/lib/budget/debt.ts#L138-L149`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/debt.ts#L138-L149)). Unless the reported run used an older revision, the first risk resync should therefore replace the authored `AAA` with `B` before plants/full has done anything.

This confirms an important setup problem, but it does not by itself prove that the plants/full run's eventual UK deficit is caused only by the rating ladder. The issue's comparison still needs its exact source revision and first-resync turn pinned: the current development code and an older sim branch may not share this anchor behavior. Even if the plants/full run is correctly reproduced, the causal attribution remains open because GDP, public-enterprise flows, fiscal ordering, and debt-principal writers can all contribute.

The source does show plausible plants/full fiscal channels. Public-enterprise revenue estimates plant-era operating income using nameplate revenue, maintenance, amortized capital, and idle upkeep, and then rolls country-owned enterprise revenue into the budget ([`src/lib/budget/publicEnterpriseRevenue.ts#L193-L297`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/publicEnterpriseRevenue.ts#L193-L297), [`src/lib/budget/publicEnterpriseRevenue.ts#L374-L415`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/publicEnterpriseRevenue.ts#L374-L415), [`src/lib/budget/revenue.ts#L388-L419`](https://github.com/Egg3901/AHDGame/blob/ad16368fec7a45daa559cebafc138ff039ba43c2/src/lib/budget/revenue.ts#L388-L419)). Plants/full can therefore affect both production-side state and fiscal revenue/costs, but the direction and magnitude need an A/B trace.

### Refuted or clarified terminology

“Capital control” is ambiguous in this ticket. The compared worldsim posture is described as a capital tier in the issue, whereas exact-term hits for “capital control” primarily concern whether cross-border funds may buy sovereign issues: [#1001](https://github.com/Egg3901/AHDGame/issues/1001), [PR #1020](https://github.com/Egg3901/AHDGame/pull/1020), and [PR #1955](https://github.com/Egg3901/AHDGame/pull/1955). Those securities and eligibility mechanics should not be assumed to explain the `capital` versus `plants` worldsim comparison without tracing the job configuration.

The live-world comparison in the issue is not a clean counterfactual: it has a different horizon and a mixed human/NPP history. It is useful as a sanity check, not as causal evidence against the 1953 scenario by itself.

### Open questions and relationships

The minimum discriminating A/B should hold the 1953 UK seed fixed and vary only the worldsim posture. For each turn, capture:

- UK GDP denominator and GDP-growth signal;
- treasury balance, debt principal, interest rate, rating, revenue, spending, and surplus;
- public-enterprise remittance, plant capex, maintenance, and idle upkeep;
- NPP plant count, produced units, and capital allocation; and
- the exact turn when the seed's authored AAA rating is replaced.

This will show whether the first break is seed re-rating, an interest-rate step, a GDP denominator shift, a plants-era operating loss, or a debt-principal writer. [PR #2062](https://github.com/Egg3901/AHDGame/pull/2062) is especially relevant because it changes the debt principal source of truth. [#2056](https://github.com/Egg3901/AHDGame/issues/2056) and [PR #2064](https://github.com/Egg3901/AHDGame/pull/2064) are relevant because GDP-growth snapshot rollover can distort both growth and fiscal comparisons.

If the intended design is that 1953 wartime debt should not immediately imply modern distressed-market pricing, the likely policy choices are an era-aware rating schedule or an explicit wartime-debt transition/anchor. The seed inconsistency should be resolved before choosing between them.

## Cross-ticket interpretation

The three issues form a coherent chain, but not one single defect:

```text
scarcity drift and service imbalance (#2088)
                |
                v
high commodity P/Pbase level, including services
                |
                v
worldsim headline called inflation (#2087)
                |
                +--> differs from rate-based household CPI/HPI

plants/full posture (#2089)
                |
                +--> separate NPP, plant, GDP, and public-enterprise fiscal paths
                +--> debt ladder reprices from debt/GDP without era context
```

The strongest supported fixes are therefore semantic and diagnostic first: rename or split the #2087 metric, correct stale CPI documentation, correct the #2088 threshold wording, and add per-turn supply/entry/fiscal observability before changing economic formulas. The source supports a later design discussion about shortage-to-capacity feedback and era-aware sovereign risk, but this pass does not justify implementing either change without the discriminating runs above.
