<p align="center">
  <h1 align="center">A House Divided</h1>
  <p align="center">
    Real-time multiplayer political simulation — run for office, pass legislation, and shape nations.
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-informational" alt="Version">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="Pull Requests">
  <img src="https://img.shields.io/badge/tests-3400+-success" alt="Tests">
  <img src="https://img.shields.io/badge/code_style-prettier-ff69b4?logo=prettier&logoColor=white" alt="Code Style">
  <img src="https://img.shields.io/badge/license-proprietary-red" alt="License">
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

A House Divided is a browser-based political simulation where players create politicians, compete in elections, form coalitions, pass legislation, and climb from state office to national leadership. The game runs on a turn-based economy (1 turn = 1 real hour) with persistent world state across multiple countries.

Players navigate a realistic political landscape — managing campaign budgets, courting demographic blocs, building party organizations, and maneuvering through legislative bodies. AI-controlled Non-Player Politicians (NPPs) fill every vacant seat and vote on every bill, ensuring the world is always alive regardless of player count.

The simulation spans the **United States**, **United Kingdom**, **Japan**, **Canada**, **Germany**, **Ireland**, **Brazil**, and **China**, with **Nigeria** staged as a planned rollout. The US, UK, and JP are fully playable; Germany now has active Landtag systems and historical seeders while federal flows continue to expand; Canada, Ireland, Brazil, and China currently provide economic/scaffolded surfaces.

---

## Features

### Character & Economy

- Create a politician with policy positions on economic and social axes
- Turn-based action economy — campaign, fundraise, poll, advertise, and build donor networks each hour
- Dedicated campaign HQ with fundraising levels (L0 $20k → L10 $5M/turn), party org scalar, season multiplier
- 12 voter demographic archetypes per state drive electoral appeal
- Party influence mechanic — earn bonus actions proportional to your share of the party's influence pool

### Elections

- **US**: Presidential (Electoral College with travel mechanic), Senate (3 classes), House, State Senate, Governor
- **UK**: House of Commons (650 constituencies, multi-seat proportional), Prime Minister
- **DE**: Landtag elections across 16 German states with proportional seat allocation
- Full primary → general election flow with live vote tallies and trend charts
- County and congressional district result maps with AP-style visualization
- Presidential travel — campaign in specific states for +1% favorability/turn passive bonus
- Perpetual continuity — NPPs automatically fill vacancies so no seat goes uncontested

### Legislature

- **US Congress** — full bill lifecycle (House → Senate → President), Speaker elections, leadership races
- **UK House of Commons** — 650-seat composition, constituency MPs, Commons bills, PM/Opposition Leader
- Legislation v3 — LARP-style bill titles, 11-bracket tax scale, absolute cost model, immigration category, natural metric decay
- Congressional leadership elections auto-trigger after every general election
- Bills: propose with up to 5 provisions, vote; NPPs auto-vote each turn; presidential sign/veto with pocket-signature window
- Two-phase proposed → active pattern for votes and cabinet nominations

### Parties & Government

- Multi-party support with national parties and per-state organizations
- **Coalitions** — national party chairs form cross-party alliances with invite/join flows, disband votes, and chair mechanics
- Independent Chair/Vice Chair/Treasurer elections per state party org
- Presidential Cabinet — nominations, Senate confirmation votes (whippable), fire/replace
- UK government formation, confidence/no-confidence votes with seat-weighted voting
- NPPs hold seats, vote on bills and Speaker candidacies, and respond to player influence (100% whip compliance for confidence/cabinet/leadership)
- 9-category state metrics system (economic, education, healthcare, etc.) with national rankings

### Corporations & Finance

- Found corporations, expand into state markets with 15 sector types
- Public/private founding paths, IPOs, privatization buyout votes, and financial fog of war
- 3-mode sector production policy (Normal, Aggressive, Conservative)
- Shares, dividends, stock splits, CEO elections, HQ relocation
- Shareholder governance and share-issuance votes auto-resolve through turn processing
- Corporate and sovereign bonds with credit ratings
- Stock exchanges (NYSE/FTSE) with OHLC candlestick charts
- 11 commodity types with supply/demand pricing
- Shareholder address broadcasts from CEO to all investors

### Communication

- **Player Mail** — send messages between characters with markdown-lite formatting, inbox/sent box, abuse reporting
- **News** — publish posts, react, comment; automated election and legislation news via National Wire Service
- **Discord bot** — game event webhooks, corporation lookup, stock charts, government data, autocomplete

### Platform

- Multi-country scoped navigation, elections, legislature pages, and economy surfaces (US, UK, JP active; DE Landtag active; CA/IE/BR/CN scaffolded)
- Admin panel — election controls, direct appointments, bulk NPP spawning, resource grants, user management, heal tools, mail reports, leadership elections
- Admin-managed public roadmap with phases, categories, and progress tracking
- 6 themes: Light, Default, OLED Black, USA, Pastel, Dark Pastel
- In-app wiki with design docs and game guides
- 39 achievements with category-organized tile grid and rarity percentages
- 47+ notification event types with pagination, filtering, and bulk management
- Central bank management with resign and auto-resign on cross-country relocation

---

## Architecture

```
Browser (React 19 / Next.js App Router)
   │
   ▼
Next.js API Routes ─── JWT Auth (jose, HTTP-only cookies)
   │
   ├── REST API (400+ route handlers)
   │     ├── /api/elections       Election data, county/CD maps
   │     ├── /api/legislature     US Congress + UK Parliament
   │     ├── /api/whitehouse      Cabinet & executive branch
   │     ├── /api/coalitions      Coalition management (21 routes)
   │     ├── /api/mail            Player mail system
   │     ├── /api/corporations    Corporation & sector management
   │     ├── /api/state           State data, party orgs, metrics
   │     ├── /api/admin           Admin-only management & heal tools
   │     ├── /api/discord-bot     Discord bot endpoints
   │     ├── /api/cron            Hourly turn processor
   │     └── /api/...             50+ route groups total
   │
   ▼
MongoDB (65+ collections)
   │
   ├── characters, users, elections, electionCandidates
   ├── states, stateMetrics, stateDemographicTurnout
   ├── bills, legislatures, congressLeadership
   ├── npps, parties, statePartyOrgs, coalitions
   ├── corporations, corporateSectors, shareOrders, bonds
   ├── playerMail, playerMailReports, notifications
   ├── campaigns, campaignHQs, achievements
   └── gameState (turn counter, timers, flags)

Railway scheduling (hourly cron)
   │
   └── Turn Processor (40+ phases in 14 groups)
         ├── Election timers & resolution (strictly sequential)
         ├── Fund distribution & party finance
         ├── NPP auto-voting & seat filling
         ├── Bill lifecycle (US + UK unified)
         ├── Campaign income & maintenance
         ├── Coalition disband vote resolution
         ├── Policy & demographic effects
         └── National metrics & history snapshots
```

---

## Tech Stack

| Layer          | Technology                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------- |
| **Framework**  | [Next.js 16](https://nextjs.org/) — App Router, React Server Components                        |
| **UI**         | [React 19](https://react.dev/) + [Tailwind CSS 4](https://tailwindcss.com/)                    |
| **Language**   | [TypeScript 6](https://www.typescriptlang.org/)                                                |
| **Database**   | [MongoDB](https://www.mongodb.com/) via native driver (65+ collections, 59 document types)     |
| **Auth**       | Custom JWT via [jose](https://github.com/panva/jose), HTTP-only cookies                        |
| **Validation** | [Zod 4](https://zod.dev/) for request body and schema validation                               |
| **Testing**    | [Vitest](https://vitest.dev/) (unit/integration) · [Playwright](https://playwright.dev/) (E2E) |
| **Monitoring** | [Sentry](https://sentry.io/) for error tracking across turn processor, API, UI, and cron       |
| **Deployment** | [Railway](https://railway.com/) with hourly turn processing via native Railway cron            |
| **Storage**    | [Vercel Blob](https://vercel.com/docs/storage/vercel-blob) (prod) · local filesystem (dev)     |
| **CI**         | GitHub Actions — lint, format, type-check, test                                                |

---

## Getting Started

### Prerequisites

- Node.js v20+
- npm v10+
- MongoDB (local instance or [MongoDB Atlas](https://www.mongodb.com/cloud/atlas))

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

Edit `.env.local` with your values (see [Environment Variables](#environment-variables) below).

### Seed & Run

```bash
npm run seed        # seed state data, demographics, officials
npm run dev         # http://localhost:3000
```

---

## Environment Variables

```env
# Required
MONGODB_URI=mongodb://localhost:27017/a-house-divided
AUTH_SECRET=your-jwt-secret            # openssl rand -base64 32
ADMIN_REGISTRATION_KEY=your-admin-key  # first-admin registration
CRON_SECRET=your-cron-secret           # authenticates the hourly turn cron
INTERNAL_API_KEY=your-internal-key     # server-side scripts and task API

# Optional — Cloudflare R2 for image uploads (falls back to local /uploads)
CLOUDFLARE_R2_ACCOUNT_ID=your-account-id
CLOUDFLARE_R2_ACCESS_KEY_ID=your-access-key-id
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your-secret-access-key
CLOUDFLARE_R2_BUCKET_NAME=ahousedivided
CLOUDFLARE_R2_PUBLIC_URL=https://cdn.ahousedividedgame.com

# Optional — GitHub issue creation from in-game bug reports
GIT_TOKEN=ghp_...
GITHUB_REPO=owner/repo
```

`.env.example` documents every supported variable, including optional OAuth (Discord/Google), Sentry-compatible error monitoring, Turnstile CAPTCHA, and the Discord bot — all optional and fail-open for local development.

---

## Development

### Local Workflow

```bash
npm run dev           # Start dev server with hot reload
npm run build         # Production build
npm run verify        # Lint + format check + typecheck + unit tests (matches pre-push expectations)
npm run lint          # ESLint
npm run format:check  # Prettier format check
npm run typecheck     # TypeScript (`tsc --noEmit`)
```

### Seeding

```bash
npm run seed              # Full seed (states, demographics, officials)
npm run seed:reset        # Wipe and re-seed
npm run seed:legislation  # Seed legislation types
npm run seed:policies     # Seed policy data
npm run seed:demographics # Seed demographic data
npm run seed:budgets      # Seed budget data
npm run seed:uk           # Seed UK-specific data
npm run seed:de           # Seed Germany-specific data
```

### Testing

```bash
npm test              # Vitest watch mode
npm run test:run      # Single run (used in CI)
npm run test:e2e      # Playwright E2E (requires dev server running)
```

For E2E login-flow tests, add `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` to `.env.local`. See [e2e/README.md](e2e/README.md).

### Checks

Run the same gate locally before opening a PR:

1. **Lint** — `npm run lint`
2. **Format** — `npm run format:check`
3. **Type-check** — `npm run typecheck`
4. **Test** — `npm run test:run`

`npm run verify` runs all four. CodeQL scanning runs on GitHub ([.github/workflows/codeql.yml](.github/workflows/codeql.yml)).

---

## Project Structure

```
src/
├── app/                        # Next.js App Router — pages and API routes
│   ├── api/                    # REST API (400+ route handlers)
│   │   ├── cron/               # Turn processor and cron jobs
│   │   ├── elections/          # Election data and county/CD maps
│   │   ├── legislature/        # US Congress + UK Parliament endpoints
│   │   ├── whitehouse/         # Cabinet and executive endpoints
│   │   ├── coalitions/         # Coalition management (21 routes)
│   │   ├── mail/               # Player mail system
│   │   ├── corporations/       # Corporation and sector management
│   │   ├── discord-bot/        # Discord bot API endpoints
│   │   └── admin/              # Admin-only management routes
│   ├── congress/               # Congress pages (composition, bills, leadership)
│   ├── elections/              # Election list, map, and detail pages
│   ├── legislature/            # UK Parliament page
│   ├── parties/                # Parties and coalitions pages
│   ├── notifications/          # Notifications and mail inbox
│   ├── country/[code]/         # Multi-country overview and map
│   └── ...
├── components/                 # Shared React components
│   ├── elections/              # Election cards, charts, donuts
│   ├── admin/                  # Admin panel tabs
│   ├── party/                  # Party and coalition components
│   └── state/                  # State page components
├── lib/                        # Server-side utilities and domain logic
│   ├── turn/                   # Turn phases (40+ files in election/, npp/, partyOrg/)
│   │   ├── election/           # Election spawning, seat allocation, president resolution
│   │   ├── npp/                # NPP election entry, bill voting, leadership voting
│   │   └── partyOrg/           # Party organization momentum, cleanup, presence
│   ├── electionEngine/         # Vote distribution, tally management
│   ├── api/                    # Route helpers: auth guards, validation, rate limiting
│   │   └── schemas/            # Shared Zod schemas
│   ├── db/                     # DB types (59 document types) and collection getters
│   ├── auth.ts                 # JWT authentication helpers
│   ├── mongodb.ts              # Database connection
│   └── turnSystem.ts           # Turn processing orchestrator (14 groups)
scripts/
├── seeds/                      # Seed data (states, budgets, policies, demographics)
├── migrations/                 # Database migration scripts
└── audit/                      # Quality assessment utilities
docs/                           # Design system and observability docs
```

---

## Documentation

| Document                                                   | Description                                            |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| [Design system](./docs/DESIGN.md)                          | UI conventions, theming, component and layout rules    |
| [Source maps & monitoring](./docs/observability/sourcemaps.md) | Wiring a Sentry-compatible backend for readable traces |
| [E2E testing](./e2e/README.md)                             | Playwright setup and login-flow test accounts          |

**In-game:** `/wiki` — game guides and design documentation
**Changelog:** `/changelog` — player-facing updates (admin toggle for dev view)

---

## Roadmap

Development priorities are tracked on the in-game roadmap (`/roadmap`), managed through the admin panel. US, UK, and JP are fully playable; Germany has active Landtag systems with continuing federal expansion; Canada, Ireland, Brazil, and China are scaffolded/economic surfaces. Current focus areas include onboarding, mobile polish, president actions, and legislation → demographics integration.

---

## Contributing

1. Branch off **`main`** with a descriptive feature branch name
2. Add a `CHANGELOG.md` entry when your change warrants it
3. Run `npm run verify` before pushing
4. New API routes require integration tests — see existing `route.test.ts` files for the pattern
5. Open a PR into **`main`**

---

## License

This project is proprietary. All rights reserved.
