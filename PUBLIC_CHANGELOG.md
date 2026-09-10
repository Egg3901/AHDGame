# What's New

One player-facing post per release, named for its version, under
`content/changelog/public/`. The stem is the published URL
(`/changelog/<version>`) and is in the sitemap, so it never changes once
shipped. Retired addresses are redirected in
`src/lib/changelog/retiredSlugs.ts`.

Pre-0.4.0 history is frozen in `content/changelog/legacy/PUBLIC_CHANGELOG.md`
and rendered at `/changelog/legacy`.

`npm run changelog:release` drafts the post for a new version from the notes it
folds. The draft is raw material: rewrite it as prose for a player, and keep em
and en dashes out of it. See [CHANGELOG.md](./CHANGELOG.md) for the full flow.
