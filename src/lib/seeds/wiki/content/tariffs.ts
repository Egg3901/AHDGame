export const tariffsContent = `# Tariffs

Tariffs are trade barriers enacted through legislation that impose costs on corporations operating outside their home country. They affect corporate profit margins, market capture during sector competition, and how the three-tier commodity margin blend is weighted between global, national, and local conditions.

## What a tariff does

A tariff imposes a **margin penalty equal to half its rate** on every foreign corporation sector operating in the tariff-imposing country. A 25% tariff rate means a -12.5 percentage point margin modifier for affected sectors. The halving prevents high tariffs from instantly making foreign operations unviable while still making them meaningfully costly.

Tariffs also have two secondary effects:
- They shift the commodity margin blend from the global tier toward the national (country-aggregate) tier; the local (state) tier weight is unchanged.
- They alter the outcome odds when corporations fight for market share.

## Enacting a tariff

Tariffs are created through the [legislation system](/wiki/bills-legislation). A bill containing a \`tariff\` provision, when passed and enacted, creates or updates a tariff record for the specified scope and rate.

**Economy-wide tariff fiscal sync:** When an economy-wide tariff is enacted or updated, its rate is automatically synchronized to the federal budget's \`taxRates.tariffs\` field. This feeds the budget's tariff revenue projections (import value x tariff rate), while narrower tariff scopes affect margins and inflation through the corporate sector path only.

## Scope types

| Scope | Target | Example |
| --- | --- | --- |
| \`economy_wide\` | All foreign corporations in the country | "25% tariff on all imports" |
| \`sector\` | Foreign corporations of a specific sector type | "30% tariff on foreign steel producers" |
| \`origin_country\` | Corporations headquartered in a specific country | "40% tariff on German corporations" |
| \`corporation\` | A single named corporation | Targeted sanction on one entity |

Tariffs use a composite key (country, scope type, target sector, target origin country, target corporation). Re-enacting the same provision at a new rate updates the existing record rather than creating a duplicate.

## The territorial invariant

A tariff only applies to sectors **operating in the country that imposed it**. A US tariff on Chinese corporations does not affect Chinese sectors operating in Germany: it only affects Chinese sectors with operations inside the US. This is the critical invariant: tariff country must match sector operating country.

## Effective rate and stacking

The effective tariff rate for a sector is the sum of all applicable tariffs. Multiple tariffs stack additively:

| Active tariffs | Effective rate |
| --- | --- |
| 20% economy-wide | 20% |
| 15% sector (matching) | 15% |
| 20% economy-wide + 15% sector | 35% |
| 20% economy-wide + 10% origin-country | 30% |

The effective rate is capped at 100%.

**Domestic corporations pay no tariff.** Only foreign-headquartered corporations operating in the tariff country are subject to the penalty.

## Ending a tariff

There is no separate "end tariff" provision. To nullify an active tariff, pass a new bill containing a \`tariff\` provision on the **same scope** with \`rate: 0\`. The system upserts by composite key, so the new rate overwrites the old one. The tariff record is preserved for historical audit but no longer applies to margins or inflation.

## Foreign corporation margin penalty

Half the effective tariff rate is subtracted from a foreign corporation sector's profit margin:

| Effective rate | Foreign margin penalty |
| --- | --- |
| 0% | 0pp |
| 25% | -12.5pp |
| 50% | -25pp |
| 100% | -50pp |

A heavily tariffed sector may need exceptional margins from other modifiers to remain viable.

## Domestic corporation supply-chain malus

Broad tariffs create supply-chain friction that also affects domestic corporations, but the penalty is far smaller and only applies to economy-wide and sector tariffs (not origin-country or corporation-specific ones):

| Economy-wide + sector tariff total | Domestic malus |
| --- | --- |
| 0% | 0pp |
| 25% | -2.5pp |
| 50% | -5pp |
| 100% | -10pp |

The formula: domestic malus = -(combined rate / 100) × 10pp, capped at -10pp. This represents the cost of restricted access to cheaper foreign inputs, without punishing domestic firms as heavily as the tariff hits foreign ones.

## Commodity blend weight shift

The commodity margin modifier blends three tiers: global, national (country-aggregate), and local (state-level). With no tariff pressure the weights are **50% global / 25% national / 25% local**. Tariffs shift weight from the **global** leg to the **national** leg: the local weight stays fixed at 25%. The shift is linear in the effective tariff rate, summing across every tariff layer that touches the (sector country, sector type) pair:

| Effective tariff rate | Global weight | National weight | Local weight |
| --- | --- | --- | --- |
| 0% | 50% | 25% | 25% |
| 25% | 43.75% | 31.25% | 25% |
| 50% | 37.5% | 37.5% | 25% |
| 100% | 25% | 50% | 25% |

In a high-tariff environment, a sector's margins become more sensitive to country-level supply chains and less tied to global commodity conditions, while local conditions retain a constant minority weight. This is separate from the **price** blend, which is fixed at 50% global / 25% national / 25% regional regardless of tariff rate. Origin-country and corporation-specific tariffs only contribute to this shift when the targeted entities actually have a sector presence in the country.

## Market capture effects

Tariffs affect the outcome when corporations fight for market share through sector split attacks. The effective tariff rate grants a bonus to domestic attackers and a penalty to foreign ones:

| Effective rate | Domestic attacker multiplier | Foreign attacker multiplier |
| --- | --- | --- |
| 0% | 1.0× | 1.0× |
| 25% | 1.125× | 0.875× |
| 50% | 1.25× | 0.75× |
| 100% | 1.5× | 0.5× |

A 50% tariff rate means a domestic corporation has a 25% better chance of winning market share, while a foreign competitor has a 25% worse chance. This effect only applies during active split attacks: it does not affect normal sector operation.

## Inflation impact

Tariffs feed into **cost-push inflation** (prices rising because it costs more to make things, not because demand went up). Each turn, the system collapses all active tariff layers into a single macro pressure number (0 to 100) using the same revenue-weighted exposure model as the commodity blend. Economy-wide tariffs count at full rate; narrower scopes count in proportion to the share of domestic sector revenue they touch. FTA coverage scales the contribution the same way it scales the domestic malus and blend tilt. The resulting pressure is compared against a **3% baseline**: pressure above baseline adds to inflation, pressure below is mildly deflationary.

## Market sentiment

When a **sector tariff** is enacted, the market reacts with paired sentiment pulses:

- **Domestic boost:** +7% sentiment multiplier for corporations HQ'd in the tariff country
- **Foreign penalty:** -7% sentiment multiplier for foreign corporations operating in the tariff country

Sentiment pulses decay at rate **0.82 per 15-minute interval** and are subject to the global sentiment cap of **±25%**. Individual pulses are also clamped to **±12%** at insertion time, so even an exceptionally large tariff announcement cannot deposit a pulse beyond that bound. Only **sector-scope** tariffs emit sentiment pulses. Economy-wide, origin-country, and corporation-specific tariffs do not, because their effects are too diffuse or too narrow to register as a market-wide sentiment event.

When an FTA is **rescinded**, every active sector tariff in the affected countries deposits a fresh **foreign-side** sentiment pulse (-7%), modelling the restored exposure. Domestic-side pulses are not re-fired on rescission because domestic corporations' situation is unchanged: they had nominal protection before and still have it.

## Free trade agreements

Active free trade agreements (FTAs), passed in any international organization both countries belong to, change five things at once for sectors operated by corporations whose HQ is in a partner country.

**1. Per-corp tariff override (full):** The effective tariff rate between FTA partners collapses to **zero**, bypassing every tariff layer (economy-wide, sector, origin-country, corporation-specific). A corporation HQ'd in an FTA partner pays nothing on its sectors operating in the partner country, even if a 100% economy-wide tariff is on the books.

**2. Domestic supply-chain malus (proportional):** The malus that broad tariffs impose on **domestic** corporations scales down by the FTA partner's share of foreign trade in the country (for economy-wide tariffs) or in the matching sector type (for sector tariffs). If FTA partners account for 40% of foreign-corp revenue in the country, an economy-wide tariff contributes only 60% of its rate to the domestic malus. A country whose foreign-corp footprint is fully FTA-covered pays no domestic friction from broad tariffs at all.

**3. Commodity blend tilt (proportional):** The same per-layer scaling applies to the global → national blend shift. Origin-country tariffs aimed at an FTA partner contribute zero to the tilt; corporation-specific tariffs aimed at a corp HQ'd in an FTA partner do too.

**4. Inflation pressure (proportional):** Broad tariff layers (economy-wide, sector) contribute to consumer-price inflation only in proportion to non-FTA foreign exposure; narrow tariffs (origin-country, corporation) targeted at FTA partners contribute nothing. A 45% sector tariff in a country where 100% of that sector's foreign supply comes from FTA partners adds **zero** to inflation, since the goods cross the border tariff-free.

**5. Foreign-side market sentiment (binary):** When a tariff bill is enacted, the negative sentiment pulse it deposits against foreign-HQ'd corps in the targeted sector skips corps headquartered in any FTA partner of the issuing country. Domestic-side sentiment boosts (for HQs inside the issuer) still fire: the announcement effect is real even when the policy doesn't actually hit the partnered exporters. Symmetrically, when an FTA is **rescinded**, every signed sector tariff in the affected countries deposits a fresh foreign-side sentiment pulse so the market reacts to the restored exposure (the original enactment pulse decayed weeks earlier, so a state-only re-derivation would miss the shock entirely).

FTAs are stored as organization-level legislation (not country-level tariffs), so they outlive cabinet changes that don't disturb the underlying organization vote. Effects on **non-partner foreign corps** are unaffected: only the share of trade actually covered by the agreement is relieved.

## Combining tariffs and subsidies

Tariffs and [subsidies](/wiki/subsidies) are complementary tools for industrial policy:

- **Subsidies** give qualifying corporations +7.5pp per subsidy. Two distinct subsidy records can stack to +15pp.
- **Tariffs** give foreign corporations a margin penalty equal to half the tariff rate, while domestic corps pay the smaller supply-chain malus described above.

A 25% economy-wide tariff plus one +7.5pp subsidy creates a 15pp swing before
other modifiers: foreign sectors take −12.5pp from the tariff, while domestic
sectors net +5pp after the subsidy and −2.5pp domestic malus. A second distinct
subsidy can add another +7.5pp.

## Viewing active tariffs

Active tariffs are visible in the national Congress view and in the legislation history for the enacting bill. Each tariff shows its scope type, target, and rate, along with the enacting bill.

## Related systems

- **[Subsidies](/wiki/subsidies)**: the counterpart to tariffs: margin bonuses for qualifying domestic (or all) corporations
- **[Bills & Legislation](/wiki/bills-legislation)**: how tariff provisions get enacted into law
- **[Corporations](/wiki/corporations)**: how profit margins and market capture work for sectors
- **[Commodities](/wiki/commodities)**: how commodity blend weights affect sector margins
`;
