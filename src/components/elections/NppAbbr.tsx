/**
 * Plain-language definition for the "NPP" tag shown next to candidates and
 * officeholders. Kept in one place so every surface explains it the same way.
 */
export const NPP_DEFINITION =
  "NPP: non-player politician. A game-run politician who campaigns, votes, and holds office alongside players. Parties recruit and direct them.";

/** "NPP" with its definition on hover, focus, and long-press. */
export function NppAbbr({ className }: { className?: string }) {
  return (
    <abbr title={NPP_DEFINITION} className={`cursor-help no-underline ${className ?? ""}`.trim()}>
      NPP
    </abbr>
  );
}
