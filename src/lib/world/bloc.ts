/**
 * The built-in Cold War bloc union. Player-founded Bloc poles extend this in
 * the map and military treaty rolls without changing the preset labels.
 *
 * It lives in `lib` rather than beside the globe's presentation constants because the
 * domain layer needs it: `blocMembership` produces these preset values, and the
 * military system consumes them alongside custom pole ids. The map re-exports
 * the preset type as `WorldBloc` for its built-in palette.
 *
 * Non-aligned is a real answer, not a gap — it is what a country the era names but no
 * accession-governing alliance has claimed actually is.
 */
export type WorldBloc = "west" | "east" | "nonAligned";
