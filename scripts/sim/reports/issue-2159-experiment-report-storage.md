# Experiment report storage recovery

## Result

The completed 1991 simulation `900f5fbc-3c4f-4f71-ae98-c544526ead1d` originally failed report persistence because its metadata document was 26,314,086 bytes, above MongoDB's 16 MiB document limit. Its engine had completed successfully. Nested long-horizon telemetry was the oversized field.

The collector now chunks the nested approval and macro points and series, in addition to the existing three top-level timelines. A version 2 manifest records each field's point and chunk counts. Metadata remains bounded; invalid or incomplete generations fail explicitly. Inline reports and version 1 manifests remain readable without migration. No telemetry is truncated.

## Executed evidence

All storage and recovery execution used clean collector source `e7b1d32d560f465307b1c7c43db456dfd45051aa`.

| Check                                  | Observed result                                       |
| -------------------------------------- | ----------------------------------------------------- |
| Real Mongo synthetic input             | 27,054,088 bytes                                      |
| Synthetic metadata                     | 959 bytes                                             |
| Synthetic chunk count / largest chunk  | 7 / 8,349,819 bytes                                   |
| Synthetic reconstruction               | Exact fields; caller input unchanged                  |
| Inline and version 1 compatibility     | Passed                                                |
| Repeated version 2 write               | Replaced generation, no old active chunks             |
| Completed-world metadata               | 143,584 bytes                                         |
| Completed-world chunks / largest chunk | 10 / 8,262,884 bytes                                  |
| Recovered timeline points              | Seats 1,703; party organization 300; corporations 160 |
| Recovered nested points                | Approval 1,860; macro 3,720                           |
| Completed source preservation          | All 224 collection hashes identical before and after  |
| Focused TypeScript tests               | 34 passed across three suites                         |

The synthetic fixture exercises actual Mongo storage above the document limit. It is distinct from the completed-world recovery. See the adjacent JSON for the measurements and source hash.

## Source provenance and recovery boundary

The recovered world executed `ac37b0ee191089e1e1a0c501a29e691b45450211`, preset `1991-default`, ten normal turns ending at raw turn 11. Only its collector was rerun. The report preserves the original requested and executed runtime commits and separately records the collector commit and `collectionMode: recovery`.

Recovery requires an explicitly completed job, matching retained sandbox destination, clean collector, and exact full runtime and collector commits. Ordinary collection still requires the collector to match the runtime source. The old job report error is cleared only after successful persistence and a matching completed-job compare-and-set.

## Reader delivery

The canonical Rust reader change is [lakeside-code PR #52](https://github.com/Egg3901/lakeside-code/pull/52). Its focused checks are pending and it is not deployed at this report revision. It preserves the existing MCP response schema and `maxPoints` sampling, hydrating only the three timelines that the tool exposes. Nested telemetry remains available through the full TypeScript reader. The actual Rust Mongo regression uses the same retained synthetic inline, version 1 and version 2 fixtures.

## Limits

This fixes report storage and recovery. The original run's 49 critical bootstrap conformance diagnostics remain independent findings. This evidence does not establish that those mechanics passed, or qualify a longer horizon. No game turn code or economic constants changed.
