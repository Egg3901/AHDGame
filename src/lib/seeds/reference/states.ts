/**
 * Forwarder. Moved to the United States' country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. It re-exports, so there is exactly one
 * definition. Existing importers keep working unchanged; new code should import
 * from `@/lib/countries/us/data/usStates` directly.

 * ⚠️ The 51 state rows. Every row is `countryId: "US"`; the file sat in a SHARED seeds directory under a generic name because the US is the default country.
 */
export * from "@/lib/countries/us/data/usStates";
