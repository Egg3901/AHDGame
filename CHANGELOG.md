# Changelog

One post per release, named for its version, under `content/changelog/dev/`.
Pre-0.4.0 history is frozen in `content/changelog/legacy/CHANGELOG.md` and
rendered at `/changelog/legacy`.

## Adding to it

A pull request writes a note, not a version:

```
npm run changelog:new -- "Union dues cost campaign funds"
```

That creates `content/changelog/unreleased/<topic>.md`, named for your branch so
two branches in flight never write the same path. It carries no version, because
a version belongs to a release and your pull request is not one.

## Cutting a release

```
npm run changelog:release -- 1.6.1 --title "Bond market depth"
```

That folds every note in `content/changelog/unreleased/` into one
`content/changelog/dev/<version>.md`, drafts a player-facing
`content/changelog/public/<version>.md` for you to rewrite, sets the version in
`package.json`, and empties the unreleased directory. Merging the result to
`main` is what publishes it: the Release workflow tags `v<version>` and opens
the GitHub release from the public post.

## Why it works this way

The generator used to hand out the next unused patch number per entry, which
made a version a per-pull-request unit. In six weeks that produced 313 entries
and reached 1.4.63, with 193 of them inside the 1.4 line alone and dozens
sharing a patch number. "1.4.38" was not a release, it was six unrelated pull
requests that merged on the same afternoon. On 2026-09-06 those entries were
folded into the ten releases that actually happened, ending at 1.6.0, and only
`changelog:release` mints a version now.
