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

## A branch cut before this

If your branch carries `content/changelog/dev/<version>-<topic>.md`, the guard
will reject it. Run:

```
npm run changelog:migrate
```

That moves the entry to `content/changelog/unreleased/<topic>.md` and strips the
version. Commit the move; the release that carries it assigns the number.

## Why it works this way

The generator used to hand out the next unused patch number per entry, which
made a version a per-pull-request unit. In six weeks that produced 313 entries
and reached 1.4.63, with 193 of them inside the 1.4 line alone and dozens
sharing a patch number. "1.4.38" was not a release, it was six unrelated pull
requests that merged on the same afternoon. On 2026-09-06 those entries were
folded into the ten releases that actually happened, ending at 1.6.0, and only
`changelog:release` mints a version now.

## Release review

Before cutting, compare the previous release tag with the production source,
not the author dates of commits. A branch written weeks ago can have reached
production today. Match every production change to a release note or a named
developer maintenance item; missing notes must be recovered from the source.
Keep notes for work that has not reached production in `unreleased/`.

Give balance changes their own prominent section. State the old and new values,
the affected countries or rulesets, and whether the change affects existing
worlds, newly created worlds or a gradual ramp. The developer fold preserves
the full note body as well as its summary, so detailed rules survive when the
source note is removed. Rewrite the public draft before publishing it.

Keep existing version URLs. A small packaging fix can remain a real patch
release, but describe the actual fix instead of a bare version bump. Correct
older player posts where the original developer record already described a
material change. Developer source references and `content/changelog/coverage.json`
retain the production inventory; pending qualification belongs in developer
notes and is excluded from player-facing shipped claims.
