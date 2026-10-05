/**
 * Discord sign-up stores `discord_<snowflake>@discord.local` because the users
 * collection requires a unique email. That address cannot receive mail, so UI
 * and email-change code treat it as "no email on file".
 */
export const PLACEHOLDER_EMAIL_DOMAIN = "discord.local";

export function isPlaceholderEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  return email.toLowerCase().endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`);
}
