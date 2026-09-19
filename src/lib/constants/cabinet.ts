/**
 * Forwarder. The United States' cabinet positions moved to its country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. `CABINET_POSITIONS`, `CabinetPositionId` and
 * `getCabinetPositionById` have exactly one definition, at
 * `@/lib/countries/us/cabinet/positions`. The `@/lib/constants` barrel re-exports
 * from here, so the twelve API routes that read a position name are unchanged.
 */
export * from "@/lib/countries/us/cabinet/positions";
