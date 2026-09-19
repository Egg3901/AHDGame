# Country folders

A country's facts live in one directory. `jp/` is the worked example; it is the
only country moved so far.

```
src/lib/countries/
  contract.ts        the shape a folder must satisfy
  contract.test.ts   asserts a real country can satisfy it, with nothing absent
  jpCoverage.ts      which files carry Japan, and in which bucket
  jp/
    index.ts         the barrel - SERVER-SIDE CONSUMERS ONLY
    identity.ts institutions.ts elections.ts economy.ts geography.ts
    eras/1953.ts 1979.ts 1991.ts 1999.ts 2007.ts 2019.ts 2023.ts
    data/            authored payloads (regions, census, budgets, parties)
```

## The one rule

**A forwarder holds no copy.** When a fact moves into the folder, the registry it
came from keeps its key and points at the folder:

```ts
// src/lib/constants/cabinetIdentity.ts
JP: JP_IDENTITY.cabinet,        // yes - one definition
JP: { glyph: "日", ... },        // no  - a second definition that will drift
```

Both spellings typecheck, both pass the tests, and only one of them is the job.
This is the failure to watch for, because it is invisible: the copy is correct on
the day it is made.

## Why the registries still exist

They have to. **23 of the 74 country registries are total
`Record<CountryId, X>`** - deleting a country's key is a type error, so the key
stays and points at the folder. Another 51 are
`Partial<Record<CountryId, X>>`, where dropping a key is _not_ a type error and
the country silently stops existing in that registry.

So "how many files mention Japan" is not a progress measure. It barely moves
whatever happens. The number that moves is **how many lines of Japan's data are
written outside the folder** - see [Measuring](#measuring).

## Adding a country

Work through `CountryFolder` in `contract.ts`. It is the checklist; each member
is one module.

### 1. `identity` - what the country is called, and how it looks

`displayName`, `cabinet`, `national`, `stats`, `treasuryText`, `economyText`,
`executiveText`, `policyText`, `executiveSeal`, `executiveSurface`,
`parliamentarySurface`, `regionCensusLabels`, `stateDisplayNames`,
`addressNames`, and optionally `historicalNames`, `modernNames`, `eraNames`.

⚠️ `treasuryText` and `economyText` are `Omit<..., "palette" | "accent">`. The
palette is _derived_ from the national identity at read time, so a folder that
supplies its own gives the country two palettes that agree until one is edited.

⚠️ Non-Latin scripts need both the native string and an English fallback
(`title` plus `titleEn`). Surfaces that cannot render the script show the
fallback, not a blank.

### 2. `institutions` - the machinery of government

`config` (the `CountryConfig`), `legislativeProcess`, `cabinet.positions` and
`cabinet.orders`, `military.branches` and `military.ordersOfBattle`,
`estatePortfolio`.

⚠️ **Government type is a value in a field, not a subclass.** There is no
`ParliamentaryCountry`. A presidential country and a parliamentary one differ by
what `config.governmentType` says and which fields they fill.

### 3. `elections` - how office is won

`seats.totals`, optional `spawn`, `billPhases`, `electionPhases`.

⚠️ This module reaches `getDb` through the perpetual-election spawners. That is
why the barrel is server-side only.

### 4. `economy` - money

`currencyCode`, `nationalPolicyStateId`, `legislationScope`, `economicBaseline`,
`monetary`, `sectorWeights`, `repEcon`, `costScaleAnchors`, `tax`.

⚠️ **Currency identity belongs to the country; the exchange rate does not.**
`COUNTRY_CURRENCY_MAP.JP = "JPY"` is Japan's fact and moves. The 1979 JPY/USD
rate of 219.0 is a fact about a _pair_ of countries in a _year_ and stays in the
rate tables, next to the rates it must stay consistent with.

⚠️ Local-currency values are not comparable across countries. Japan's NPP
investment floor of 34,000 is yen; the US 80,000 is dollars. Do not nudge one
toward the other.

### 5. `geography` - where the country is, and who lives there

`continent`, `isoNumeric`, `worldRegion`, `nppCapitalState`, `adjacency`,
`regionNames`, `conscription`, `populationMultipliers`, `censusBundles`,
`populationAnchors`, `metricPresets`, `regionBundles`, `rawMetrics`,
`mapRegistry`, `core5Normals`.

⚠️ **The ISO pair is two registries.** `COUNTRY_TO_ISO_NUMERIC` and
`ISO_NUMERIC_TO_COUNTRY` are separate; move them together or a lookup by code
and a lookup by country will disagree about one fact.

⚠️ **Reference the authored modules, do not inline them.** An early revision of
Japan's `geography.ts` generated copies of every census bundle instead of
importing them. Deep equality passed; Japan quietly had two sources for every
region. `japanReachable.test.ts` uses `toBe`, not `toEqual`, for exactly this.

### 6. `eras` - one file per shipping preset

Every entry in `SHIPPING_PRESETS`, each `CountryEraOverride` naming its own
`preset`. Count them from `SHIPPING_PRESETS`, never from a literal: the list
grew from seven to eight when upstream added 2027, and every hard-coded seven
had to be hunted down by hand.

⚠️ **`getCountryConfig` is a SHALLOW merge.** An era override supplying
`legislature` replaces the base `legislature` _wholesale_ - every field the
override omits is gone, not inherited. Japan's 1953 override carries the full
466/248 chamber pair for this reason.

⚠️ An era with no override must say so by **absence**. An empty object looks
like an override and overrides nothing.

## Client code

Import the leaf module, never the barrel:

```ts
import { JP } from "@/lib/countries/jp"; // no
import { JP_IDENTITY } from "@/lib/countries/jp/identity"; // yes
```

The barrel composes identity, institutions, elections, economy, geography and
every era file, and elections reaches the MongoDB driver. A `"use client"`
component that wanted one label would ship all of it, and nothing would fail -
the bundle would just get bigger. `noClientBarrelImport.test.ts` enforces this.

### Leaf modules are not automatically light

Avoiding the barrel is necessary and not sufficient. `geography.ts` imports every
era of region, census and metric data **as values**, and `institutions.ts`
imports the cabinet, of which `mechanics` alone is 28 KB. A registry that
forwards to one of those for a single string ships the whole thing.

That is not hypothetical - it shipped. `countryContinents.ts` held `JP: "Asia"`
at zero cost, was repointed at `JP_GEOGRAPHY.continent`, and started pulling
108 KB into every client bundle that read a continent. Typecheck, lint and 38,000
tests all stayed green.

So each folder has a **facts module** beside the heavy one, holding the small
values registries actually read, with **no value imports at all**:

| module                 | pulls        | who reads it                                     |
| ---------------------- | ------------ | ------------------------------------------------ |
| `geographyFacts.ts`    | 4.6 KB       | continent, ISO code, adjacency, anchors, normals |
| `institutionsFacts.ts` | 10.8 KB      | config, legislative process, seat ids, estates   |
| `cabinet/positions.ts` | 1.5 KB       | the four cross-country cabinet roles             |
| `economy.ts`           | 8.4 KB       | type-only imports, already light                 |
| `identity.ts`          | 8.0 KB       | type-only imports, already light                 |
| `geography.ts`         | **111.6 KB** | the folder itself, and seed-time consumers       |
| `institutions.ts`      | **49.6 KB**  | the folder itself                                |
| `index.ts` (barrel)    | **953 KB**   | nothing at runtime; it exists to be asserted     |

The heavy module re-exports from the facts module, so the conceptual home still
reads right and there is still exactly one definition.
`clientSafeLeafModules.test.ts` enforces both halves: the listed modules must
stay import-free, and no client-reachable registry may forward to a heavy one.
Its third assertion was itself broken when written - a stray capture group made
every lookup throw into a `catch`, so it passed while checking nothing. It was
found by mutation-testing the guard, not by reading it. Do that to any guard you
add here.

## Cycles

A registry imports the folder. So a folder module that imports a _value_ back out
of that registry is a runtime cycle, and TDZ failures from one are ugly and
load-order dependent. Three helpers were moved to their own modules for exactly
this reason:

- `seeds/reference/uniformUnionName.ts`
- `states/conditions/condition.ts`
- `constants/readinessChecks.ts`

Type-only imports are fine - they are erased. If a folder module needs a
_function_ that lives in a registry, give the function its own module rather than
duplicating it or importing it back.

## Measuring

```
npm run typecheck
npx vitest run src/lib/countries
npx tsx scripts/countries/verify-jp-runtime.ts
```

The last one is deliberately **not** a vitest file. Vitest resolves modules
through vite, which is not the app's module-init order, so a cycle or an
init-order bug can pass under vitest and fail in the app.

The progress metric is literal lines outside the folder, by bucket - not file
count. For Japan, measured against the branch point:

|                                                        | before   | after  |
| ------------------------------------------------------ | -------- | ------ |
| files carrying a `JP:` entry                           | 120      | 121    |
| **bucket A literal lines** (Japan's data, should move) | **1191** | **10** |
| bucket C literal lines (derived, correctly stays)      | 2299     | 2299   |
| bucket E literal lines (client surfaces)               | 182      | 140    |
| `JP:` entries that forward                             | 37       | 137    |

The file count went **up by one**. That is the point: the registries did not go
away, their contents did. Only the bold row means anything, and no file gained
literal lines - 1264 were removed and none reappeared elsewhere, which is how you
tell a move from a copy.

The ten that remain are deliberate, not residue:

- **four JPY/USD exchange rates** in `constants/currencies.ts`. A rate is a fact
  about a _pair_ of countries in a _year_; it belongs next to the rates it has to
  stay consistent with, not in one of the two countries.
- **five rows in `AUTHORED_ALIGNMENT`**, a world table of 233 countries. Japan is
  a peer there, not an owner. Lifting one row out would fragment the table and
  give the folder a value whose meaning only exists relative to it.
- **one `countryId: "JP"`** sitting beside a forwarder in `institutionIdentity`.
  That is a key echo, not a copy.

A file can hold both an A registry and a B one - `currencies.ts` holds currency
_identity_ (moved) and exchange _rates_ (stayed) - so the per-file bucket in
`jpCoverage.ts` is a coarser instrument than the per-registry rule. Read the
number with that in mind.
