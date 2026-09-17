# Pre-move snapshots

One JSON file per country, holding what every registry said about that country
**before** its folder absorbed anything.

```
npx tsx scripts/countries/check-snapshot-imports.ts   # first, always
npx tsx scripts/countries/emit-country-snapshot.ts US
```

## Why these exist

A folder is built to reproduce the registries it replaces. Once a registry
forwards to the folder, reading it back compares the new thing to itself, and the
faithful-replacement harness passes while proving nothing. It happened in Plan C
task C0. The snapshot is the only independent record of what the values were, so
it must be taken before the first rewire and never regenerated afterwards — the
emitter refuses if the file already exists.

Japan's is absent from this directory on purpose: it was emitted, consumed by the
generators that wrote `jp/`, and deleted in `b5c0a2c1c`. It is recoverable from
`a57bff2be` if it is ever needed again.

## ⚠ Run the import check first

`check-snapshot-imports.ts` is not optional politeness. An unexported registry
imports as `undefined`, and the shape-driven extractor files `undefined` under
`absent` — the same word it uses for a country that genuinely has no entry. The
two are indistinguishable in the fixture, and `absent` is the one an operator
waves through.

This was not hypothetical. `b5c0a2c1c` deleted Japan's one-off emitter and, in
the same commit, dropped `export` from the 22 registries that emitter had been
the only consumer of. Perfectly reasonable cleanup after a one-off. But the
generalised emitter, run for the US, then recorded **22 of 77 registries as
holding nothing** — `TREASURY_TEXT`, `EXECUTIVE_TEXT`, `EXECUTIVE_SEALS`, all
four `MONETARY_BASELINES_*`, and the rest — with no error, no warning and a
green typecheck. A US folder built from that fixture would have been missing its
treasury text, its executive text and its seals, and the harness would have
agreed, because it compares against the same empty fixture.

Japan's own snapshot is unaffected: those registries were still exported at
`a57bff2be` when it ran. The exports are restored, and the check now guards them.

## ⚠ `absent` still needs reading, one country at a time

Even with every import resolving, `absent` has two meanings, and only the country
can tell you which. **For the US it is usually not "no such data" — it is "the US
is the default".** 51 of the 74 country registries are
`Partial<Record<CountryId, X>>`, read through `?.` and `??`, and the fallback
branch is frequently the US value written as a default rather than as a `US:`
key. Japan never appears as anyone's default, so this distinction never arose
while Japan was the only country moved.

The nine registries with no US entry, each checked by hand:

| registry                          | why the US has no key                                   |
| --------------------------------- | ------------------------------------------------------- |
| `SURFACES` (parliamentary)        | the US is presidential. Correct absence, not a gap.     |
| `COUNTRY_BILL_PHASES`             | `Partial`, read via `?.` in `countryReadinessContract`  |
| `COUNTRY_ELECTION_PHASES`         | same; US elections run off the global game state        |
| `REGION_CENSUS_LABELS`            | `Partial`; consumers fall back to generic labels        |
| `STATE_DISPLAY_NAMES`             | falls back to `compactRegionCode`, which is not US data |
| `REGION_NAME_MAPS`                | `Partial`, read via `?.` in `seedSeats`                 |
| `FULL_ERA_REGION_BUNDLES`         | `Partial`, read via `?.` in `regionBundles`             |
| `MONETARY_BASELINES_1953`         | `Partial`; the US sits in the base `MONETARY_BASELINES` |
| `REGION_DEMOGRAPHIC_CATEGORY_IDS` | `Partial`; no US-specific category override             |

None of the nine hides a US value behind a US-specific fallback, so all nine are
genuine absences and the folder must not invent a value for any of them. Redo
this table for each country; do not inherit this one.
