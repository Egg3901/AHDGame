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
