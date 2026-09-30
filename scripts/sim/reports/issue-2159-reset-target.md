# Reset CLI database selection

Issue: #2159. Runtime: `18bd0310422e043e957c37ca1402db2e51867506`.

The CLI previously selected the URI database through `connectDb()`, while nested
runtime helpers honored `MONGODB_DB`. With different names, one reset could address
two worlds. The CLI now uses the canonical app resolver, requires an exact
`--expect-db` assertion, and pins that selection for nested helpers. The reset
implementation loads only after target checks succeed.

Eight focused tests cover database precedence, aliases, explicit default selection,
and missing, blank, duplicate or mismatched assertions. Four actual CLI invocations
against two fresh sandbox Mongo databases passed on the clean runtime above:

| Case                                          | Exit | Selected database | Both canaries unchanged |
| --------------------------------------------- | ---- | ----------------- | ----------------------- |
| URI A, override B, expected B, check only     | 0    | B                 | Yes                     |
| URI A, override B, expected A, check only     | 1    | None              | Yes                     |
| URI A, override B, no expectation, check only | 1    | None              | Yes                     |
| URI A, no override, expected A, check only    | 0    | A                 | Yes                     |

The probe compared collection metadata and canary contents after every invocation.
No reset was performed. The initial probe timed out while importing the complete
reset dependency graph; deferring that import made the checked path terminate
successfully. The complete reset rehearsal and existing-world normalization remain
separate, unqualified parts of #2159. This change does not alter other script callers
that omit the optional `connectDb` database argument.
