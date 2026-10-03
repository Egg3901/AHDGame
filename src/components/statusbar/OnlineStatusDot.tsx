/**
 * Static online dot for the StatusBar. The "Online" label beside it carries the
 * meaning, so the dot does not animate.
 */
export function OnlineStatusDot() {
  return <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />;
}
