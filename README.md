<p align="center">
  <img src="public/ahd-logo.png" alt="A House Divided" width="140">
</p>
<p align="center">
  <h1 align="center">A House Divided</h1>
  <p align="center">
    Real-time multiplayer political simulation — run for office, pass legislation, build corporations, and shape nations across seven decades of history.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-informational" alt="Version">
  <img src="https://img.shields.io/badge/license-PolyForm_Noncommercial-8957e5" alt="License">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="Pull Requests">
  <img src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" alt="Code Style">
  <img src="https://img.shields.io/badge/deployed_on-Railway-0B0D0E?logo=railway&logoColor=white" alt="Railway">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js&logoColor=white" alt="Next.js">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/MongoDB-native_driver-47A248?logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind">
  <img src="https://img.shields.io/badge/node-v20+-brightgreen?logo=node.js&logoColor=white" alt="Node.js">
</p>

---

## Overview

**Documentation: [docs.lakesidegames.net](https://docs.lakesidegames.net)** — the full design and engineering doc set.

A House Divided is a browser-based political and economic simulation where players create politicians, compete in elections, form coalitions, pass legislation, found corporations, and climb from state office to national leadership. The world advances one turn per real hour (48 turns = one game year), with a persistent economy and AI-controlled Non-Player Politicians (NPPs) filling every vacant seat and voting on every bill, so the world stays alive at any player count.

### Eras

Worlds are seeded from a historical **era preset** — **1953, 1979, 1991, 1999, 2007, 2019, or 2023** — and then play forward through history. An era preset determines starting policies, budgets, demographics, sector weights, seat maps, currencies and exchange rates, commodity prices, cabinet structures, franchise rules, and Supreme Court rosters. As the in-game calendar crosses real historical inflection points, **era checkpoints** (civil rights, enfranchisement, judicial realignments, and more) durably shift the electorate — paced by how the game's own Supreme Court rules on its docket, so history can rhyme rather than repeat.

### Countries

The country roster is **config- and database-driven**, not hardcoded: 24 registered countries spanning both sides of the Cold War, from the United States and United Kingdom to East Germany, China, and the Warsaw Pact. Each country resolves at runtime to **playable**, **economy-only** (fully browsable, read-only), or hidden, controlled per-world through admin settings. Western democracies, one-party states with planned economies, and devolved/secession systems (Scotland, Wales) each run their own political machinery.

---

## Features

### Characters & Actions

- Create a politician with policy positions on economic and social axes
- Action-point economy — 4 base actions per turn, with bonuses per office held
- Nine action types: fundraise, campaign, advertise, build donor base, poll (regular and large), convert cash, debate prep, rest
- Action costs scale with progress — campaigning costs more influence-points and funds (GDP-scaled per state) as your standing rises
- Character stats (charisma, intellect, fundraising) modify action outcomes
- 58 achievements, onboarding flow, year-in-review "wrapped" recaps

### Elections & Campaigns

- Per-country electoral systems, data-driven per office: first-past-the-post, proportional (Sainte-Laguë and Hare quota), mixed-member (AMS), Electoral College, and parliamentary selection
- **US**: President, Senate (3 classes), House, Governors, State Senates, with primaries, delegate allocation, and a primary calendar
- **UK**: Commons (650 constituencies), Prime Minister, Holyrood, Senedd, regional councils, judicial review
- **Germany**: Bundestag (AMS with Landeslisten), 16 Landtage, Minister-Presidents
- **Japan**: Shugiin, Sangiin (two chamber classes), governors, regional councils
- **Ireland**: Dáil, Uachtarán, local councils; **China**: NPC delegates and People's Congresses
- Campaign objects per candidacy with four upgrade tracks — fundraising (L1–L10, up to $5M/turn at presidential scale), opposition research, ground game, media spending — plus upkeep costs, auto-downgrade when you can't pay, and financial fog of war
- Voters are modeled two layers deep: country-specific demographic archetypes (12 in the US) on top of a granular census-cell electorate with per-cell turnout, registration pools, GOTV, and turnout decay
- County and district result maps with live tallies and trend charts; automated wire-service election news

### Legislature & Government

- Full bill lifecycle with committees, whips, caucuses, floor debates, amendments, and executive sign/veto
- Era-aware legislation catalogs — what you can propose (and what it costs) depends on the year
- Enacted laws feed back into metrics, demographics, and the economy
- Coalitions, parliamentary government formation, confidence votes, and vacancy watching for parliamentary systems
- Unified cabinet system with per-country catalogs, nominations, confirmation votes, and ministerial orders
- One-party state machinery for the Eastern Bloc: politburo-style bill lifecycles, ruling-party purges, regime conversion and escalation
- Supreme Court: seeded per-era rosters, nominations and tenure, an active docket whose rulings can diverge from history, and referendums and electoral-law changes (franchise, registration, voting age)
- Impeachment, political capital, and player- and world-level random events

### Economy

- **Capacity economy** — corporations buy productive capacity, staff it from a modeled labor market, and compete for market share across sector types in every state and region
- **Corporations** — public/private founding, IPOs, shares and dividends, stock splits, CEO elections, subsidiaries, credit ratings, distress and restructuring, nationalization and privatization votes
- **Markets** — config-driven stock exchanges per country with OHLC charts, index funds with rebalancing and dividend pass-through, corporate and sovereign bonds with default and restructuring mechanics
- **Money** — double-entry financial ledger with per-turn reconciliation, money-supply aggregates, savings accounts with interest, lines of credit, and an IMF with bailout facilities
- **Central banking** — prime-rate corridors, FOMC-style meetings, chair nominations, reserve portfolios, and a reserve-currency ranking
- **Forex** — per-country currencies with era-anchored exchange rates and currency orders
- **Commodities & extraction** — commodity pricing with supply/demand calibration, resource prospecting surveys, extraction contracts, and depletion
- **Labor** — wages, unionization, strikes, union busting, and labor law
- **Public finance** — budgets, treasuries, taxes, subsidies, sovereign debt, regional budgets (UK/DE/JP), and inflation
- **Planned economies** — two-circuit money, administered pricing, planning offices, and marketization paths for command-economy countries
- **Trade** — trade flows, tariffs, and embargoes between countries

### World & Conflict

- Cold War layer: blocs, spheres of influence, alignment drift, bloc stress, crises, and détente
- International organizations with directives, postures, and agencies
- Military: orders of battle, generals and doctrine trees, theaters, battle declarations and reports, peace offers, defence contracts
- Espionage surfaces — stations, active measures — woven into the Cold War ledger

### Community & Platform

- Player mail with abuse reporting, news publishing with reactions and comments, and a National Wire Service
- In-game wiki (auto-generated pages, categories, player pages), player-facing changelog, and public roadmap
- Deep **Discord integration**: a bot API surface (lookups, stock charts, elections, leaderboards, predictions, tickets, role sync) plus outbound game-event webhooks per country
- **Public REST API v1** for characters, corporations, elections, markets, and more — see `/api-guide` in-app
- Extensive admin console: world seeding and reset presets, config toggles, election repair, regime controls, economy pegs, moderation, audit tracing
- Anti-abuse: alt-detection with clustering and calibration, audit anomaly scans, IP bans, moderation tools
- Auth: password, Discord OAuth, Google OAuth, optional Turnstile CAPTCHA; JWT sessions in HTTP-only cookies
- Installable as a PWA; multiple UI themes

---

## Architecture

```
Browser (React 19 / Next.js App Router, PWA)
   │
   ▼
Next.js API Routes ─── JWT auth (jose, HTTP-only cookies)
   │
   ├── REST API (400+ route handlers)
   │     ├── /api/elections        Elections, maps, tallies
   │     ├── /api/legislature      Bills, committees, chambers
   │     ├── /api/corporations     Corporations, sectors, shares
   │     ├── /api/coalitions       Coalitions & government formation
   │     ├── /api/mail /api/news   Player communication
   │     ├── /api/public/v1        Public read API
   │     ├── /api/discord-bot      Discord bot surface
   │     ├── /api/admin            Admin console
   │     └── /api/cron             Hourly turn processor
   │
   ▼
MongoDB (native driver, 100+ document types in src/lib/db/types)
   │
Hourly turn processor (src/lib/turnSystem.ts)
   │
   └── 120+ phases in ordered parallel groups
         ├── Election spawning, resolution & primaries (per country)
         ├── Bill lifecycle, NPP voting, government formation
         ├── Economy: sectors, ledger, banking, bonds, forex, trade
         ├── Demographics, era checkpoints, SCOTUS docket
         ├── Conflict, alignment & crisis phases
         └── Metrics, telemetry & history snapshots
```

---

## Tech Stack

| Layer          | Technology                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Framework**  | [Next.js 16](https://nextjs.org/) — App Router, React Server Components                        |
| **UI**         | [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/)                    |
| **Language**   | [TypeScript 6](https://www.typescriptlang.org/)                                                |
| **Database**   | [MongoDB](https://www.mongodb.com/) via the native driver                                      |
| **Auth**       | Custom JWT via [jose](https://github.com/panva/jose); Discord & Google OAuth; Turnstile        |
| **Validation** | [Zod 4](https://zod.dev/) for request and schema validation                                    |
| **Testing**    | [Vitest](https://vitest.dev/) (unit/integration) · [Playwright](https://playwright.dev/) (E2E) |
| **Monitoring** | Sentry-compatible error tracking (Sentry or GlitchTip) across API, UI, and turn processor      |
| **Storage**    | Cloudflare R2 (S3-compatible) for uploads · local filesystem fallback for dev                  |
| **Deployment** | [Railway](https://railway.com/) with hourly turn processing via cron                           |

---

## Getting Started

### Prerequisites

- Node.js v20+
- npm v10+
- MongoDB (local instance or hosted)

### Installation

```bash
git clone https://github.com/Egg3901/AHDGame.git
cd AHDGame
npm install
```

### Configuration

```bash
cp .env.example .env.local
```

Required values:

```env
MONGODB_URI=mongodb://localhost:27017/a-house-divided
AUTH_SECRET=your-jwt-secret            # openssl rand -base64 32
ADMIN_REGISTRATION_KEY=your-admin-key  # first-admin registration
CRON_SECRET=your-cron-secret           # authenticates the hourly turn cron
INTERNAL_API_KEY=your-internal-key     # server-side scripts and task API
```

`.env.example` documents every supported variable — OAuth providers, error monitoring, Turnstile, Cloudflare R2, and the Discord bot are all optional and fail open for local development (uploads fall back to the local filesystem).

### Seed & Run

```bash
npm run seed        # seed states, demographics, officials
npm run dev         # http://localhost:3000
```

Register the first account with your `ADMIN_REGISTRATION_KEY` to unlock the admin console, where you can bootstrap a full world (era preset, countries, NPPs) from the seeding controls. The turn processor fires via `/api/cron` — hit it manually or on a schedule to advance turns locally.

---

## Authentication

Accounts support **password login** plus optional **Discord OAuth** and **Google OAuth** ("Continue with Discord/Google" and account linking), with optional **Cloudflare Turnstile** CAPTCHA on registration. Sessions are JWTs signed with `AUTH_SECRET` (HS256 via `jose`) and carried in HTTP-only cookies; see `src/lib/auth.ts`. All of the OAuth and CAPTCHA providers fail open when unconfigured, so password auth is all local development needs.

The first account registered with `ADMIN_REGISTRATION_KEY` becomes the admin. Two machine credentials round out the surface: `CRON_SECRET` authenticates the hourly turn cron hitting `/api/cron`, and `INTERNAL_API_KEY` authenticates server-side scripts and the task API. The Discord bot uses its own admin-managed API keys (`src/lib/api/botApiAuth.ts`).

---

## Worldsim & MCP

The repo ships a headless world simulator and an **MCP server** so AI coding agents can drive it:

- `scripts/sim/localWorldsimMcp.ts` — an MCP server over **stdio**. Point an MCP client (Claude Code or any MCP-capable agent) at it and it exposes tools to launch, monitor, and report on full world simulations against a local sandbox Mongo — no ports, no tokens, no production data.
- `scripts/sim/worker.ts` — the sim worker that polls for queued runs and drives the real turn engine at speed; `scripts/sim/local-setup.sh` bootstraps the sandbox.
- `scripts/sim/runWorld.ts` and the `collect*`/report scripts run and analyze simulations directly from the CLI for balance work.

This is how economy and election changes get validated before they ship: simulate hundreds of turns, compare metrics against a baseline, then merge.

---

## Development

```bash
npm run dev           # Dev server with hot reload
npm run build         # Production build
npm run verify        # Lint + format check + typecheck + unit tests
npm run lint          # ESLint (with custom rules in eslint-rules/)
npm run typecheck     # tsc --noEmit
```

### Seeding

```bash
npm run seed              # Full seed (states, demographics, officials)
npm run seed:reset        # Wipe and re-seed
npm run seed:legislation  # Legislation types
npm run seed:policies     # Policy data
npm run seed:demographics # Demographic data
npm run seed:uk           # UK data
npm run seed:de           # Germany data
npm run bootstrap:full    # Full world bootstrap
```

### Testing

```bash
npm test              # Vitest watch mode
npm run test:run      # Single run
npm run test:e2e      # Playwright E2E (requires dev server running)
```

For E2E login-flow tests, add `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` to `.env.local`. See [e2e/README.md](e2e/README.md).

CodeQL scanning runs on GitHub ([.github/workflows/codeql.yml](.github/workflows/codeql.yml)).

---

## Project Structure

```
src/
├── app/                  # Next.js App Router — pages and API routes
│   ├── api/              # REST API (400+ route handlers, incl. /api/public/v1)
│   ├── world/            # World map, blocs, conflicts, trade, crises
│   ├── country/[code]/   # Per-country politics, economy, executive surfaces
│   ├── admin/            # Admin console
│   └── ...
├── components/           # Shared React components
├── lib/                  # Domain logic
│   ├── turn/             # Turn phases (elections, NPPs, economy, era)
│   ├── electionEngine/   # Vote distribution and tallying
│   ├── corporations/     # Corporate lifecycle and sector operations
│   ├── ledger/           # Double-entry financial ledger
│   ├── centralBank/ bonds/ forex/ labour/ budget/ ...
│   ├── demographics/     # Archetypes, granular electorate, era checkpoints
│   ├── scotus/           # Supreme Court simulation and era rosters
│   ├── constants/        # Country configs, era data, economy anchors
│   ├── db/               # Document types and collection getters
│   └── turnSystem.ts     # Turn orchestrator
├── simulation/           # Turn phase registry and simulation harness
scripts/                  # Seeds, migrations, sim tooling
docs/                     # Design system and observability docs
```

---

## Documentation

| Document                                                       | Description                                            |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| **[docs.lakesidegames.net](https://docs.lakesidegames.net)**   | Full design + engineering documentation site           |
| [Design system](./docs/DESIGN.md)                              | UI conventions, theming, component and layout rules    |
| [Source maps & monitoring](./docs/observability/sourcemaps.md) | Wiring a Sentry-compatible backend for readable traces |
| [E2E testing](./e2e/README.md)                                 | Playwright setup and login-flow test accounts          |

**In-game:** `/wiki` — game guides and design documentation
**Changelog:** `/changelog` — player-facing updates

---

## Contributing

Read **[CONTRIBUTING.md](./CONTRIBUTING.md)** — it covers what PRs are welcome, what needs discussion first (balance changes need a worldsim report), the test bar, and setup. Exploits go through **[SECURITY.md](./SECURITY.md)**, never public issues.

---

## License

Licensed under [PolyForm Noncommercial 1.0.0](./LICENSE.md): read it, run it locally, fork it, contribute — any noncommercial purpose. Commercial use, including running a commercial host, is not permitted. "A House Divided" and its logo are trademarks of Lakeside Games; the official servers at [ahousedividedgame.com](https://www.ahousedividedgame.com) are the only official way to play.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute and [SECURITY.md](./SECURITY.md) for reporting vulnerabilities and game exploits.
