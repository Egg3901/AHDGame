/** Small display helpers local to the live results page. */

export function formatVotes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatMargin(margin: number, marginPct: number): string {
  return `+${formatVotes(margin)} · ${marginPct.toFixed(1)}%`;
}

export function timeAgoLabel(from: Date | null): string | null {
  if (!from) return null;
  const seconds = Math.max(0, Math.round((Date.now() - from.getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}
