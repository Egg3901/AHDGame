/**
 * The Cold War bloc union, in one place so both the globe and the military system read
 * the same three values.
 *
 * It lives in `lib` rather than beside the globe's presentation constants because the
 * domain layer needs it: `blocMembership` produces it, and the military system consumes
 * it. `src/app/world/worldBlocs.ts` re-exports it as `WorldBloc`, which is the name the
 * map components already use.
 *
 * Non-aligned is a real answer, not a gap — it is what a country the era names but no
 * accession-governing alliance has claimed actually is.
 */
export type WorldBloc = "west" | "east" | "nonAligned";
