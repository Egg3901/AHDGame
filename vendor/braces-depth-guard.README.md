# Local braces security fork

`braces-depth-guard-3.0.3-ahd.1.tgz` contains the MIT-licensed runtime files from
[upstream security PR 72](https://github.com/micromatch/braces/pull/72), pinned to
commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`. It is packaged as the private,
local fork `@lakeside/braces-depth-guard`, rather than claiming that the npm
`braces@3.0.3` release has been fixed.

The source bounds brace and parenthesis nesting at 100, enforces that bound in
direct compile, expand and stringify AST calls, and rejects cyclic parent chains
in expansion. Ordinary brace matching and expansion retain the upstream API.
The bound addresses stack exhaustion, not arbitrary expansion cardinality.

The root npm override installs this corrected package wherever tooling requests
`braces`. The package includes its upstream MIT license and source provenance.
Post-install verification checks the fork identity and SHA-256 of every runtime
file without rewriting installed code. Regression tests exercise the advisory,
depth boundaries, option bypasses, cyclic ASTs and actual glob consumers.

Rebuild from the immutable upstream archive with:

```sh
node scripts/install/pack-braces-depth-guard.mjs
```

The rebuild verifies the reviewed archive hash, copies the runtime source
unchanged, adds the fork manifest and provenance, and packs without running
upstream lifecycle scripts. The lockfile pins the resulting archive integrity.

This fork is maintained locally while upstream has no published fixed release.
An npm audit does not assess this fork against the original package's advisory;
its safety is established by source review and regression and compatibility
tests. Registry dependencies, including `fill-range`, remain audit covered.
Replace the override with a compatible, reviewed upstream security release when
available, then remove the fork, rebuild script and install verifier together.
