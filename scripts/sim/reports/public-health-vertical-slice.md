# US Public Health Vertical Slice Evidence

Date: 2026-09-20
Issue: [#2257](https://github.com/Egg3901/AHDGame/issues/2257)
Gate 1 decision: `generalize`

## Scope and neutrality

This experiment tests game-system mechanics for one fictionalized legislative option. It does not assess the real-world merits of a public-health policy. The values in the fixtures and the initial 80-throughput production pool are illustrative balance inputs, not approved production balance.

The institutional split follows neutral reference material only:

- The Congressional Research Service distinguishes authorization of a program from the appropriation that provides funds for it: <https://www.congress.gov/crs_external_products/RS/PDF/RS20371/RS20371.13.pdf>
- GAO's Red Book is the reference for purpose, time, amount, and obligation controls: <https://www.gao.gov/legal/appropriations-law/red-book>
- The department identity and mission wording use the official HHS description: <https://www.hhs.gov/about/index.html>

## Implemented proof boundary

- Country: US only.
- Legislation type: `us_public_health`.
- Option: `public_health_opt_1`.
- Portfolio: `health`.
- Durable department id: `us_health_department`.
- Cabinet controller: `secretary_of_health`.
- Program: `us_public_health_workforce`.
- Capacity: `public_health_operations`.
- Outcome adapter: national `us.health.prevention.primary` contribution only.
- Regional public-health supplements remain on their existing fully funded assumption.
- Feature flag: `departmentProgramSliceEnabled`, absent or false by default.

## Deterministic harness results

Command:

```powershell
tsx scripts/sim/publicHealthVerticalSlice2026-09-20.ts
```

| Case                    | Funding factor | Capacity factor | Delivered factor | Binding explanation | Reconciled |
| ----------------------- | -------------: | --------------: | ---------------: | ------------------- | ---------- |
| Fully funded            |           1.00 |            1.00 |             1.00 | none                | yes        |
| Appropriation shortfall |           0.50 |            1.00 |             0.50 | funding             | yes        |
| Capacity bottleneck     |           1.00 |            0.50 |             0.50 | capacity            | yes        |
| Dual bottleneck         |           0.50 |            0.50 |             0.25 | funding tie-break   | yes        |
| Officeholder turnover   |           1.00 |            1.00 |             1.00 | none                | yes        |
| Repeal with encumbrance |           0.00 |            1.00 |             0.00 | funding             | yes        |
| Same-turn replay        |    no new flow |       unchanged |      no new flow | replay guard        | yes        |

Observed invariants:

- Every case satisfied the money-conservation identities.
- Funding and capacity produced distinct binding explanations.
- A same-turn replay accrued no authority and issued no outlay.
- Repeal accepted no new encumbrance and retained the existing encumbrance.
- The account identity and settlement were unchanged by the officeholder-turnover fixture.
- Server and headless harness calls serialized byte-for-byte identically from the same plain-data input.

## Test-server execution

Harness: `scripts/sim/publicHealthVerticalSliceMongo2026-09-20.ts`

Safety properties verified by unit test:

- Requires `MONGODB_URI`.
- Refuses to run when normalized `MONGODB_URI` equals `MONGODB_URI_LIVE`.
- Creates only a uniquely named database beginning `ahd_public_health_slice_`.
- Permits cleanup only for that exact prefix.
- Never prints either URI.
- Uses a 10-second server-selection timeout.
- Keeps generated database names within MongoDB Atlas's 38-byte limit.

Execution evidence:

- The first connected run exposed a fixture-harness defect: its generated database name exceeded MongoDB Atlas's 38-byte database-name limit.
- The generator now uses a timestamp encoded in base 36 plus a four-character UUID suffix. A regression test checks both the byte limit and cleanup validation.
- The corrected harness connected to the configured test server, seeded the isolated fixture, settled one turn, replayed the same turn, and cleaned up the fixture.
- First settlement accrued $246,062,500 in authority, outlaid $98,425,000, delivered 40% of the authored effect, and reconciled exactly.
- Same-turn replay settled zero programs, accrued no authority, issued no outlay, and left persistent state unchanged.
- The national treasury remained unchanged, as required by the vertical-slice boundary.
- The configured default database was checked before and after the run and remained unchanged.
- Cleanup was separately verified by listing databases and confirming that the uniquely prefixed fixture database no longer existed.

## Live browser inspection

A second uniquely prefixed disposable fixture database was used to inspect the real Cabinet route and briefing API through `localhost:3000`.

Feature enabled:

- The briefing route and Cabinet office returned HTTP 200.
- The Secretary of Health, Education, and Welfare office displayed the `Public Health Workforce Expansion` program as operating.
- The panel showed funding 100%, capacity 80%, coverage 100%, ramp 50%, delivered 40%, and `ramp` as the binding constraint.
- Money values matched the persisted settlement: $11,811,000,000 annual demand, $246,062,500 authority for the turn, $147,637,500 available balance, $98,425,000 outlaid, and no arrears or encumbrance.
- The capacity breakdown and 40% outcome-channel contribution were visible and internally consistent.

Feature disabled:

- After changing only `departmentProgramSliceEnabled` to false in the disposable world, the office showed the disabled-state explanation.
- No program money, capacity ratios, delivery factor, or outcome contribution leaked into the disabled UI.

The fixture database was removed after inspection. `localhost:3000` was then restored to the untouched default test world.

## Verification completed

- Baseline characterization: 2 files, 44 tests passed.
- Turn and persistence focus: 8 files, 50 tests passed before the outcome/UI pass.
- Outcome path focus: 4 files, 43 tests passed.
- Rules and deterministic simulation focus: 6 files, 17 tests passed.
- Cabinet read model and component: 2 files, 3 tests passed.
- Mongo safety harness: 2 files, 5 tests passed.
- Consolidated focused verification: 20 files, 151 tests passed.
- TypeScript: passed with `--max-old-space-size=8192` after the default Node heap exhausted.
- ESLint: passed for every touched TypeScript and TSX file.
- Architecture audit: zero blocking findings; the new rules core passed the portability checks. Existing advisory findings were unchanged.
- Prettier: passed for the evidence report and touched source files.
- `git diff --check`: passed.

Production build verification did not complete in the worktree environment. Turbopack rejected the temporary dependency junction because it resolved outside the worktree root. The webpack fallback then failed to fetch external fonts and exhausted an 8 GB heap; an approved 12 GB retry still timed out while fetching the fonts. These are build-environment blockers rather than a passing build result, so the production build remains unverified.

## Acceptance criteria status

1. Reconciliation across fixtures: pass.
2. Replay idempotency in pure rules and Mongo persistence: pass.
3. Funding and capacity explanations: pass.
4. Migrated national outcome path only: pass in focused unit and dynamics tests.
5. Repeal preserves obligations and enters deterministic wind-down: pass for preservation and status; paying down encumbrances remains a follow-up rule.
6. Officeholder turnover preserves account identity: pass in rules and department identity tests.
7. Minimal explanatory UI: pass in component tests and live browser inspection.
8. Server and harness serialization parity: pass for shared rules input.
9. Projected reads: implemented. Representative full-world round-trip and byte measurement remains pending because the default test world is a freshly reset turn-1 world.
10. Isolated `MONGODB_URI` run: pass, including persistent replay and cleanup.
11. Flag-off compatibility: pass in focused tests and live browser inspection. Repository-wide verification and the production build remain pending.

## Self-audit

- Rules files are synchronous and contain no database, wall-clock, environment, network, Sentry, or application imports.
- The treasury is not debited by the department account.
- Missing accounts initialize with zero money.
- The turn shell projects the legislation type and performs no per-state or per-department loop.
- Outcome scaling applies to the migrated national public-health contribution; other national contributors and all regional supplements retain their existing path.
- The office read model is behind the existing Cabinet visibility gate.
- The player surface distinguishes authorization, money, capacity, delivery, and the outcome channel.
- No allocation controls were added.
- No UK, Japan, regional-account, AI-allocation, or general department migration work was started.

## Gate 1 decision

`generalize`

The project owner approved full implementation on 2026-09-21 after reviewing the architecture,
isolated Mongo settlement, persistent replay, and live feature-on/feature-off UI. The measured
turn profile on a representative populated world and the retained-encumbrance pay-down rule
remain required implementation evidence. They are tracked as Stage 2 work rather than blockers
to beginning generalization. The initial capacity pool remains an illustrative balance input and
must be reviewed before enabling department finance in a production world.
