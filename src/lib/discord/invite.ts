export function normalizeDiscordInviteUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  try {
    const url = new URL(trimmedValue);
    const protocol = url.protocol.toLowerCase();
    const host = url.hostname.toLowerCase();
    const pathSegments = url.pathname.split("/").filter(Boolean);

    if (protocol !== "http:" && protocol !== "https:") {
      return null;
    }

    if (host === "discord.gg" && pathSegments[0]) {
      return `https://discord.gg/${pathSegments[0]}`;
    }

    if ((host === "discord.com" || host === "www.discord.com") && pathSegments[0] === "invite") {
      const inviteCode = pathSegments[1];
      if (inviteCode) {
        return `https://discord.com/invite/${inviteCode}`;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function isDiscordInviteUrl(value: string | null | undefined): boolean {
  return normalizeDiscordInviteUrl(value) !== null;
}
