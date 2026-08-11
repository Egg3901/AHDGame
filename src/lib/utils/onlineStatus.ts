/**
 * Derive a short online / last-seen label from user last activity.
 */
export function getOnlineStatus(lastActivity: Date | null): { text: string; isOnline: boolean } {
  if (!lastActivity) return { text: "Unknown", isOnline: false };

  const now = Date.now();
  const lastActiveTime = new Date(lastActivity).getTime();
  const diffMs = now - lastActiveTime;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

  if (diffMinutes < 15) {
    return { text: "Online", isOnline: true };
  }

  if (diffMinutes < 60) {
    return { text: `${diffMinutes}m ago`, isOnline: false };
  }

  return { text: `${diffHours}h ago`, isOnline: false };
}
