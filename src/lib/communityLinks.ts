/** Public community URLs surfaced on the landing page and marketing surfaces. */

import { HELP_PATREON_URL } from "@/components/HelpDropdown";

/**
 * The server's permanent invite. The previous code (p2kseZKCW) expired, which
 * left the landing page's Discord button and member count pointing at an
 * "Unknown Invite". Use this one constant everywhere rather than pasting codes.
 */
export const COMMUNITY_DISCORD_INVITE_CODE = "DmF8zJJuqN";

export const COMMUNITY_DISCORD_URL = `https://discord.gg/${COMMUNITY_DISCORD_INVITE_CODE}`;

/** Patreon membership page; override via NEXT_PUBLIC_PATREON_URL when set. */
export const COMMUNITY_PATREON_URL = HELP_PATREON_URL;
