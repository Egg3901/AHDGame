/**
 * Forwarder. Japan's 1991 non-player-politician roster moved to the country
 * folder.
 *
 * ⚠️ A FORWARDER HOLDS NO COPY. `ROSTER_1991_JP` has exactly one definition, at
 * `@/lib/countries/jp/data/jpNppRoster1991`. `historicalRosters.ts` still
 * imports it from here and is untouched.
 *
 * ⚠️ THE DEFERRAL THAT KEPT IT HERE HAD EXPIRED. It was acknowledged as
 * "moving it now would widen a merge into a fresh migration" -- true when the
 * merge from origin/development was in flight, and stale once `b1605b15b`
 * landed. A reason that stops being true is how a deferral becomes permanent,
 * so the entry was re-read rather than re-honoured.
 */
export * from "@/lib/countries/jp/data/jpNppRoster1991";
