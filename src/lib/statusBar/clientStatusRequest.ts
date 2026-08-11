export const STATUS_BAR_LAYOUTS = ["standard", "corp", "elections", "full", "minimal"] as const;

export type StatusBarLayout = (typeof STATUS_BAR_LAYOUTS)[number];

export function normalizeStatusBarLayout(layout?: string | null): StatusBarLayout {
  if (!layout) return "standard";
  return STATUS_BAR_LAYOUTS.includes(layout as StatusBarLayout)
    ? (layout as StatusBarLayout)
    : "standard";
}

export function buildClientStatusUrl(layout?: string | null): string {
  const normalizedLayout = normalizeStatusBarLayout(layout);
  return `/api/client-status?layout=${normalizedLayout}`;
}
