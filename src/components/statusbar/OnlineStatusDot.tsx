/**
 * Live-online ping dot for StatusBar.
 *
 * The Tailwind `animate-ping` scales to 2×. If the wrapper is only as big as the
 * solid dot, the pulse paints over adjacent timer / count / label text — worst
 * under command-1953 where monospace + letter-spacing already packs the bar.
 * Reserve a 2× box and center the dot so the pulse stays inside its lane.
 */
export function OnlineStatusDot() {
  return (
    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
      <span className="absolute h-2 w-2 animate-ping rounded-full bg-success opacity-50 motion-reduce:animate-none" />
      <span className="relative h-2 w-2 rounded-full bg-success" />
    </span>
  );
}
