## What & why

<!-- What does this change, and what problem does it solve? Link the issue. -->

## Checklist

- [ ] Lint, format, typecheck, and tests pass locally (the CI gate)
- [ ] New/changed API routes have integration tests
- [ ] `CHANGELOG.md` entry added (if player-visible)
- [ ] No balance constants changed — or a worldsim report is attached
- [ ] Turn performance change: aged-world gate verdict pasted (`npm run perf:aged-benchmark -- ... --baseline before.json`, see `scripts/perf/aged-benchmark.ts`), or not a turn-path change
