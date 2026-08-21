# A House Divided

<img src="public/ahd-logo.png" alt="" width="96" align="right">

A browser-based multiplayer political and economic simulation. Players create politicians, win elections, pass legislation, found corporations, and climb from state office to national leadership. The world advances one turn per real hour, and AI politicians fill every seat a player doesn't, so it stays alive at any player count.

Play at [ahousedividedgame.com](https://www.ahousedividedgame.com). Docs at [docs.lakesidegames.net](https://docs.lakesidegames.net). Licensed [PolyForm Noncommercial](./LICENSE.md).

## The game

**Eras.** Worlds seed from a historical preset (1953, 1979, 1991, 1999, 2007, 2019, or 2023) and play forward. A preset sets policies, budgets, demographics, seat maps, currencies, commodity prices, cabinet structures, franchise rules, and Supreme Court rosters. As the calendar crosses real inflection points, era checkpoints durably shift the electorate, paced by how the game's own Supreme Court rules on its docket.

**Countries.** 24 registered countries on both sides of the Cold War, resolved per world as playable or economy-only. Western democracies and one-party states with planned economies run their own political machinery. Scotland and Wales are authored secession configurations that stay hidden until registered.

**Politics.** Per-office electoral systems: first past the post, proportional (Sainte-Laguë and Hare), mixed-member, Electoral College, parliamentary selection. Primaries with delegate math, campaigns with upgrade tracks and upkeep, a two-layer voter model (country archetypes over a granular census-cell electorate), full bill lifecycles with committees and whips, coalitions and confidence votes, cabinets with confirmation fights, an active Supreme Court docket, impeachment, referendums, and politburo machinery for the one-party states.

**Economy.** Corporations buy productive capacity, staff it from a modeled labor market, and fight for market share. Stock exchanges, index funds, corporate and sovereign bonds with defaults, central banks with rate corridors and FOMC-style meetings, per-country currencies with era-anchored forex, commodities with extraction and depletion, unions and strikes, budgets and sovereign debt, an IMF, two-circuit money for command economies, and a double-entry ledger reconciling all of it every turn.

**World.** Cold War blocs, spheres of influence, crises and détente, international organizations, orders of battle, theaters, and espionage surfaces.

**Platform.** Player mail and news, an in-game wiki, a Discord bot surface plus per-country event webhooks, a public REST API (`/api-guide` in-app), an admin console, alt-detection, and a PWA install.

## How it runs

```
Browser (React 19 / Next.js App Router)
  -> Next.js API routes (JWT auth, Zod validation, 1,200+ handlers)
  -> MongoDB (native driver, 100+ document types)
  -> hourly turn processor: 120+ phases in ordered groups
     (elections, bills, NPPs, economy, demographics, conflict, metrics)
```

Stack: Next.js 16, React 19, TypeScript, Tailwind 4, MongoDB, Vitest and Playwright, Sentry-compatible monitoring, Cloudflare R2 for uploads (local-disk fallback in dev), deployed on Railway with the turn processor scheduled in-process by `node-cron`.

## Running it locally

Requires Node 20+ and a MongoDB instance.

```bash
git clone https://github.com/Egg3901/AHDGame.git
cd AHDGame
npm ci
cp .env.example .env.local
```

Set the required values in `.env.local`:

```env
MONGODB_URI=mongodb://localhost:27017/a-house-divided
AUTH_SECRET=            # openssl rand -base64 32
ADMIN_REGISTRATION_KEY= # lets the first account register as admin
CRON_SECRET=            # authenticates the turn cron
```

Everything else in `.env.example` is optional for the main app. `INTERNAL_API_KEY` is needed by server-side task scripts, while OAuth, monitoring, CAPTCHA, R2, and bot integrations can stay unset for local development.

```bash
npm run bootstrap:full   # complete historical world, including officials
npm run dev              # http://localhost:3000
```

`next dev` auto-seeds an empty database and starts the in-process turn scheduler. For UI-only work, set `DISABLE_DEV_BACKGROUND=1` and use `npm run bootstrap:full` when you intentionally need a complete world. `npm run seed` only loads the US reference pack and does not create a full playable world.

Register at `/register` with your `ADMIN_REGISTRATION_KEY` to unlock the admin console. To trigger a turn manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/turn
```

### Auth, briefly

Password login plus optional Discord and Google OAuth, optional Turnstile on registration. Sessions are HS256 JWTs signed with `AUTH_SECRET` in HTTP-only cookies. Login and OAuth routes sign them; `src/lib/auth.ts` verifies them. `CRON_SECRET` authenticates cron routes, `INTERNAL_API_KEY` authenticates server-side scripts, and the Discord bot accepts deployment keys or user-created keys from Settings.

## Development

```bash
npm run dev           # dev server
npm run lint          # ESLint, with custom rules in eslint-rules/
npm run typecheck     # tsc --noEmit
npm run test:run      # ~27k Vitest tests
npm run test:e2e      # Playwright, needs the dev server running
```

CI runs lint, format check, typecheck, the unit suite, and a Next build on pull requests and pushes to `main`. The architecture audit also runs as an advisory step because known pre-existing findings remain. CodeQL runs separately.

Useful entry points:

- `src/lib/turnSystem.ts` and `src/simulation/phases/` for the turn processor
- `src/lib/db/types` for the data contracts
- `scripts/seed/` for seeders, `scripts/world/` for bootstrap, `scripts/migrations/` for migrations
- `scripts/sim/` for the headless world simulator, including `localWorldsimMcp.ts`, an MCP server over stdio that lets a coding agent run full world simulations against a local sandbox Mongo. This is how balance changes get validated: simulate hundreds of turns, compare against baseline, then merge.

## Documentation

[docs.lakesidegames.net](https://docs.lakesidegames.net) has the player wiki, design docs, and engineering guides in one place. Doc sources live in [Egg3901/ahd-docs](https://github.com/Egg3901/ahd-docs); the player wiki is seeded from `src/lib/seeds/wiki/` in this repo. Docs suffixed `-as-shipped` are grounded in current code and win over older design docs where they disagree.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for what's welcome and what needs discussion first. The short version: bug fixes, UI polish, tests, docs, and country content are welcome; balance changes need a worldsim report before they merge. Exploits and vulnerabilities go through [SECURITY.md](./SECURITY.md), never public issues.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md). Read it, run it locally, mod it, contribute. Commercial use, including running a commercial host, is not permitted. "A House Divided" and the logo are trademarks of Lakeside Games; the servers at ahousedividedgame.com are the official way to play.
