/**
 * Forwarder. Japan's event handlers moved to the country folder.
 *
 * ⚠️ A SIDE-EFFECTING IMPORT, NOT A RE-EXPORT. This module registers handlers
 * through `registerEventHandler` and exports nothing, so there is no binding to
 * forward. The bare import is what keeps the registration happening for anyone
 * who reaches this path; `export * from` would also work, but it would read as
 * though something were being re-exported when nothing is.
 *
 * ⚠️ IT WAS CLASSIFIED BUCKET D -- RELOCATE -- AND PHASE D7, AND D7 FINISHED
 * WITHOUT IT MOVING. The coverage roster checked that a file was classified as
 * needing to move, never that it had moved, so this sat correctly labelled and
 * in the wrong place with a mechanical guard watching. `singleCountryData.ts`
 * now asks the other question.
 */
import "@/lib/countries/jp/events";
