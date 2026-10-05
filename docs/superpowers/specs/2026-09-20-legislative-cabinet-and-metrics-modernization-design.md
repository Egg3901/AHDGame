# Legislative, Cabinet, and Metrics Modernization - Design

**Date:** 2026-09-20

**Status:** Approved for staged implementation after the US public-health proof gate. Gate 1 was
set to `generalize` by the project owner on 2026-09-21. Balance constants still require the
simulation evidence defined in this document.

**Branch:** `update/legislative-balance-modernization` (worktree based on `origin/development` at `ef5698b8b7`)

## Decision summary

### Player loop

The proposed player loop is:

1. **Choose a policy regime and jurisdiction.** A bill states what government will do, which
   level of government is responsible, and which existing regime it replaces or conflicts with.
2. **Enact authorization.** The law permits or requires a program, transfer, regulation, or
   institutional change. Enactment alone does not promise maximum delivery.
3. **Provide budget authority.** A national appropriation supplies a department with authority;
   an affordable regional law automatically creates its regional spending line.
4. **Set departmental priorities.** A Cabinet controller allocates only the flexible authority
   left after protected obligations, encumbrances, and maintenance.
5. **Deliver through capacity.** Funding, operational throughput, coverage, and ramp time
   determine delivery. Capacity is a visible bottleneck, not a second currency.
6. **Observe outcomes and political response.** Canonical outcomes change from delivered work;
   approval and political metrics respond to the policy and its results.
7. **Maintain, amend, or repeal.** Replacement and repeal stop new authority but preserve valid
   obligations, completed assets, arrears, and wind-down costs.

### Approval requested now

Reviewers are asked to approve or reject these decisions before implementation:

- persistent department accounts are owned by institutions, not officeholders;
- authorization, appropriation, obligation, outlay, delivery, and outcome are distinct states;
- the enacted national budget is the authoritative source of spending authority, while policy
  legislation is the authoritative source of program authorization;
- the compatibility slice may treat the existing enacted-law healthcare line as an included
  appropriation so current fiscal behavior is preserved without double charging;
- protected obligations settle through a fixed priority waterfall before ministers allocate
  discretionary authority;
- administrative capacity is workload-specific throughput derived from staff, facilities,
  systems, and efficiency, not a generic pool of spendable points;
- regional laws remain enacted after a revenue shock and follow the explicit underfunding
  waterfall defined below;
- the US public-health vertical slice is a mandatory go/no-go gate before the architecture is
  generalized across departments, regional finance, the UK, or Japan.

### Difficult-to-reverse architectural choices

These choices deliberately receive validation in the vertical slice because changing them later
would rewrite storage, UI, rules, and migrations:

| Choice | Why it is difficult to reverse |
|---|---|
| Stable portfolio ids with era-specific department resolution | Every law, program, account, and UI read model depends on ownership identity |
| Department-owned financial accounts | Officeholder-owned balances cannot survive reshuffles or mergers safely |
| National budget as authority source and department accounts as sub-ledgers | The opposite model creates duplicate treasury charges and incompatible fiscal histories |
| Explicit obligation priority classes | Allocation, arrears, repeal, and AI behavior all depend on settlement order |
| Typed operational capacity | A single abstract currency would become embedded in every program formula and interface |
| One authoritative metric owner with derived readouts | Duplicate writable metrics make later reconciliation and balancing unreliable |
| Portable plain-data rules core | Server-only rules would have to be rewritten for simulation and future hosts |

### Proof gate

The first implementation is only the vertical slice specified in the next section. It must prove
exact fiscal reconciliation, understandable allocation, capacity-limited delivery, repeal and
wind-down, one visible outcome, turn-engine portability, and a minimal explanatory UI.

Until that gate passes:

- do not add generic accounts for every Cabinet position;
- do not migrate Defense or intelligence onto the new storage model;
- do not implement regional grant transfers or regional-discretion behavior;
- do not rebalance the complete US law catalog;
- do not generalize the system to the UK or Japan;
- do not retire or combine production metrics outside the slice's explicitly traced outcome.

### Deferred decisions

The proof does not select final costs, effect magnitudes, carryover caps, country parity content,
AI ideology weights, or capacity calibration. Those remain simulation-backed decisions. The
slice may use fixed test fixtures and illustrative numbers to expose ambiguity, but those
numbers are not production balance approval.

## Vertical slice: US Public Health Workforce Expansion

### Selection

The proof case is the existing `Public Health Workforce Expansion Act`, option
`public_health_opt_1` of legislation type `us_public_health` (`Public Health Protection Act`).

Repository inspection shows that this option already provides a compact but meaningful seam:

- the law is in the US healthcare domain and currently feeds the national healthcare budget
  category;
- it has an authored annual cost of 93 currency units per resident;
- its primary outcome is `healthcare.publicHealthPreparedness`;
- its content names the federal public-health workforce, disease research, and infrastructure;
- its durable portfolio is `health`, resolved to the Department of Health, Education, and
  Welfare before the education split and the Department of Health and Human Services after it;
- its Cabinet controller is the existing `secretary_of_health` position;
- it can demonstrate nationwide delivery without introducing regional Cabinet accounts.

The current state-scoped preparedness target remains available for geographic display. During
the slice, the federal program owns one national implementation record and distributes delivered
coverage into state readouts without moving money into regional treasuries. Grant finance and
independent state co-funding remain out of scope.

### Slice metadata

The implementation issue should freeze the following metadata for the experiment:

```ts
const publicHealthWorkforceSlice = {
  legislationTypeId: "us_public_health",
  policyOptionId: "public_health_opt_1",
  primaryPortfolioId: "health",
  primaryDepartmentId: "us_health_department", // era-resolved display name
  lawKind: "service_program",
  implementationMode: "direct",
  jurisdictionMode: "national_direct",
  appropriationClass: "operating",
  fundingSemantics: "appropriation_included", // compatibility behavior for this slice
  capacityType: "public_health_operations",
  primaryOutcome: "healthcare.publicHealthPreparedness",
} as const;
```

The exact department id may change during the implementation issue if an existing stable id is
already canonical. The law and portfolio ids must not change merely to fit the slice.

### In-scope implementation

The vertical slice includes only:

- a health department definition and one persistent operating account;
- one authorization and one program allocation for `public_health_opt_1`;
- a compatibility adapter that converts the law's existing healthcare spending contribution
  into department authority without charging the treasury again;
- one typed capacity input, `public_health_operations`;
- one implementation record with funding, capacity, coverage, and ramp ratios;
- one delivered outcome path into `publicHealthPreparedness` and its already-defined derived
  consumers;
- a contributor inventory for `publicHealthPreparedness` so independent Cabinet orders, estates,
  corporation signals, baselines, and other lawful sources remain distinguishable from the
  migrated legislation contribution;
- one settlement phase on the turn path using portable rules;
- one minimal department view showing authority, available funds, obligations, outlays,
  capacity demand, implementation status, and the resulting outcome explanation;
- repeal and wind-down for this program;
- officeholder replacement without loss of the department account;
- a feature flag and deterministic fallback to the current effect path.

It excludes other health laws, other departments, regional accounts, federal grants, department
mergers, Cabinet capital projects, general metric migration, UK/JP content, and generalized NPP
allocation behavior.

### Illustrative settlement example

The example uses a deliberately round fixture population of 100 million residents. It tests the
rules; it does not set production balance.

1. The existing option price of 93 per resident produces **9.3 billion** of annual authorized
   program demand.
2. The enacted budget supplies **6.975 billion** of health-department authority, or a
   `fundingRatio` of **0.75**.
3. Existing public-health operations can process **80%** of the program workload, producing a
   `capacityRatio` of **0.80**.
4. Nationwide eligibility gives `coverageRatio = 1.00`; first-period mobilization gives
   `rampFactor = 0.50`.
5. The implementation factor is therefore `0.75 × 0.80 × 1.00 × 0.50 = 0.30`. The program
   produces 30% of its full scheduled preparedness movement in that period.
6. Of the 6.975 billion accrued to the department, the fixture outlays **5.0 billion**,
   encumbers **1.5 billion**, and leaves **0.475 billion** available. The three figures reconcile
   exactly to accrued authority.
7. The sovereign treasury records the 6.975 billion healthcare charge once. Department accrual
   records the same amount as a sub-ledger entry and never creates another charge.

If the program is repealed after the settlement, it accepts no new obligations. The existing
1.5 billion encumbrance remains payable, the 0.475 billion unobligated balance follows the
account's lapse rule, and delivered preparedness winds down according to the program's ramp-down
profile rather than resetting instantly.

### Required experiment matrix

The slice must run these deterministic cases through the same rules used by the turn engine:

| Case | Funding | Capacity | Expected proof |
|---|---:|---:|---|
| Fully funded baseline | 100% | 100% | Full delivery after ramp; exact reconciliation |
| Appropriation shortfall | 50% | 100% | Delivery is funding-limited; no overdraft or free outcome |
| Workforce bottleneck | 100% | 50% | Delivery is capacity-limited; unspent authority remains governed by account policy |
| Dual bottleneck | 50% | 50% | Factors combine once; no duplicate penalty or metric write |
| Officeholder turnover | 100% | 100% | Controller changes; account, obligations, and implementation continue |
| Repeal with encumbrance | Any | Any | New obligations stop; valid commitments and wind-down remain |
| Feature flag off | Any | Any | Current fiscal and effect behavior remains deterministic |

### Acceptance gate

Generalization may proceed only when all of the following are demonstrated:

1. national spending, department accrual, available funds, encumbrances, outlays, and arrears
   reconcile to the cent for every fixture;
2. repeating settlement for the same turn is idempotent;
3. insufficient funding and insufficient capacity are separately visible and produce different
   player explanations;
4. the outcome changes only through the delivered implementation path, with no surviving legacy
   direct write for the migrated option;
5. repeal preserves valid obligations and produces a deterministic wind-down;
6. replacing the health secretary does not move, duplicate, or erase public money;
7. the minimal UI can explain why the program delivered its current result;
8. the server turn and headless harness produce byte-for-byte equivalent settlements from the
   same inputs;
9. the turn phase stays within an approved round-trip and projected-read budget;
10. the test database run against `MONGODB_URI` uses an isolated fixture world, records the
    before/after reconciliation, and leaves unrelated worlds unchanged;
11. a reviewer explicitly chooses **generalize**, **revise and rerun**, or **stop** after reading
    the slice report.

## Detailed proposal summary

The current legislation catalogs allow many nominally opposing policy options to be
maximized at the same time because laws commonly act as independent metric improvements.
Some combinations are legitimately compatible. Others should conflict because they select
different legal regimes, compete for the same money or administrative capacity, or assign
responsibility to different levels of government. The game does not model those distinctions
consistently today.

This design introduces four connected layers:

1. **Policy and jurisdiction:** a law selects a policy regime, an intensity, and, where
   appropriate, which level of government is responsible.
2. **Authorization and funding:** enactment authorizes a program or rule. National spending
   programs are implemented through persistent departments and their appropriations.
3. **Delivery:** funded departments convert mandates, money, capacity, and time into outcomes.
   States and regions use an intentionally simpler automatic implementation path.
4. **Metrics:** laws target a rationalized set of policy axes, outcomes, and system facts.
   Duplicate or derived metrics no longer receive independent direct boosts.

Cabinet members become controllers of persistent departments rather than owners of settings.
Department accounts belong to the government institution and survive appointments,
reshuffles, and elections. Defense and intelligence appropriations are the existing model to
generalize, not systems to replace with incompatible behavior.

The initial content pass covers the United States, United Kingdom, and Japan. Parity means
equivalent gameplay coverage and meaningful choices, not identical law counts, ministries,
or constitutional powers.

## Problem statement

### Laws are too close to independent metric buttons

`LegislationPolicyOption` currently contains ideological stance, an effect direction, optional
direct per-turn metric effects, and cost fields. `LegislationType` supplies one or more metric
targets. Legacy enactment can also apply a fixed signed delta directly when the bill becomes
law (`applyLegislationEffect` and `getLegislationEffectDelta`).

The active-law system replaces earlier enactments of the same legislation type, but it has no
general cross-type incompatibility model. Two different types can therefore remain active and
improve separate metrics even when they represent competing delivery systems or demands on the
same institution.

The new model must not manufacture penalties solely because options have different ideological
labels. It must represent concrete conflicts:

- mutually exclusive legal regimes;
- preemption or devolution of authority;
- a finite appropriation;
- a finite implementation workforce;
- shared physical capacity;
- incompatible operating rules;
- continuing contracts and wind-down costs.

Compatible outcomes may remain compatible. Universal access and system efficiency, for
example, are not automatically opposites. Whether both can be achieved should depend on policy
design, resources, capacity, and execution rather than a left/right zero-sum rule.

### Cabinet settings are not full institutions

`UnifiedCabinetMember` represents an appointment and its ministerial action pool.
`CabinetSetting` stores policy tiers, targets, and allocation percentages. The allocation route
validates that percentages total 100 and persists them, but the percentages do not transfer,
reserve, encumber, or spend money.

Defense and intelligence are different. Their balances are real budget sub-ledgers:

- defense accrues from the enacted defense line, funds upkeep and procurement, tracks arrears,
  and reserves money for live contracts;
- intelligence accrues from the enacted intelligence line, pays network upkeep and operations,
  and stops activity when it cannot pay;
- both are sub-ledgers of spending already charged through the national budget and must not
  charge the treasury a second time.

The Cabinet redesign generalizes this pattern while preserving the different account policies.

The repository also already has persistent Cabinet estates, energy plants, and infrastructure
projects. They use read-only discretionary envelopes derived from enacted spending, baselines,
or GDP fallbacks. Their upkeep does not currently withdraw real money; it applies modeled
pressure to a budget-balance metric. Those systems are part of this redesign, not a separate
parallel mechanic. A full department account must eventually pay their capital and operating
costs directly.

### The metric model contains overlapping layers

The repository currently has several metric layers with intentionally different histories:

- `macroMetrics` owns objective economic, population, and fiscal working state for playable
  countries;
- legacy `stateMetrics` still defines a broad catalog of economic, service, social, governance,
  and country-specific measures;
- `politicalMetrics` defines 63 political families, seven per category, each currently modeled
  as `higherIsBetter: true` and flavored by country;
- budgets, corporations, military forces, demographics, and other systems are also sources of
  facts that appear again as named metrics or family indicators.

Some overlap is useful: an objective unemployment rate and a political judgment about worker
security are not the same thing. Other overlap creates duplicate targets or lets one law improve
the source fact, a derived outcome, and a political family independently.

The metric audit must distinguish intentional derivation from accidental duplication before
legislation effects are rebalanced.

## Goals

1. Give every ordinary law an explicit policy family, jurisdiction rule, administering
   portfolio, implementation mode, and fiscal classification.
2. Make national departments persistent institutions with real appropriation accounts,
   programs, obligations, capacity, and delivery results.
3. Preserve the Cabinet member as the political controller while ensuring public money and
   obligations survive a change of officeholder.
4. Give states and regions meaningful legislation and budgets without introducing subnational
   Cabinet simulations.
5. Support federal choices such as direct national provision, minimum standards, grants,
   concurrent authority, and leaving a subject to states or regions.
6. Replace arbitrary cross-ideological stacking with legal, fiscal, administrative, and
   jurisdictional tradeoffs.
7. Establish a canonical metric vocabulary and migration map, including permission to combine,
   derive, rename, add, or retire metrics where the audit supports it.
8. Deliver comparable policy breadth and mechanical depth for the US, UK, and Japan while
   respecting their different institutions.
9. Keep all formulas and state transitions portable so the server turn, headless simulation,
   and future hosts use the same rules.

## Non-goals

- Simulating every civil-service agency, appropriation account, or real-world parliamentary
  procedure.
- Giving state or regional governments their own Cabinet roster.
- Making every political outcome zero-sum.
- Equalizing countries by giving them the same number of laws or identical department names.
- Assigning moral value to the `left`, `center`, or `right` stance labels.
- Choosing final costs, effect magnitudes, carryover caps, or capacity coefficients in this
  design. Those values require simulation evidence.
- Retrofitting every existing country in the first implementation series.
- Removing a metric before all writers, readers, histories, seeds, UI surfaces, and simulations
  have a documented replacement.

## Current-state inspection

### Catalog snapshot

The canonical seed export currently contains the following US, UK, and Japan rows:

| Country | Total types | Explicit national | Explicit state/region | Scope not explicit | Types with options | Types with a cost-bearing option |
|---|---:|---:|---:|---:|---:|---:|
| US | 68 | 28 | 27 | 13 | 68 | 49 |
| UK | 63 | 45 | 18 | 0 | 63 | 54 |
| JP | 64 | 51 | 0 | 13 | 64 | 54 |

The counts are an inventory, not a parity score. Several taxonomy mismatches require semantic
review:

- thirteen US types have neither `allowedScope` nor `nationalOnly`;
- thirteen Japan types lack explicit scope, including the resident-tax and fixed-asset-tax rows
  and eleven `jp_regional_*` rows;
- policy-domain labels differ (`economic` and `economy`, `publicSafety` and `law_justice`, and
  `government` and `governance`), so comparing domain counts directly produces false gaps;
- cost-field presence proves that a formula exists, not that its magnitude or fiscal behavior is
  balanced;
- UK and Japan each have one law marked as a central-to-regional grant, while the US catalog has
  none marked `isGrant`, despite extensive state-level content.

Scope normalization and domain normalization are prerequisites for a trustworthy parity report.

### Existing fiscal behavior

- National budget validation is warning-only. A national bill may increase debt or trigger a
  debt-ceiling crisis path but is not rejected for unaffordability.
- State budget validation is a hard enactment gate. A governor cannot sign a bill whose annual
  cost exceeds state revenue plus balance.
- Enacted-law costs are folded into national or state spending and recomputed from active laws.
- Regional budget processors already aggregate enacted-law costs and track surplus and
  over-budget state.
- Grant laws can route national cost into the central state-grants line and store a regional
  distribution.

The proposed regional automatic-funding rule therefore extends the existing state hard gate. It
does not introduce a second regional Cabinet or a second approval process.

### Existing effect behavior

There are multiple effect paths:

- a legacy enactment-time fixed metric delta;
- active-law decay toward metric targets;
- per-turn `metricEffects` on policy options;
- political-board residuals;
- direct subsystem provisions for taxes, subsidies, nationalization, unions, war,
  international organizations, and department creation.

The redesign must inventory all paths by effect class. Moving only the most visible path would
leave duplicate effects or bypass the new funding model.

## Design principles and invariants

1. **One fact has one authoritative owner.** Other metrics may derive from it but do not store
   an independently writable copy without a documented reason.
2. **Authorization is not appropriation.** A law may be valid while its program is unfunded or
   partially funded.
3. **Appropriation is not outlay.** Money can be available, committed, and paid at different
   times.
4. **National accounts are institutional.** Appointing or removing a minister never transfers
   public money to or from that character.
5. **Regional implementation is automatic.** If a state or region can afford a law at
   enactment, its government is assumed to fund and administer it without Cabinet controls.
6. **No double charge.** Departmental accrual is a sub-ledger of national spending already
   charged to the treasury unless a specifically modeled overdraft creates new borrowing.
7. **One accountable owner.** Cross-department laws may have supporting portfolios, but one
   primary portfolio owns implementation status and reporting.
8. **Stable policy identity, era-specific institution.** Laws point to durable portfolios;
   country and era maps resolve those portfolios to the ministry or department that currently
   exists.
9. **Conflicts describe mechanisms.** Exclusivity is attached to a policy regime or legal rule,
   never inferred from political stance.
10. **Effects follow delivery.** Except for immediate legal toggles, outcomes respond to funded
    implementation, capacity, coverage, and time.
11. **Parity is capability parity.** Each country needs meaningful choices across the shared
    audit matrix, not identical catalogs.
12. **Turn work is batched.** National department settlement loads one national budget and the
    active program set, then writes with a bounded bulk or guarded atomic update. It does not
    query once per law or department.

## Foundational domain rules

These rules are part of the proposed domain model, not balance constants. The vertical slice
must implement them directly rather than leaving them implicit in schema or UI work.

### Source of authorization and spending authority

- **Policy legislation** is the authoritative source of authorization, program design,
  eligibility, jurisdiction, and transition rules.
- **The enacted national budget or appropriation** is the authoritative source of annual
  spending authority.
- **Department accounts** are control sub-ledgers of that authority. They may reserve, obligate,
  outlay, lapse, or carry authority according to account policy, but they do not create a second
  sovereign expense.
- **Standing mandatory programs** calculate authority through their enacted formula during
  budget settlement. The formula is still represented in the enacted budget before department
  accrual.
- **Compatibility rule:** while existing cost-bearing laws still feed
  `FederalSpending.byCategory`, a migrated `appropriation_included` option may use that resolved
  spending contribution as both authorization and budget authority. This is a bridge, not the
  final authoring model. It must still accrue once and charge the treasury once.
- **Target state:** a missing or zero appropriation means the authorized program is unfunded. No
  GDP fallback, minimum allowance, or requested-cost sum silently manufactures authority.

### Department obligation priority

Department settlement uses the following protected tiers:

1. court-ordered payments, legally accrued entitlements, and recorded arrears;
2. valid existing encumbrances and contractual obligations;
3. safety-critical and minimum-maintenance costs for operating assets and services;
4. current-period mandatory or demand-led program payments;
5. continuity funding for already-operational discretionary programs;
6. newly authorized initiatives and program expansions;
7. optional reserve accumulation, capital acceleration, and other ministerial priorities.

Within a tier, a program-specific statute or account policy may define ordering or proportional
allocation. Without such a rule, shortfalls are distributed pro rata within the tier. A minister
may choose among items in the same discretionary tier but cannot starve a protected higher tier
to fund a lower one. An emergency authority may override the order only when its legal source,
limit, and treasury effect are recorded explicitly.

### Administrative capacity

Capacity is not money, action points, or a universal civil-service pool. It is typed operational
throughput:

```ts
interface CapacityPool {
  capacityType: string;
  availableThroughput: number;
  maintenanceDemand: number;
  programDemand: Record<string, number>;
  sourceBreakdown: {
    workforce: number;
    facilities: number;
    systems: number;
    efficiency: number;
  };
}
```

Programs declare demand in one or more named types, such as
`public_health_operations`, `benefits_administration`, `inspection`, or
`capital_delivery`. The rules calculate a ratio between maintained throughput and total demand.
Money can hire staff, build systems, or maintain facilities, but cannot convert instantly into
capacity. Capacity additions have a ramp, ongoing maintenance, and an auditable source. The UI
must show the binding type, demand, available throughput, and queue or coverage consequence.

Exact units and coefficients are balance decisions. The type system, source breakdown,
maintenance requirement, and non-instant conversion rule are architectural decisions.

### Regional underfunding after enactment

A regional law that later becomes unaffordable remains legally active. Each regional settlement
uses this waterfall:

1. apply unrestricted national grants and earmarked transfers to their authorized uses;
2. pay legally accrued entitlements, judgments, and recorded arrears;
3. honor valid existing contracts and capital encumbrances;
4. fund safety-critical and minimum-maintenance requirements;
5. fund mandatory current-period services;
6. fund continuing discretionary services;
7. fund new expansions and optional initiatives.

Shortfalls within the same tier are pro rata unless the law defines a different formula.
Nonpayment creates arrears only for legal or contractual obligations that survive the missed
payment. Discretionary shortfalls reduce that period's `fundingRatio`; they do not manufacture
arrears. Capital work slows or pauses when its funded draw is unavailable. Delivered effects
scale from actual payment and capacity, while immediate legal rules remain in force.

The player sees the continuing law, required spending, actual spending, shortfall, arrears,
delivery ratio, and affected outcome. Repeal requires the ordinary legislative process and
still honors valid wind-down obligations.

## Metric rationalization

### Canonical metric classes

Every metric or indicator will be classified as exactly one of the following:

| Class | Meaning | Direct law target? | Examples |
|---|---|---|---|
| System fact | Authoritative measured state owned by another system | Usually no | debt, budget balance, force readiness, population |
| Outcome | A player-visible social, economic, or service result | Yes, through delivery | life expectancy, literacy, crime, air quality |
| Policy axis | A regime choice with no universal good direction | Yes | centralization, benefit universality, enforcement posture |
| Capacity | Ability to deliver programs | Indirectly | administrative capacity, hospital capacity, court throughput |
| Sentiment/judgment | A population or political response derived from facts and policy | Normally no | public trust, political-family support |
| Telemetry | Internal explanation or diagnostic state | No | labor demand, sector growth contribution |
| Flavor indicator | Country-specific presentation derived from canonical data | No independent write | named national programs or historical indices |

`higherIsBetter` is valid for outcomes with a clear direction. It is not valid for policy axes.
Political association remains descriptive and separate from quality.

### Audit method

The audit must generate a machine-readable registry with, for every current metric path:

- canonical id and display names;
- class;
- authoritative storage owner;
- value type, bounds, and direction where applicable;
- every writer and reader;
- approval and election consumers;
- legislation and Cabinet sources;
- history and chart consumers;
- country and era availability;
- replacement or derivation rule if retired;
- migration and compatibility alias.

The initial duplicate review should explicitly examine these families of overlap:

- poverty, mobility, inequality, and political `economy.mobility`;
- median income, cost of living, wage growth, and political household income;
- budget balance, debt-to-GDP, and political fiscal health;
- education spending, attainment, literacy, skills, and political education families;
- healthcare access, waiting times, mortality, life expectancy, and political health families;
- crime, violent crime, safety confidence, and political `order.safety`;
- air quality, emissions, energy reliability, and political environment families;
- transparency, corruption, trust, openness, and administrative capacity;
- housing supply, affordability, homelessness, rough sleeping, and country-specific housing
  variants.

An overlap does not automatically imply deletion. The audit chooses one of four outcomes:

1. **Keep independently:** the concepts are causally distinct.
2. **Derive:** retain the display but calculate it from canonical inputs.
3. **Alias and migrate:** two names represent the same state.
4. **Retire:** the value is redundant and adds no explanatory or gameplay value.

### Legislation effect rule

A law must not independently write both a source fact and a derived metric. Law metadata names
the intended policy axis, program output, or direct legal state. The metric rules core then
derives downstream outcomes and political judgments.

For example, a funded program may increase service capacity; capacity and other conditions
change a health outcome; voters react to the outcome and the policy regime. The law does not
also apply unrelated direct bonuses to all three layers.

### Japan coverage decision

`POLITICAL_METRIC_COUNTRY_IDS` currently includes the US, UK, RU, and DD, but not Japan. Before
the Japan law catalog is rebalanced, the design review must decide whether Japan joins the
political-board system or whether the board becomes country-generic with country flavor data.
Adding Japanese laws to a metric architecture that does not include Japan would create false
parity.

The recommended direction is a country-generic political board with country-specific names,
baselines, contributor weights, and era availability. That is a separate migration task and
must not be hidden inside seed edits.

## Institutional model

### Portfolio, department, and position are different identities

The design uses three layers:

- **Portfolio:** a durable policy responsibility such as health, finance, education, justice,
  environment, or foreign affairs. Laws reference portfolios.
- **Department:** the country- and era-specific institution that owns one or more portfolios and
  holds an account.
- **Cabinet position:** the office occupied by a character or NPP. A position may control a
  department, coordinate several departments, or have no spending department.

This prevents a ministry rename or reorganization from invalidating every law. A machinery-of-
government change updates the portfolio-to-department mapping and transfers the associated
programs, balances, obligations, and capacity.

### Department kinds

```ts
type DepartmentKind =
  | "spending_department"
  | "finance_ministry"
  | "executive_centre"
  | "coordinating_office"
  | "territorial_office"
  | "security_agency";
```

Not every Cabinet position receives a treasury bucket. Prime-ministerial deputies, chiefs of
staff, whips, first secretaries, and some territorial or coordinating offices may receive
orders and oversight tools without a general spending account. Conversely, an intelligence
agency can have an appropriation even when it is not a conventional ministry.

### Department definitions

Definitions remain code-owned, era-aware data alongside each country's Cabinet catalog:

```ts
interface DepartmentDefinition {
  id: string;
  countryId: CountryId;
  kind: DepartmentKind;
  name: string;
  portfolioIds: string[];
  controllingPositionIds: string[];
  activeFromYear: number;
  activeToYear?: number;
  accountPolicyId?: string;
}
```

The position resolver already handles era-gated seats. Department resolution must use the same
live country and era context rather than duplicating current-year assumptions.

## Law administration model

### New legislation metadata

Every ordinary policy type gains an administration block:

```ts
interface LawAdministration {
  primaryPortfolioId: string;
  supportingPortfolioIds?: string[];
  lawKind:
    | "regime"
    | "service_program"
    | "capital_program"
    | "transfer_program"
    | "revenue"
    | "regulation"
    | "constitutional"
    | "structural"
    | "emergency";
  implementationMode:
    | "direct"
    | "regulation"
    | "formula_grant"
    | "discretionary_grant"
    | "matching_grant"
    | "mandate"
    | "automatic_transfer";
  allowedJurisdictionModes: JurisdictionMode[];
  defaultJurisdictionMode: JurisdictionMode;
  appropriationClass?: "operating" | "capital" | "transfer" | "demand_led";
  fundingSemantics?:
    | "authorization_only"
    | "appropriation_included"
    | "standing_mandatory";
  capacityDemand?: Record<string, number>;
  rampProfileId?: string;
  maintenanceProfileId?: string;
  conflictSetIds?: string[];
}
```

Taxes, constitutional rules, declarations, and other specialized provisions may have an
administering portfolio without creating a spendable program. Existing direct subsystem
provisions remain specialized and are classified rather than forced through a generic metric
effect.

`fundingSemantics` prevents the target design from assuming that every cost-bearing law mints a
matching department balance:

- `authorization_only` creates permission or a mandate, but the department must receive funding
  through an appropriation or budget line;
- `appropriation_included` both authorizes the program and establishes its spending line;
- `standing_mandatory` establishes an automatically calculated entitlement or transfer that is
  paid before discretionary allocations.

During migration, an existing cost-bearing law that currently feeds
`FederalSpending.byCategory` is treated as `appropriation_included` unless the content audit
deliberately splits authorization from funding. This preserves live fiscal behavior while making
the distinction explicit for new and revised laws.

### Jurisdiction is a separate dimension from policy intensity

Policy substance and governmental responsibility must not be overloaded into one left-to-right
option ladder. A bill may select a substantive option and, only when the catalog allows it, a
jurisdiction mode:

```ts
type JurisdictionMode =
  | "national_direct"
  | "national_floor"
  | "concurrent"
  | "grant_supported_regional"
  | "regional_discretion";
```

- `national_direct`: the national department implements the program or rule.
- `national_floor`: the national government establishes a minimum; regions may go further where
  their catalog permits.
- `concurrent`: national and regional laws both contribute without double-counting the same
  delivery.
- `grant_supported_regional`: a national department funds some or all regional delivery.
- `regional_discretion`: the national government does not provide a substantive national
  program; each state or region may enact its own option.

The player-facing label for `regional_discretion` can be country-specific, including “Leave it
to the States” in the United States. Enacting it does not automatically pass or repeal a state
law. It changes the national rule and leaves each regional legislature responsible for its own
choice.

### Policy families and conflicts

The current “latest active law per type” rule remains. Cross-type conflicts add explicit policy
families and conflict sets:

- a replacement within one policy family supersedes the prior regime;
- a conflict set can refuse an incoherent bill, require a repeal provision, or schedule a
  transition;
- compatible laws in the same domain may coexist;
- stance is never used as the conflict predicate.

The proposal UI must explain the exact conflict and the law that would be replaced. A silent
effect cancellation is not acceptable.

## National appropriation model

### Account location

The recommended first implementation stores department accounts as a map on `FederalBudget`:

```ts
interface DepartmentAppropriation {
  departmentId: string;
  balance: number;
  encumbered: number;
  arrears: number;
  accruedThroughTurn: number;
  annualAuthority: number;
  operatingAuthority: number;
  capitalAuthority: number;
  transferAuthority: number;
  programAllocations: Record<string, ProgramAllocation>;
  accountPolicyId: string;
}

interface FederalBudget {
  // existing fields...
  departmentAppropriations?: Record<string, DepartmentAppropriation>;
}
```

Reasons for embedding the first version:

- defense and intelligence already live on the national budget;
- the treasury charge and sub-ledger accrual can remain in one atomic document;
- the turn can read one projected budget document rather than query once per department;
- national fiscal merger and country dissolution behavior remain centralized;
- fewer cross-document transactions reduce money-creation and double-charge risks.

Program histories or detailed contracts may remain in their owning subsystem. The budget map is
the financial control record, not an attempt to store all government activity in one document.

If document contention or size becomes material, a later design may move accounts into one
country-level government-finance document. A one-document-per-department collection is not the
default because it invites N+1 reads and cross-document transfer problems.

### Financial states

The UI and rules distinguish:

1. **Authorized:** law permits or requires the program.
2. **Appropriated:** the enacted budget supplies authority.
3. **Available:** accrued cash authority not yet committed.
4. **Encumbered:** committed to a contract, project, grant, or order.
5. **Outlaid:** actually paid.
6. **Arrears:** required payment not made.
7. **Delivered:** the funded activity converted into capacity or outcomes.

These are not interchangeable labels for one number.

### Account policies

Behavior is configured rather than copied:

```ts
interface DepartmentAccountPolicy {
  canOverdraft: boolean;
  usesEncumbrance: boolean;
  arrearsMode: "none" | "record" | "sovereign_overdraft";
  carryoverMode: "none" | "capped" | "full";
  lapseMode: "fiscal_year" | "program_end" | "never";
  emergencyAuthority: "none" | "executive" | "legislative";
}
```

Defense retains upkeep overdrafts, arrears, and procurement encumbrance. Intelligence retains
its stop-when-empty behavior. Civil departments use policies appropriate to their programs.
Final caps and overdraft parameters are balance constants and require simulation.

### Allocation and ministerial control

The protected obligation priority defined in **Foundational domain rules** settles before
discretionary allocation. The controlling minister allocates the remaining flexible envelope
among authorized programs and, where applicable, regions. Ministers may reorder or weight items
only within the same discretionary tier unless a later law grants explicit emergency authority.

Existing percentage settings can become an allocation-plan input, but the plan applies to real
available authority. It cannot allocate more than the department has and cannot spend another
department's balance.

A minister may build a departmental reserve by underspending where the account policy permits
carryover. The minister does not create money and does not own the reserve. Capital authority and
live encumbrances normally survive a fiscal close; operating carryover is policy-controlled.

### National budget relationship

The enacted national budget is the authoritative source of spending authority and the sovereign
treasury charge. During compatibility migration, the existing national spending calculation
continues to materialize that enacted authority. Departmental settlement divides the
already-enacted spending into institutional sub-ledgers. Only an allowed overdraft or a
separately authorized emergency transfer creates spending beyond the enacted line.

An account's `annualAuthority` comes from the resolved enacted spending line for its portfolios,
including explicit appropriation laws and standing mandatory spending. It is not automatically
set to the sum of every program's requested cost. Authorized program demand may therefore exceed
the department envelope, which makes prioritization and partial implementation meaningful.

The vertical slice uses only the existing healthcare line attributable to
`public_health_opt_1`; it must prove that the treasury charge and health-department accrual are
the same authority, recorded once in each role. Later compatibility adapters may resolve the
same category cascade used by current Defense, intelligence, infrastructure, and portfolio
envelopes. The target state removes GDP fallbacks and absolute minimum allowances once every
supported department has an authored appropriation source. A missing line must eventually mean
unfunded, not an invisible guessed budget.

National affordability remains capable of deficit finance. The new consequence is that passing
a program law does not guarantee immediate maximum delivery. Appropriation, departmental
priority, obligations, and capacity determine delivery even when the sovereign can borrow.

### Existing Cabinet assets and projects

Cabinet estates, energy plants, and infrastructure projects migrate from modeled envelope
pressure to real departmental finance:

- opening, building, and expanding an asset encumbers capital authority;
- construction draws down the encumbrance over its build turns;
- funding levels and ordinary upkeep debit operating authority;
- underfunded construction slows or pauses rather than receiving free progress;
- underfunded upkeep reduces condition, output, or reliability according to the asset rules;
- cancellation releases only unspent encumbrance and never refunds prior outlays;
- closure or decommissioning follows an explicit salvage and wind-down rule;
- project effects continue to flow through canonical capacity and outcome metrics rather than
  applying a second budget-balance proxy effect.

The existing `resolvePortfolioEnvelope` and `resolveInfraEnvelope` cascades are compatibility
inputs during migration. They are not the final source of spendable cash. Characterization tests
must pin current project construction, condition, and effect behavior before the payment source
changes.

## Program implementation and effects

### Implementation state

Each active national law with a delivery component receives an implementation record associated
with its enacted-law id:

```ts
interface LawImplementationState {
  enactedLawId: string;
  jurisdictionMode: JurisdictionMode;
  primaryDepartmentId?: string;
  status:
    | "legal_only"
    | "authorized"
    | "funded"
    | "partially_funded"
    | "implementing"
    | "operational"
    | "in_arrears"
    | "winding_down";
  fundingRatio: number;
  capacityRatio: number;
  coverageRatio: number;
  rampProgress: number;
  lastSettledTurn: number;
}
```

The exact persistence location is an implementation-plan decision after measuring active-law
counts and write contention. It may be a compact map within department accounts or fields on
`enactedLaws`; it must not require a query per law.

### Delivery formula

The portable rules core computes an implementation factor from plain inputs:

```text
implementationFactor =
  clamp(fundingRatio, 0, 1)
  * capacityFactor
  * coverageRatio
  * rampFactor
```

The resulting factor scales only effects classified as delivered outcomes. Immediate legal
state changes, tax-rate changes, bans, permissions, and constitutional rules use their own
explicit timing. A regulatory law may require administrative capacity but little program
spending. A capital law may spend for many turns before its outcome appears.

Capacity uses the typed throughput model in **Foundational domain rules**. It has a source,
maintenance demand, ramp, and program workload. Passing every program can therefore overload a
specific delivery function even when the treasury can borrow enough money. The rules and UI must
name the binding capacity type rather than report an unexplained generic capacity penalty.

### Repeal and transition

Repeal stops new authority according to the law's transition rule. It does not erase:

- completed capital assets;
- money already outlaid;
- valid outstanding contracts;
- legally accrued entitlements;
- wind-down and termination costs;
- durable demographic changes explicitly classified as permanent.

The implementation record enters `winding_down` until its obligations are resolved.

## State and regional implementation

States and regions do not receive Cabinet departments or ministerial allocation accounts.

### Enactment rule

1. The regional legislature passes a law through its existing lifecycle.
2. The existing budget validation prices the selected option.
3. If annual spending would exceed regional revenue plus balance, enactment is refused.
4. If affordable, the law becomes an automatic spending line in the regional budget.
5. The regional government is assumed to administer it at the configured ramp rate.

This preserves the current hard budget gate and avoids adding a shadow Cabinet simulation.

### Later revenue shocks

A law that was affordable when enacted is not automatically repealed if revenue later falls.
The regional budget applies the explicit underfunding waterfall in **Foundational domain rules**.
Legal or contractual nonpayment creates arrears; discretionary nonpayment reduces the current
funding ratio without manufacturing debt. Capital work slows or pauses. Delivered effects scale
from actual funded delivery, while immediate legal rules remain in force. The ordering itself is
a domain rule; the tier-specific coefficients and penalties are balance decisions for
simulation.

### National grants

When jurisdiction is `grant_supported_regional`:

- the national law and responsible department authorize the grant pool;
- the department encumbers and transfers actual funds;
- the transfer becomes regional revenue;
- each region's implementation remains automatic;
- matching grants also require the configured regional contribution;
- the same currency is never counted as both department balance and regional available cash.

Regional allocation percentages therefore become fiscal distribution plans rather than free
metric weights.

## US, UK, and Japan institutional profiles

The shared engine uses country-specific authority adapters and labels.

### United States

- Legislation points to stable portfolios resolved to era-appropriate departments or agencies.
- Congress supplies budget authority; executive departments obligate and outlay within that
  authority.
- State catalogs can operate under national floors, concurrent authority, grants, or regional
  discretion where the individual law permits.
- “Leave it to the States” is the US label for `regional_discretion`, not a universal option on
  every law.

The distinction among budget authority, obligations, and outlays follows the terminology in the
[GAO federal budget glossary](https://www.gao.gov/assets/a76916.html). The constitutional basis
for reserved powers is summarized by the
[Constitution Annotated, Tenth Amendment](https://constitution.congress.gov/constitution/amendment-10/).

### United Kingdom

- Departments distinguish resource, capital, and demand-led expenditure.
- Treasury controls and parliamentary Supply constrain departmental spending.
- Devolved or regional availability is cataloged by subject and era rather than inferred from a
  US-style federal rule.
- Territorial secretaries and central coordinating roles do not automatically become spending
  departments.

The fiscal adapter should reflect the distinction among departmental limits, annually managed
expenditure, resource, and capital described in the
[UK government planning and performance framework](https://www.gov.uk/government/publications/planning-and-performance-framework/the-governments-planning-and-performance-framework).
The jurisdiction catalog should be grounded in the government's
[devolution guidance](https://www.gov.uk/government/publications/devolution-guidance-for-civil-servants/devolution-guidance-for-civil-servants).

### Japan

- Ministries submit requests through the finance process; the Cabinet coordinates the draft;
  the Diet approves the budget.
- Prefectural and regional laws use the same automatic regional implementation model as other
  countries, with Japan-specific revenue fields and scope rules.
- Local authority is cataloged within national-law constraints rather than treated as identical
  to US reserved powers.
- Japan must be brought onto the canonical political-metric vocabulary before parity is signed
  off.

The budget adapter follows the sequence described by Japan's Ministry of Finance in its
[budget-process overview](https://www.mof.go.jp/english/policy/jgbs/publication/newsletter/jgb2023_09e.pdf).
The local-law boundary is grounded in Article 94 of the
[Constitution of Japan](https://japan.kantei.go.jp/constitution_and_government_of_japan/constitution_e.html).

## Parity framework

Parity review uses a coverage matrix, not raw counts. Each country is audited for:

- tax and revenue choices;
- labor and economic regulation;
- health and social protection;
- education and research;
- housing and infrastructure;
- public safety and justice;
- environment, energy, and land;
- immigration and integration;
- governance, rights, and information;
- defense, intelligence, and foreign affairs;
- national versus regional authority;
- direct provision, regulation, transfers, grants, and capital programs;
- both expansion and retrenchment paths;
- repeal, transition, and emergency choices;
- department ownership and measurable delivery;
- era availability.

A country may satisfy a row with a differently named or differently structured mechanic. A
missing row must be either filled or documented as institutionally inapplicable.

## Proposed country portfolio map

The content audit starts with shared portfolio identities and resolves them to current country
offices. This is a starting crosswalk, not final seed data:

| Portfolio | United States | United Kingdom | Japan |
|---|---|---|---|
| Finance | Treasury | Chancellor / HM Treasury | Ministry of Finance |
| Foreign affairs | State | Foreign Office | Ministry of Foreign Affairs |
| Defense | Defense | Ministry of Defence | Ministry of Defense |
| Justice | Justice / Attorney General | Ministry of Justice and Home Office as applicable | Ministry of Justice |
| Interior and local government | Interior, HUD, Homeland Security by program | Home Office and local-government portfolio | Internal Affairs and Communications |
| Economy and industry | Commerce | Business portfolio | Economy, Trade and Industry |
| Labor and social protection | Labor, Health, and relevant agencies | Work and Pensions | Health, Labour and Welfare |
| Health | Health and Human Services | Health and Social Care | Health, Labour and Welfare |
| Education and research | Education and relevant research agencies | Education and relevant science portfolio | Education, Culture, Sports, Science and Technology |
| Transport and infrastructure | Transportation | Transport | Land, Infrastructure, Transport and Tourism |
| Agriculture and rural affairs | Agriculture | Agriculture / environment portfolios | Agriculture, Forestry and Fisheries |
| Environment and energy | EPA, Interior, Energy by program | Environment and energy portfolios | Environment and Economy ministries by program |
| Housing | HUD | Housing / local-government portfolio | Land ministry |
| Intelligence | Intelligence community account | Intelligence account | Country-specific security-agency account |

Where a row names more than one real institution, the legislation type still has one primary
portfolio owner and explicit support portfolios. The design does not guess ownership solely from
the broad `policyDomain` string.

## User experience

### Legislation proposal

Each policy provision displays:

- responsible department or regional-government owner;
- jurisdiction mode;
- whether it is a legal rule, operating program, capital program, transfer, or grant;
- annual and startup fiscal impact;
- expected implementation ramp;
- administrative-capacity demand;
- active conflicts or laws it would replace;
- funded, partially funded, or authorization-only expectation;
- regional eligibility and national preemption/floor behavior.

The effect preview distinguishes immediate legal effects from delivered outcomes.

### Department page

A spending department page shows:

- current Cabinet controller;
- statutory mandates and active programs;
- annual authority by operating, capital, and transfer class;
- balance, available amount, encumbrances, arrears, and carryover treatment;
- program and regional allocation plan;
- administrative capacity and active projects;
- implementation status and outcome evidence;
- recent allocation, transfer, and obligation audit events.

The existing office page may host this view, but department identity and state are not stored on
the appointment document.

### Budget page

The national budget shows a reconciliation:

```text
enacted national spending
  = department accruals
  + non-departmental/direct spending

department balance
  = prior balance
  + accrued authority
  - outlays
  - valid lapses
```

The totals must reconcile visibly. A player should be able to answer why a passed law is not
producing its expected outcome.

### Regional page

Regional legislation displays its automatic annual spending line, affordability, and funding
source. It does not show a Cabinet or department-allocation interface.

## Rules and shell architecture

New formulas and transitions live in a portable rules package, for example:

```text
src/lib/governmentFinance/rules/
  appropriation.ts
  allocation.ts
  implementation.ts
  jurisdiction.ts
  metrics.ts
```

Rules accept plain data and return settlements or state transitions. They do not access MongoDB,
the wall clock, environment variables, Sentry, the network, or `Math.random()`.

The turn shell:

1. projects national budgets, active enacted laws, department definitions, and required
   capacity inputs;
2. resolves portfolio ownership for the live era;
3. calls the rules core once per country with all departments and programs;
4. persists guarded financial updates and bulk implementation-state updates;
5. emits notifications and telemetry;
6. updates downstream outcome inputs without writing derived duplicates.

Regional shells retain their staggered cadence and batch all regions for a country. Any new read
of `legislationTypes` on the turn path must project only required administration and option data.

## Migration strategy

### Compatibility rules

- Missing law administration metadata keeps the legacy effect path until that type is migrated.
- A migrated law uses only the new implementation path; it must not also apply legacy direct
  metric effects.
- Missing department-account data does not silently grant a year's money. Initialization policy
  is explicit per account, preserving the current defense-heal and intelligence-zero distinction.
- Legacy Cabinet allocation percentages remain readable until converted into a department plan.
- Existing enacted laws receive frozen administration metadata through a migration or a
  deterministic resolver. Their historical bill records are not rewritten for presentation
  alone.
- Metric aliases remain readable through a compatibility resolver until every consumer moves.

### Defense and intelligence

The generic engine is introduced with adapters that reproduce current settlement behavior. It
must pass characterization tests before their old fields are migrated. The transition order is:

1. implement common pure account rules;
2. prove the rules reproduce defense and intelligence settlements;
3. add generic department maps alongside current fields;
4. dual-read with one authoritative writer under a migration flag;
5. backfill accounts;
6. switch readers;
7. remove legacy fields only in a later schema PR.

### Metrics

Metric migration proceeds by registry and alias, not bulk find-and-replace:

1. inventory all paths and consumers;
2. approve canonical/derived/alias/retire decisions;
3. add canonical computation and compatibility reads;
4. migrate seeds and histories where required;
5. migrate law and Cabinet effect targets;
6. compare old and new outcomes in simulation;
7. remove obsolete writes;
8. remove aliases only after production data and all consumers are clean.

## Implementation sequence

Each stage is a separate issue and normally one or more focused PRs.

### Stage 0: Audits and decisions

- Generate the metric registry and duplicate report.
- Normalize US, UK, and Japan law scope and policy-domain taxonomy.
- Produce the law-to-portfolio, law-kind, jurisdiction, conflict-set, and metric-target matrix.
- Produce the Cabinet position-to-department classification for all three countries.
- Decide Japan's political-metric migration path.
- Establish simulation baselines for current maximal, moderate, and mixed portfolios.

No player behavior changes in Stage 0.

### Stage 1: US public-health vertical slice

- Implement only the portable appropriation, priority, capacity, implementation, and repeal
  rules required by `public_health_opt_1`.
- Add the era-resolved US health department definition and one operating account.
- Adapt the existing healthcare spending contribution into a single department accrual without
  a second treasury charge.
- Run the required experiment matrix and isolated `MONGODB_URI` fixture-world test.
- Integrate one turn phase and one minimal department/outcome explanation UI.
- Measure projections, bytes, documents, and round trips.
- Produce a slice report containing reconciliation evidence, screenshots of player-facing
  explanations, simulation results, and every unresolved rule exposed by the experiment.

### Gate 1: Generalize, revise, or stop

The architecture does not proceed automatically when the slice is coded. Reviewers choose one:

1. **Generalize:** the slice satisfies every acceptance criterion and the domain model remains
   understandable.
2. **Revise and rerun:** the causal model is promising but a foundational rule, storage choice,
   or player explanation needs another slice iteration.
3. **Stop:** the architecture is too costly or less legible than the existing system; retain the
   useful findings without building generalized machinery.

No Stage 2 or later schema migration merges before this gate is recorded.

### Stage 2: Generalize proven rules

- Extract generalized appropriation, allocation, implementation, capacity, and jurisdiction
  rules from the slice rather than designing them speculatively.
- Characterize Defense and intelligence behavior.
- Define the remaining account policies and reconciliation invariants.
- Add unit and property-style invariant tests across account policies.

### Stage 3: Department definitions and accounts

- Add country/era department definitions.
- Add the national account map and migration.
- Connect Cabinet positions to persistent departments.
- Convert existing abstract allocation settings into real plans where applicable.
- Move Cabinet estates, energy plants, and infrastructure projects onto guarded capital and
  operating debits while preserving their existing construction and condition rules.
- Add department and budget read models.

### Stage 4: National law administration

- Add administration metadata to legislation types and provisions.
- Persist jurisdiction selections and implementation states.
- Route spending laws through department programs.
- Split immediate legal effects from delivered outcomes.
- Add explicit cross-type conflict handling and transition rules.

### Stage 5: Regional authority and grants

- Normalize regional scopes.
- Add jurisdiction modes, including regional discretion.
- Retain automatic regional funding and the enactment hard gate.
- Route national grants through department accounts into regional revenue.
- Prevent double-counting between national and regional budgets.

### Stage 6: Metric cutover and catalog rebalance

- Land canonical metrics and derivations.
- Move laws, Cabinet settings, and approval consumers onto canonical paths.
- Update US, UK, and Japan catalogs for capability parity.
- Add or remove policy options only after their department, cost, conflict, and metric behavior is
  defined.
- Remove legacy effect paths for fully migrated types.

### Stage 7: Full UI, AI/NPP behavior, and rollout

- Department dashboards and allocation controls.
- Legislation funding, jurisdiction, and conflict previews.
- Regional affordability and grant displays.
- Deterministic NPP department allocation priorities.
- Feature-flagged rollout, telemetry, migration verification, and rollback path.

## Implementation record: 2026-09-21

The user approved Gate 1 after the public-health slice ran through the turn engine, UI, and an
isolated test-server database. The generalized implementation now includes the following:

- portable appropriation, priority, capacity, implementation, repeal, regional-settlement, and
  account-reconciliation rules;
- persistent ordinary-department accounts and program state for the US, UK, and Japan, while the
  existing specialized Defense and intelligence systems remain authoritative;
- administration metadata for all 195 initial-scope law types and program metadata for all 1,095
  program options;
- national jurisdiction selection, concrete conflict-set validation, regional discretion, and
  grant-supported regional administration;
- Cabinet department read models and same-tier program allocation controls;
- national and regional delivered-outcome scaling, including fail-closed stale-settlement reads;
- a national department-to-regional grant bridge that does not create a second sovereign debit;
- independent rollout gates for department finance, law administration, and regional finance;
- parity, metric-consumer, deterministic simulation, and isolated Mongo harnesses.

The implementation deliberately does not enable a canonical-metric cutover. The generated
consumer inventory found one exact-slug overlap candidate and a missing authored Japan baseline,
but neither is sufficient evidence to merge paths or synthesize values. The current flags allow
the account, jurisdiction, and regional machinery to ship and be exercised without making that
irreversible content migration. Authored conflict sets, production capacity coefficients, and any
catalog option additions also remain simulation-backed content decisions rather than invented
defaults.

## Self-audit of the revised design

The revision was checked against the third-party concerns, repository evidence, and the design's
own invariants.

| Audit question | Result | Evidence and remaining action |
|---|---|---|
| Is there a smaller proof point before three-country generalization? | Pass | One existing US law option, one department, one account, one capacity type, one outcome, and an explicit go/no-go gate |
| Does the slice test the hardest causal assumptions? | Pass | It covers authorization, included appropriation, sub-ledger reconciliation, obligation/outlay state, capacity-limited delivery, outcome movement, turnover, repeal, and UI explanation |
| Is scope contained? | Pass with guardrail | Grants, regional treasuries, other departments, Defense/intelligence migration, full metrics, AI generalization, UK, and Japan are explicitly excluded until Gate 1 |
| Is the authority source unambiguous? | Pass | Policy law authorizes; enacted budget appropriates; department account controls the same authority as a sub-ledger; the compatibility bridge is named and temporary |
| Is department prioritization deterministic? | Pass | Seven protected tiers, pro-rata same-tier fallback, and explicit limits on ministerial discretion |
| Is administrative capacity more than an opaque currency? | Pass | Typed throughput, auditable sources, maintenance, demand, ramp, and a named player-visible bottleneck |
| Is regional post-enactment underfunding defined? | Pass | Law remains active; grants and protected obligations settle first; only surviving obligations create arrears; discretionary delivery scales from payment |
| Can a right- and left-coded law coexist when mechanisms permit? | Pass | Conflict predicates remain legal, fiscal, capacity, and jurisdictional; stance is never a conflict key |
| Could the treasury be charged twice? | Pass at design level | Numerical example and acceptance test require one sovereign charge and matching department accrual; implementation still needs atomic/invariant proof |
| Could the slice double-write or misattribute its outcome? | Conditional | `publicHealthPreparedness` is the slice's only direct delivered outcome, but repository inspection found other legitimate contributors from Cabinet mechanics, estates, corporate signals, and baselines. The slice must inventory and preserve those sources while disabling only the migrated option's legacy law write |
| Does the plan respect portable-rules and turn-performance constraints? | Pass at design level | Same-input server/harness equivalence, projection, byte/document, and round-trip gates are mandatory |
| Are illustrative numbers being mistaken for balance approval? | Pass | The fixture is labeled non-production; final coefficients remain simulation-backed |
| Is the primary review surface shorter than the technical dossier? | Pass | Decision summary, slice, approval list, and gate now precede the detailed technical reference |

Repository inspection confirmed that `us_public_health`, `public_health_opt_1`, the annual
per-capita cost, the health Cabinet position, the era-dependent HEW/HHS name, and the
`publicHealthPreparedness` target exist in the current branch. The slice and generalized harness
later ran against the designated `MONGODB_URI` test server in unique, prefix-guarded fixture
databases. Each harness dropped only its fixture database and verified the configured default
database collection set was unchanged. Detailed settlement and replay evidence is recorded in the
simulation reports.

## Testing requirements

### Rules invariants

- Settlement is idempotent for the same turn.
- Available funds equal balance minus encumbrances and never exceed lawful authority.
- A program cannot encumber the same money twice.
- Supporting departments do not duplicate the primary program's cost.
- A reshuffle changes control but not account ownership or balance.
- Treasury spending and department accrual reconcile without a second charge.
- Carryover, lapse, refund, and contract cancellation conserve money.
- Cabinet asset construction cannot progress without a successful department debit, and
  cancellation cannot refund prior outlays.
- Regional enactment refuses an unaffordable law.
- Regional discretion creates no national delivered effect by itself.
- A grant transfer leaves the national account once and enters regional revenue once.
- Conflicts are resolved from policy metadata, never from stance labels.
- Derived metrics have no direct legislation writers.

### Integration coverage

- Every national enactment path creates or updates the correct implementation state.
- Every state enactment path runs the budget gate before effect activation.
- Acting and caretaker officeholders obey spending-scope restrictions.
- Department mergers transfer balances, encumbrances, arrears, and program ownership.
- Repeal leaves valid obligations in wind-down state.
- Budget and department pages reconcile to the same totals.
- Era changes resolve the correct department without changing the law's portfolio identity.

### Catalog validation

For US, UK, and Japan, tests fail when:

- a proposable law lacks explicit scope;
- an ordinary law lacks administration metadata;
- a portfolio cannot resolve to an active institution for its era;
- an effect target is not in the canonical registry;
- a retired alias is newly authored;
- a conflict set references an unknown law family;
- a regional-discretion option exists for a subject not marked regionally eligible;
- a cost-bearing program lacks an appropriation class;
- a derived metric is directly targeted.

## Simulation and balance report

The balance PR cannot merge without a `scripts/sim/` report. Required scenarios include:

1. **Maximal catalog:** attempt to enact the highest-intensity option in every compatible law.
2. **Mixed portfolio:** combine policies across stance labels where mechanisms are compatible.
3. **Low appropriation:** authorize programs without enough department funding.
4. **High funding, low capacity:** prove money alone does not instantly deliver outcomes.
5. **High capacity, low funding:** prove institutions cannot spend money they do not have.
6. **Regional discretion:** compare national withdrawal with heterogeneous regional adoption.
7. **Grant model:** compare formula, discretionary, and matching delivery without money creation.
8. **Government turnover:** reshuffle and election while projects and obligations continue.
9. **Revenue shock:** regional laws remain enacted while actual funding and outcomes respond.
10. **Country parity:** comparable portfolio strategies in the US, UK, and Japan over the same
    number of turns.

The report records fiscal totals, department balances, encumbrances, arrears, capacity use,
implementation ratios, metric movement, approval effects, regional dispersion, round trips, and
documents/bytes read by each new turn phase.

Success does not mean that a maximal portfolio is impossible. It means it is not a free dominant
strategy: it requires sufficient revenue or borrowing, administrative capacity, compatible legal
regimes, maintenance, and political support, with visible consequences when those constraints
bind.

## Performance requirements

- Project `legislationTypes` and budget reads on the turn path.
- Load active laws once per country or once globally and group in memory.
- Never query a department or law inside a row loop.
- Persist program settlements with one guarded budget update and bounded bulk writes.
- Add or adjust a turn-phase round-trip budget with measurements in the same PR.
- Run `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts` before and after each turn
  integration stage.
- Quote documents, bytes, and round trips in the PR. Do not use local wall-clock time as the
  primary performance claim.
- Skip Cabinet allocation work in singleplayer only if it is genuinely cross-player; core
  government finance and law delivery must remain identical in both modes.

## Rollout and rollback

The system rolls out behind separately controlled gates for department finance, law
implementation, jurisdiction modes, and canonical metrics. Gates fail closed on legacy worlds
until migration verification succeeds.

Rollback must preserve:

- all enacted-law records;
- national and regional treasury balances;
- department balances and encumbrances;
- current Defense and intelligence behavior;
- compatibility reads for old metric paths;
- a deterministic return to the legacy effect path for laws not yet migrated.

No rollout phase deletes legacy fields in the same release that first stops writing them.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Double-charging the national treasury | Treat accounts as sub-ledgers; require reconciliation invariants and atomic settlement tests |
| Turning ideology into arbitrary zero-sum scoring | Model explicit legal, fiscal, capacity, and jurisdiction conflicts only |
| Cabinet reshuffle destroys or transfers money incorrectly | Key accounts by department, never character or appointment |
| Department renames orphan laws | Laws reference stable portfolios; era maps resolve institutions |
| Metric consolidation breaks hidden consumers | Generate writer/reader inventory, use aliases, migrate in stages |
| A law applies both legacy and new effects | New administration metadata is the exclusive routing discriminator; validation forbids dual paths |
| Regional scope is silently inferred incorrectly | Normalize every US, UK, and Japan type and add catalog tests |
| Grants create money twice | Atomic transfer invariant and national/regional reconciliation |
| Turn loop becomes N+1 | One projected read and bounded bulk operations, enforced by performance tests |
| Players hoard unlimited departmental balances | Configurable carryover/lapse policies, tuned through simulation |
| Every Cabinet seat receives an implausible treasury | Explicit department-kind classification; only spending institutions and funded agencies receive accounts |
| Over-consolidated metrics flatten meaningful choices | Require causal analysis and consumer evidence for every merge or retirement |

## Resolved decisions

1. National laws are associated with stable portfolios and resolve to departments by country and
   era.
2. One department is accountable; supporting departments are explicit.
3. Department money belongs to the institution and survives officeholder turnover.
4. Not every Cabinet position is a spending department.
5. National enactment authorizes; departmental appropriation and capacity determine delivery.
6. States and regions have no Cabinet equivalents.
7. Affordable regional laws are automatically funded and implemented through the regional
   budget.
8. Regional affordability remains a hard enactment gate.
9. Jurisdiction is separate from policy intensity.
10. “Leave it to the States” is a country-specific label for regional discretion.
11. Compatible cross-stance outcomes may coexist; only concrete conflicts constrain them.
12. Metrics may be combined, derived, renamed, added, or retired after a consumer-complete audit.
13. Defense and intelligence behavior is preserved while their financial machinery is
    generalized.
14. US, UK, and Japan are the first catalog and parity scope.
15. The enacted national budget is the authoritative source of spending authority; department
    accounts are control sub-ledgers and never create a second treasury charge.
16. Department settlement uses the protected obligation priority defined in this design before
    ministers allocate discretionary authority.
17. Administrative capacity is typed operational throughput with auditable sources,
    maintenance, workload, and ramp time; it is not a spendable generic currency.
18. Regional laws remain active after later revenue shocks and follow the defined underfunding
    waterfall; only surviving legal or contractual obligations create arrears.
19. `public_health_opt_1` is the mandatory first vertical slice, and Gate 1 must approve
    generalization before broader migrations proceed.

## Open implementation decisions

These do not block issue review, but each must be resolved before its implementation stage:

- final canonical metric registry and every alias/retirement decision;
- whether implementation state lives on `enactedLaws` or in compact department program maps;
- operating carryover caps and fiscal-year lapse behavior;
- calibration units, maintenance curves, and ramp coefficients for each named capacity type;
- which law families expose each jurisdiction mode;
- the exact Japan political-board migration;
- NPP allocation priorities and how strongly party programs influence them;
- acting and caretaker limits on new obligations;
- whether department reorganization requires a dedicated legislative provision in every
  government form or may also occur through existing executive mechanics.

Every numerical choice above is a balance value and belongs in the simulation-backed
implementation issue, not in this design document.
