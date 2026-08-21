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

Follow the README. `npm run bootstrap:full` creates a complete local world; `npm run seed` only loads the US reference pack.

## The bar for a PR

1. Branch off `development` and target `development` with the PR. One topic per PR, small over large.
2. Run `npm run verify` for lint, format, typecheck, the architecture audit, and tests. Run `npm run verify:build` for the same Next build CI uses. The architecture audit has known pre-existing findings; new findings from your change are yours, old ones aren't.
3. New or changed API routes need integration tests. Copy the pattern from any `route.test.ts`.
4. New logic gets unit tests next to it.
5. Every PR ships a changelog entry with the change. Run `npm run changelog:new -- "Title of the change"`; it writes `content/changelog/dev/<version>-<topic>.md`, named for your branch so it cannot collide with another PR in flight. The version in the frontmatter is a label, not a claim: two entries may carry the same number and both merge cleanly. Player-visible releases also get a curated `content/changelog/public/<version>.md`, which is the published URL and stays named for the version alone. The generated frontmatter lists the accepted `badges` (`major`, `minor`, `patch`, `hotfix`) and `areas` (`backend`, `frontend`, `fullstack`, `engine`) in a comment; anything else fails the pre-commit hook and CI. Descriptive words for what the change was about go in `tags`, which is free text.
6. Match the surrounding code: strict TypeScript, Zod on request bodies, collection access through `src/lib/db/collections` getters, no new dependencies without discussion. No em or en dashes in player-facing text.
7. The PR body says why, not just what.

Code layout in one minute: `src/app/api/**` are thin route handlers (auth guard, Zod, call into lib). `src/lib/**` is the domain logic, one directory per system. The hourly turn processor is `src/lib/turnSystem.ts` with phases registered in `src/simulation/phases/`. Seeds are in `scripts/seeds/` (data) and `scripts/seed/` (runners). The [engineering docs](https://docs.lakesidegames.net) go deeper.

## UI strings and translations

The UI chrome (navigation, settings, tutorial) is localized with next-intl. Game-generated content (news, mail, notifications, legislation) stays English. The locale comes from the `ahd-locale` cookie, not the URL; players pick a language under Settings > Appearance.

- Catalogs live in `messages/<locale>/<namespace>.json`, one top-level namespace per file. English is the source of truth; missing keys in other locales fall back to English at request time.
- New chrome copy goes in the catalog, resolved with `useTranslations("<namespace>")` (client) or `getTranslations` (server). Use ICU for plurals and interpolation; never build sentences from concatenated fragments or `s` suffix ternaries.
- Data modules that feed rendered chrome (nav menu definitions, settings section configs, tutorial chapters) store message keys; the rendering component resolves them.
- Adding a locale: extend `SUPPORTED_LOCALES` in `src/i18n/locales.ts` and create `messages/<locale>/` mirroring `messages/en/`. Natural phrasing over literal translation; informal address (du-form in German); the player-copy rules above apply in every language.

## Review

The maintainer reviews every PR. Balance and economy paths get extra scrutiny and may require a worldsim run. Squash merge only; your PR title becomes the commit message, so write it like one.

By contributing you agree your contribution is licensed under [PolyForm Noncommercial 1.0.0](./LICENSE.md) and that Lakeside Games may use it in the hosted game.
