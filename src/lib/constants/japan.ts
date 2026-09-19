/**
 * Forwarder. Japan's region directory moved to the country folder.
 *
 * ⚠ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Existing importers keep working unchanged; new code should import
 * from `@/lib/countries/jp/data/jpRegionDirectory` directly.
 *
 * ⚠ TWO EXPORTS WERE DROPPED RATHER THAN MOVED. `JP_PARTIES` and
 * `JP_EXECUTIVE` had no consumers anywhere and both restated what the folder
 * already owns -- the party roster in `data/jpParties.ts`, the executive titles
 * in `institutions`. `JP_EXECUTIVE.headOfState` had already drifted to
 * "Emperor" against the folder's "The Emperor", which is what a second source
 * does when nothing reads it. Relocating them would have preserved the problem
 * this move exists to end.
 */
export * from "@/lib/countries/jp/data/jpRegionDirectory";
