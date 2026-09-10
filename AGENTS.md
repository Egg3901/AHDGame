# AGENTS.md

Guidance for AI coding agents working in this repository. Humans: read
[CONTRIBUTING.md](./CONTRIBUTING.md) first; this file assumes it.

A House Divided is a live game with real players and a persistent economy.
Treat every change as production-bound.

## Ground rules

- **Never commit secrets, credentials, tokens, or connection strings.** Push
  protection and secret scanning are on and will block you; do not work around
  them. `.env.local` is git-ignored and stays that way.
- **Never commit player data or personal information.**
- **Never open a public issue for a vulnerability or game exploit.** See
  [SECURITY.md](./SECURITY.md).
- Match the surrounding code. Strict TypeScript, Zod on all request bodies,
  and no new dependencies without discussion. Prefer collection getters under
  `src/lib/db/collections` when one exists; typed direct
  `db.collection<T>("name")` access is also established. Do not invent a
  repository layer.
- No em dashes or en dashes in player-facing copy, in any language.

## Systems need a portable rules core

Every system's rules (formulas, eligibility, resolution, state transitions) must
be able to run outside this server process. The hourly turn loop is one host for
them, the headless harness in `scripts/sim/` is another, and further hosts are
planned. Running a system somewhere new has to be a copy of its rules module,
not a rewrite of it, so architect for that from the start.

New systems, and materially reworked formulas in existing ones, split in two:

- **Rules**, in `rules.ts` or a `rules/` directory beside the system
  (`src/lib/pensions/rules.ts` is the model). Plain data in, plain data out.
  Randomness arrives as an injected rng, time arrives as the turn number or the
  in-game date, ids are strings.
- **Shell**, the turn phase or API route. It loads documents, calls the rules,
  writes results, emits notifications, and owns everything ambient.

The architecture audit blocks anything in the rules zone that reaches for the
database, the wall clock, `Math.random()`, `process.env`, the network, Sentry,
or `@/app`, and anything `async` there. Those are not style nits: each one is a
line that has to be rewritten wherever the system runs next.

Existing systems are not being retrofitted in bulk. The rule bites on what you
touch: if your change adds or reworks a formula, that formula lands in `rules/`.

## Commands

```bash
npm ci                 # install
npm run lint           # eslint
npm run format:check   # prettier
npm run typecheck      # tsc --noEmit
npm run test:run       # unit + integration tests
npm run verify         # lint + format + typecheck + architecture audit + tests
npm run verify:build   # Next build used by CI
npm run build          # Next build + postbuild quality publishing
```

## The CI gate

A pull request must pass, and you should reproduce these locally before opening
one:

1. **`verify`**: lint, format, typecheck, architecture audit, and tests. This is the required gate.
2. **`verify:build`**: the Next build run by CI. `npm run build` also runs postbuild quality publishing.
3. **Semgrep `custom-rules`** — project-specific rules in `.semgrep/`. A hit here
   is a real bug, not a style nit; fix the code, do not silence the rule.
4. **Dependency Review** — fails on a new high-severity or license-incompatible
   dependency.
5. **PR Title** — must be a Conventional Commit (`feat:`, `fix:`, `ci:`, ...).
   Feature PRs squash-merge, so the **PR title becomes the commit message** on a
   permanent branch. Write it like one.

The architecture audit runs in `verify` locally and as an advisory step in CI
(it has known pre-existing findings). New findings your change introduces are
yours to fix; old ones are not.

## Turn phase performance rules

The hourly turn is the product. Every player waits on it in multiplayer and
clicks through it in singleplayer, so a phase that quietly gets slower costs
more than any feature it carries. Two things make a turn slow, and they are
different on the two deployments:

- **Multiplayer** talks to a remote Mongo, so turn time is round trips times
  latency. A loop that runs one query per row (an N+1) adds seconds per turn.
- **Singleplayer** runs Mongo locally, so turn time is CPU, and most of that
  CPU is decoding BSON. Reading a 31 KB NPP document to use two numbers from it
  is the cost, not the query.

Rules for anything that runs inside `processTurn`:

1. **Project every read of a fat collection.** `npps` (never load
   `policies.domainPositions` unless you vote on bills), `corporateSectors`
   (`buildQueue`, `plantsPnl` only if you advance builds or price plants),
   `legislationTypes` (`policyOptions` only if you price laws).
   `src/simulation/engine/turnReadProjections.test.ts` fails the build on an
   unprojected read of these on the turn path; a full read that is genuinely
   needed carries a `// full-read(<collection>): <reason>` comment.
2. **No query per row.** Collect the ids, read once with `$in`, write once with
   `bulkWrite`. Every phase has a round-trip budget in
   `src/simulation/engine/turnPhaseBudgets.ts`; `runPhase` counts every Mongo
   command per phase on every turn and logs a warning, and records
   `roundTrips` / `overBudget` on the phase telemetry, when a phase exceeds it.
   If your change legitimately needs more, raise the budget in the same PR with
   the measurement.
3. **Measure before and after.** On a local world:
   `AHD_TURN_ROUNDTRIP_PROFILE=1 npx tsx scripts/perf/one-turn.ts` prints
   bytes, documents and round trips per phase. To find which call site issues
   a per-row query: `TRACE_COLLECTIONS=<collection> npx tsx
scripts/perf/trace-callsites.ts`. For CPU: `--profile out.cpuprofile`.
   Quote bytes and round trips in the PR; local wall clock is noise.
4. **Ask whether the work means anything for one player.** Anti-abuse scans,
   alt detection and similar have nothing to detect in singleplayer and are
   skipped there; new cross-player subsystems should follow that pattern.

## What needs an issue before you build

Balance changes (economy constants, election math, demographic weights, action
costs), new mechanics, and schema changes under `src/lib/db/types`. Balance
changes merge only with a simulation report from `scripts/sim/`. See
CONTRIBUTING.md for the full policy.

## Where things live

- `src/app/api/**` — thin route handlers: auth guard, Zod parse, call into lib.
- `src/lib/**`: domain logic, one directory per system. Database collection getters live under `src/lib/db/collections`.
- `src/lib/turnSystem.ts` — the hourly turn processor; phases in
  `src/simulation/phases/`.
- `scripts/seeds/` — seed data; `scripts/seed/` — seed runners.
- `src/lib/seeds/wiki/` — player-wiki source content.

Deeper engineering docs: <https://docs.lakesidegames.net>.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
