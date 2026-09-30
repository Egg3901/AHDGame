# Brazil and Ireland aggregate opening offices

Issue: #2072, with the seat/office consistency gate in #2159. Runtime source: `099e8f0904668306c6b2d80c228f698fffbd5f61`, stacked on #2605 at `4c7f2e9e8775f44c87b9485e026f57c749199d80`. Executed 2026-09-30 on the loopback sandbox Mongo service. The fixture created and dropped three disposable `ahd_sim_issue2072_aggregate_*` databases. It did not read or write the live game database.

The owner approved synthetic holders and elections for five existing Brazilian macroregion governor seats and eight existing Irish aggregate local councils and chairs. These game regions combine real jurisdictions, so this source does **not** claim that any seeded name, chair, governor, council seat allocation, or party result is a historical officeholder or election result. It does not create real Brazilian states or Irish local authorities.

The deterministic opening-party assumptions are explicit in `aggregateRegionalOffices.ts`:

| Preset | Brazilian synthetic governors | Irish synthetic councils and chairs |
| --- | --- | --- |
| 1991 | One party-leading holder per existing macroregion, using the already modeled 1991 regional vote-share estimates. | The existing 1989 regional party-share estimates allocate each modeled council's seats by Hamilton apportionment. The unallocated share becomes independent lists. The leading named party takes each chair. |
| 2019 | The existing 2019 preset party-share estimates determine the five holders. | The existing 2024 regional estimate is reused as a **model backcast** for the 2019 preset, consistent with its current party-organization seed. It is not a 2019 historical result. |
| 2027 | The latest modeled 2019 party baseline is carried forward. | The latest modeled 2024 party baseline is carried forward. Neither carry-forward asserts a future outcome. |

The Irish council sizes remain the game's pre-existing aggregate sizes, now read from one shared constant: DUB 62, KIL 26, COR 25, DON 21, GAL 19, LIM 18, WEX 17, MID 12, totaling 200. NIR's 95 seats remain outside the opening eight-region roster and are available only through the separate joined-region path. The residual independent allocation is a set of lists, not a unified chair party; the chair is selected from the strongest named party. The generated NPP identities remain visibly synthetic and use the normal seed provenance and office links.

The new Brazilian governor spawner is registered in the bootstrap and country turn paths. Its cycle uses Brazil's existing general-election anchor, giving modeled next cycles in 1994, 2022, and 2030 for the three presets, then a four-game-year cadence. This corrects the shared governor anchor's 2024 timing for the 2019 Brazil case. Other countries' governor timing is unchanged. Ireland's existing council and Cathaoirleach spawners stay on their existing modeled five-year and four-year cycles, respectively; those aggregate chairs are a game election model, not a historical account of appointment by actual councils.

Qualification:

- `npx vitest run src/lib/seeds/reference/rules/aggregateRegionalOffices.test.ts src/lib/turn/countryPhases.br.test.ts --reporter=dot`: 5 passed, 0 failed. It checks all three target rosters, five and eight region keys, 200 council mandates, deterministic repeat output, country phase registration, and no new 1953/1979 aggregate rows.
- `AHD_AGGREGATE_OFFICES_REAL_MONGO=1 npx vitest run src/lib/seeds/reference/rules/aggregateRegionalOffices.mongo.test.ts --maxWorkers=1 --no-file-parallelism --reporter=dot`: 1 passed, 0 failed, 32.60 seconds. For each target preset it uses the production `seedFromSeats` with actual sandbox Mongo reads and writes, verifies each seeded official and NPP office link, aggregate mandate totals, valid seeded party names, and zero new officials/NPPs on a second seed. Ordinary CI skips this opt-in Mongo case when no sandbox service is present.
- The new Brazil cycle assertion in `canonicalCycle.test.ts` is part of the scoped regression and CI gate; its result must be recorded after execution.

This closes the documented BR/IE **aggregate opening vacancy** in the authored seat roster. It does not assert that every other 2019/2027 national legislature is authored, that a full world bootstrap has passed, or that #2072/#2159 is ready to close. The selected 1991 and 2019 source still depends on Track 1 integration and its queued source-pinned whole-world qualification.
