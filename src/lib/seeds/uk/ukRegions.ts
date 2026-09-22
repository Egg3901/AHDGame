/**
 * Forwarder. Moved into the United Kingdom's country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY; existing importers are untouched.
 *
 * ⚠️ THE DEFAULT IS RE-EXPORTED SEPARATELY, BECAUSE `export *` DOES NOT CARRY
 * IT. That is not a style choice -- it is the ES module spec, and it fails at
 * the consumer rather than here: `seedUK.ts` does `(await import(...)).default`
 * and typecheck reported "Property 'default' does not exist" on a module that
 * plainly has one. Every shim over a module with a default export needs this
 * second line.
 */
export * from "@/lib/countries/uk/data/ukRegions";
export { default } from "@/lib/countries/uk/data/ukRegions";
