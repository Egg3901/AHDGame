# Contributing

A House Divided is a live game with real players, so contributions are held to a production bar. Here's what that means in practice.

## What lands easily

- Bug fixes with a reproduction and a test
- UI, accessibility, and mobile polish
- Documentation fixes (site docs go to [ahd-docs](https://github.com/Egg3901/ahd-docs), wiki content lives in `src/lib/seeds/wiki/` here)
- Country content: seeds, region maps, cabinet catalogs, following an existing country as the pattern
- Tests for under-tested systems
- Performance work with before/after numbers

Issues labeled `good-first-issue` are verified and scoped.

## What needs an issue first

- **Balance changes.** Economy constants, election math, demographic weights, action costs. These merge only with a simulation report from `scripts/sim/`. A PR that changes balance constants without one gets closed with a request for one.
- **New mechanics.** The game has a design direction; talk before you build.
- **Schema changes.** Anything in `src/lib/db/types` affects a live production database and needs a migration plan.

Exploits and vulnerabilities: never in public issues. See [SECURITY.md](./SECURITY.md).

## Setup

Follow the README. You'll have a local world with an admin account in about ten minutes.

## The bar for a PR

1. Branch off `main`. One topic per PR, small over large.
2. Lint, format, typecheck, and tests pass (`npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:run`). CI runs exactly this gate. (`npm run verify` additionally runs an architecture audit with known pre-existing findings; new findings from your change are yours, old ones aren't.)
3. New or changed API routes need integration tests. Copy the pattern from any `route.test.ts`.
4. New logic gets unit tests next to it.
5. Player-visible changes get a `CHANGELOG.md` entry.
6. Match the surrounding code: strict TypeScript, Zod on request bodies, collection access through `src/lib/db` getters, no new dependencies without discussion. No em or en dashes in player-facing text.
7. The PR body says why, not just what.

Code layout in one minute: `src/app/api/**` are thin route handlers (auth guard, Zod, call into lib). `src/lib/**` is the domain logic, one directory per system. The hourly turn processor is `src/lib/turnSystem.ts` with phases registered in `src/simulation/phases/`. Seeds are in `scripts/seeds/` (data) and `scripts/seed/` (runners). The [engineering docs](https://docs.lakesidegames.net) go deeper.

## Review

The maintainer reviews every PR. Balance and economy paths get extra scrutiny and may require a worldsim run. Squash merge only; your PR title becomes the commit message, so write it like one.

By contributing you agree your contribution is licensed under [PolyForm Noncommercial 1.0.0](./LICENSE.md) and that Lakeside Games may use it in the hosted game.
