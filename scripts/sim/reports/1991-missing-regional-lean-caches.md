# Missing regional lean caches after reset

Issue #3034 records that the seeded 1991 world has regional demographic rows
but no cached electorate leans for Japan and most economy-tier countries.
Policy approval, candidate enrichment, stance drift and nationwide electorate
readers consequently see missing or neutral leans even though the map can
calculate a lean dynamically.

The finalize pass now derives missing caches after copying the new world's
demographic defaults. It uses the existing turnout-weighted `calculateStateLean`
formula and explicitly weighted categories. Foreign categories cannot influence
a region that does not weight them. Both state and demographic caches receive
the same values; existing finite state caches within the political scale remain
unchanged. Unsupported or cross-country data remains unfilled and is reported
in the finalize log.

Demographic cache writes precede state cache writes. A failed first write does
not falsely mark the state complete; a repeated pass can finish it. No
production world reset or backfill is performed by qualification.

Sixteen passing checks across two suites include five real isolated Mongo
journeys. They cover all eight authored 1991 Japan regions, actual cache values, foreign-category exclusion, preserved
regions, idempotence, unsupported data, a 150-region batch, retry after a failed
write, and the finalize integration order. A fully cached pass uses one
projected read without writes. Filling 150 synthetic regions uses seven
commands and 44,116 reply bytes; an extra 100 KB payload on each demographic
row is projected out. There are no queries per region in the new backfill.

The other seed defects in #3034 and full-world/release qualification remain
open. This component changes cached availability, not the electorate formula.
