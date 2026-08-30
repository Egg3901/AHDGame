export const nationalBudgetContent = `# National Budget

Each country maintains a federal budget that tracks revenue, spending, debt, and surplus. The budget updates continuously as corporations earn profits, players pay taxes, and legislation creates new spending obligations. Understanding the budget is essential for economic policymaking.

## Revenue sources

The federal budget collects revenue from several streams:

| Source | How it's set |
| --- | --- |
| Income tax | Rate set by legislation |
| Domestic corporate tax | Rate for corporations headquartered in this country |
| Foreign corporate tax | Rate for corporations headquartered elsewhere |
| Payroll tax | Rate set by legislation |
| Tariffs | Rate set by legislation; applied to imports |
| Sales tax | Rate set by legislation (default 0%) |
| Healthcare income | National healthcare corporations (e.g., NHS) |
| Other | Miscellaneous |

**Domestic vs. foreign corporate tax:** A US-headquartered corporation operating a sector in Germany pays Germany's **foreign** corporate tax rate on those profits. A German-headquartered corporation operating in Germany pays Germany's **domestic** rate. Both rates are set independently by legislation in each country.

Tax revenue scales with the tax base: the actual economic activity being taxed. Higher GDP, more corporate profits, and rising wages all expand the tax base, generating more revenue even at the same rates.

## Spending categories

Budget spending includes:
- **By category:** Discretionary spending buckets defined by enacted legislation
- **State grants:** Federal transfers to states
- **Debt interest:** Annual coupon payments on all outstanding sovereign bonds

Legislation that passes as law with a budget cost adds a permanent ongoing expenditure. The budget panel displays all active enacted laws with their cost models (₳X per person, Y% of GDP, etc.).

## Surplus and deficit

\`\`\`
surplus = revenue − spending
\`\`\`

Spending already includes debt interest, so it is not subtracted again. A **positive surplus** improves the national financial position over time. A **negative surplus** (deficit) means the government is spending more than it earns.

The **debt-to-GDP ratio** is the key solvency metric:
\`\`\`
debtToGdpRatio = totalPrincipal / GDP
\`\`\`

A sovereign credit rating from AAA to CCC reflects this ratio and affects borrowing costs:

| Debt-to-GDP risk band | Rating | Interest Rate | Corporate GDP drag | Public Trust Penalty |
| --- | --- | --- | --- | --- |
| ≤60% | AAA | 2.0% | 0 | 0 |
| ≤80% | AA | 2.5% | 0 | 0 |
| ≤100% | A | 3.5% | −0.1% | 0 |
| ≤120% | BBB | 5.0% | −0.2% | 0 |
| ≤150% | BB | 7.0% | −0.3% | −5 |
| ≤250% | B | 10.0% | −0.5% | −10 |
| >250% | CCC | 14.0% | −0.7% | −15 |

The engine normalizes the raw ratio against the country's seeded sovereign-risk anchor before choosing the tier. A country that begins with structurally high debt is therefore not forced straight into the raw-ratio tier on day one. Public-trust penalties apply at fiscal close; the GDP value is corporate margin drag applied in the per-turn economy, not a direct write to the printed GDP metric.

## National debt

Your national debt record tracks:
- **Principal:** Total outstanding sovereign bond debt
- **Interest rate:** Weighted average coupon on all active bonds
- **Debt ceiling / borrowing limit:** Most countries start from a fixed authored limit. East
  Germany's borrowing limit cannot fall below 40% of smoothed GDP, while any higher stored limit
  is still honored.

When the country runs a deficit, it issues sovereign bonds each quarter to cover the gap (see [Sovereign Bonds](/wiki/sovereign-bonds) for the mechanics). High debt has economic consequences for corporations:

| Debt-to-GDP | Corporate margin effect |
| --- | --- |
| Below 50% | None |
| 50% to 100% | −0.5% per 10 percentage points |
| Above 100% | −2.5% base + −1% per additional 10 pp (capped at −5%) |

## The fiscal year

The game runs on a **48-turn year** (1 turn = 1 game week). The fiscal year processing occurs at **turn 40** (October) and captures an annual budget snapshot:

- Revenue, spending, tax rates, and debt are frozen into a historical record
- The snapshot is used for year-over-year comparisons in the budget panel
- Fiscal year snapshots include all enacted laws active at that moment
- Tax bases already grow every turn by 1/48 of that turn's wage, trade, and GDP rates
- Fiscal close snapshots the budget and does not apply a second annual tax-base jump

## Debt ceiling crisis (US only)

When total sovereign debt principal exceeds the statutory **debt ceiling**, a crisis is triggered at fiscal year close. The crisis state is set to active but there is no automatic resolution path currently wired: it must be resolved by legislative action to raise the ceiling or eliminate the underlying deficit.

The crisis flag does not independently block sovereign bond issuance or apply additional penalties beyond those already imposed by the credit rating tiers. The real economic consequences of high debt (corporate margin penalties and public-trust penalties) are driven by the debt-to-GDP ratio and apply automatically every fiscal year, regardless of whether the statutory ceiling has been breached.

## IMF bailout austerity

When a country is under an **IMF sovereign bailout**, an automatic **austerity cap** applies during fiscal year processing. If spending exceeds revenue, all spending categories (including discretionary outlays, state grants, and debt interest) are scaled down proportionally to match revenue. The surplus is forced to zero (no deficit allowed while under IMF supervision).

## State budgets

Every state has its own budget alongside the federal budget. State revenue sources:
- State income tax
- State sales tax
- State domestic and foreign corporate tax
- Property tax
- Federal grants

State grants flow from the federal budget to state budgets each fiscal year. In the **US**, formula-grant programs (Medicaid, Highway Trust Fund, Education Block Grants, SNAP) are calculated and distributed automatically at fiscal year close. In the **UK** and **Japan**, regional grants are recalculated every turn through enacted legislation.

Each state budget also tracks an accumulated **balance** (the running total of surplus/deficit over time), which grows or shrinks with each fiscal year.

## How policy affects the budget

Bills that pass into law create permanent budget entries:

- **Tax rate bills** change the percentage collected on each revenue category, adjusting total revenue immediately
- **The UK Budget** bundles tax rates and statutory programme levels into one Commons confidence vote; it writes to the same fiscal ledger as ordinary Acts, and the era revenue cap compresses tax-like receipts only, with NHS receipts and public-enterprise income added after it
- **Spending bills** add to the ongoing expenditure, reducing surplus
- **Subsidy bills** create +7.5% corporate margin bonuses but add to spending
- **Tariff bills** generate tariff revenue but cause foreign corporations to face margin penalties

The budget shows the full list of enacted laws with their fiscal impact, so you can trace exactly which policies created the current surplus or deficit.

## Managing the budget (gameplay)

**Targeting a surplus:**
- Raise income tax, corporate tax, or tariff rates through legislation
- Cut discretionary spending categories
- Let the economy grow: rising GDP automatically expands the tax base

**Stimulating with deficits:**
- Cut tax rates to boost corporate margins and consumer spending
- Increase spending programs
- Issue bonds to borrow (quarterly issuance covers any deficit automatically)

**Debt reduction:**
- Run surpluses consistently: principal is reduced automatically by the surplus amount each fiscal year
- Raise taxes specifically to generate surplus that can retire bonds faster
- Note: deficit spending provides short-term stimulus (+0.5% corporate margins per 1% of GDP deficit, up to +5%), so fiscal restraint has costs

## Currency

Budget figures are stored in the country's native currency (USD for US, GBP for UK, JPY for Japan, EUR for Germany). Cross-country comparisons use the internal anchor unit.

See also: [National Metrics](/wiki/national-metrics), [Sovereign Bonds](/wiki/sovereign-bonds), [Central Banks](/wiki/central-banks), [Corporations](/wiki/corporations)
`;
