// SERVER ONLY. This barrel re-exports `fiscal`, which reaches the Mongo driver
// through @/lib/bonds/sovereign. Importing it from anything a client component
// can reach pulls the driver into the client bundle and fails the production
// build with unresolved node builtins — typecheck and the test suite both pass
// while that is broken, so `npm run build` is the only thing that catches it.
//
// From client-reachable code, import the leaf module instead:
//   import { directionLabel } from "@/lib/legislature/provisionEnrichment/optionLabel";
// Type-only imports from this barrel are erased at compile time and are safe.
export * from "./types";
export * from "./optionLabel";
export * from "./resolvePolicyOption";
export * from "./currentLaw";
export * from "./fiscal";
export * from "./resolvePolicyProvision";
export * from "./snapshot";
