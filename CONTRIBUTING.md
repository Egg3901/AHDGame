# Contributing to A House Divided

Thanks for wanting to help. A House Divided is a live game with real players, so contributions are welcome but held to a production bar. Read this before opening a PR.

## What we're looking for

Great first contributions, in rough order of how easy they are to land:

- **Bug fixes** with a reproduction and a test
- **UI, accessibility, and mobile polish**
- **Documentation** — fixing inaccuracies, covering undocumented systems (see [docs.lakesidegames.net](https://docs.lakesidegames.net))
- **New country content** — seed data, region maps, cabinet catalogs, following an existing country as the pattern
- **Test coverage** for under-tested systems
- **Performance** — with before/after measurements

## What needs discussion first

Open an issue before writing code for any of these:

- **Balance changes** — economy constants, election math, demographic weights, action costs. These require validation through the world simulator (`scripts/sim/`) before they can merge; a PR that changes balance constants without a sim report will be closed with a request for one.
- **New game mechanics** — the game has a design direction; a mechanic PR without prior discussion is a coin flip.
- **Schema changes** — anything touching `src/lib/db/types` affects a live production database and needs a migration plan.

## Exploits and security

**Do not open a public issue for an exploit or vulnerability.** See [SECURITY.md](./SECURITY.md). Responsibly reported exploits earn credit and supporter time.

## Getting set up

Follow the README: Node 20+, a local MongoDB, `cp .env.example .env.local`, `npm install`, `npm run seed`, `npm run dev`. Bootstrap a full world from the admin console (register with your `ADMIN_REGISTRATION_KEY`). Advance turns locally by hitting `/api/cron` with your `CRON_SECRET`.

## The bar for a PR

1. Branch off `main`, one topic per PR, small over large.
2. `npm run verify` passes (lint, format, typecheck, unit tests). CI runs the same gate.
3. **New or changed API routes require integration tests.** Copy the pattern from any existing `route.test.ts`.
4. New logic gets unit tests next to it (`*.test.ts`, Vitest).
5. Add a `CHANGELOG.md` entry if the change is player-visible.
6. Match the surrounding code. TypeScript strict, Zod validation on request bodies, collection access through `src/lib/db` getters, no new dependencies without discussion.
7. Describe _why_ in the PR body, not just what. Link the issue.

## Code layout in one minute

- `src/app/api/**` — route handlers (thin: auth guard, Zod validation, call into `src/lib`)
- `src/lib/**` — all domain logic, one directory per system
- `src/lib/turn/` + `src/lib/turnSystem.ts` — the hourly turn processor; phases are registered in `src/simulation/phases/`
- `src/lib/db/types` — the database document contracts
- `scripts/seeds/` — world seed data; `scripts/sim/` — the headless world simulator

The [engineering docs](https://docs.lakesidegames.net) cover architecture boundaries, naming, and the repo operating map in depth.

## Review and merging

The maintainer reviews every PR. Balance and economy paths get extra scrutiny and may require a worldsim run. Squash merge only; your PR title becomes the commit message, so write it like one.

## Licensing of contributions

The project is licensed under [PolyForm Noncommercial 1.0.0](./LICENSE.md). By submitting a contribution you agree that it is licensed under the same terms and that Lakeside Games may use it in the official hosted game.
