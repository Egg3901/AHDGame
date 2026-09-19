/**
 * Forwarder. The United Kingdom's perpetual-election spawners moved to the
 * country folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. `ensureUKElections`,
 * `ensureUKRegionalCouncilElections` and `ensureUKGovernorElections` have
 * exactly one definition, at `@/lib/countries/uk/elections/perpetual`. The
 * registry still imports them from here, unchanged, exactly as Japan's shim
 * works.
 */
export * from "@/lib/countries/uk/elections/perpetual";
