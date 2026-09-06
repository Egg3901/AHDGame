---
date: 2026-09-06
title: Changelog entries are cut per release, not per pull request
summary: >-
  313 per-change entries reaching 1.4.63 are folded into the ten releases that
  actually happened, ending at 1.6.0. A pull request now writes a versionless
  note and only the release script mints a version, and merging a version bump
  to main tags it and opens the GitHub release.
# Free text. What the change was about: economy, elections, balance, corporations.
tags: [changelog, releases, tooling]
# How big this change is, which sets how it is grouped in the release post.
# One of: major | minor | patch | hotfix
badges: [minor]
# Which part of the codebase moved. Any of: backend | frontend | fullstack | engine
areas: [fullstack]
---

## What changed

- The entries under `content/changelog/dev/` are one post per release, named
  for the version alone. Twenty retired public URLs redirect to the release
  that absorbed them.
- A pull request writes `content/changelog/unreleased/<topic>.md`, which
  carries no version. `npm run changelog:release -- <version> --title "..."`
  folds every note into one post, drafts the public post and bumps
  `package.json`.
- Merging a version bump to `main` tags `v<version>` and opens the GitHub
  release from the public post. The repository had no releases before this:
  the newest tag was `v0.2.8`.
