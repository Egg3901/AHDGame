---
date: 2026-09-06
title: Public copy reads the playable country list and the version from the game
summary: >-
  The FAQ, the about page, the search snippet and the landing promo pill each
  kept their own hand-typed answer to which countries are open and which
  version is live, and all four had gone stale in different directions. They
  now resolve both from the running world, and a test fails the build if any
  of them starts hardcoding again.
tags: [marketing, seo]
badges: [patch]
areas: [frontend, backend]
era: "Beta 2"
---

Cut from development.

## Fixed

- The about page listed the United States, the United Kingdom and Japan as the
  simulated countries. Japan has not been open to players for months, and the
  Soviet Union and East Germany were missing entirely.
- The landing promo pill advertised v1.0.0, six releases after 1.0.0 shipped.
- The FAQ said corporations could be founded in 12 sectors. There are 17.

## Changed

- Added `lib/marketing/marketedWorld`, which answers "which countries can you
  play" from the same `countryGameStates` read the game itself uses to decide
  whether you may file for office, and "what version is this" from
  `package.json`, which `changelog:release` already bumps. Country names follow
  the era, so a 1953 world says Soviet Union and a 1991 one says Russia.
- The FAQ, the about page, the root metadata, the landing search snippet, the
  SEO keywords and the era world copy all read from it. None of them contains a
  country name or a version number any more.
- Era world copy carries a `{playableCount}` slot instead of spelling the count
  out, so opening or closing a country no longer makes seven strings wrong at
  once.

## Added

- `GET /api/public/facts`: the version, the era and the playable roster as JSON,
  with no API key, for the surfaces we do not render. The studio site had been
  keeping its own copy of these numbers and was advertising twenty-one playable
  countries and an intermission before 1.0.
- `publicCopy.test.ts` fails the build when a marketing surface hardcodes a
  country name, a version string or a count that a registry already knows.
