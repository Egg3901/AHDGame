/**
 * Transactional email via the Resend HTTP API.
 *
 * No SDK dependency: a single fetch to https://api.resend.com/emails. Degrades
 * to a "not configured" no-op when RESEND_API_KEY or EMAIL_FROM is unset,
 * matching how Turnstile and the OAuth providers degrade elsewhere in this
 * codebase, so local dev works without email credentials.
 */

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type SendEmailResult =
  { sent: true; id?: string } | { sent: false; reason: "email-not-configured" | "send-failed" };

export async function sendEmail({
  to,
  subject,
  html,
  text,
}: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    return { sent: false, reason: "email-not-configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) {
      console.error(`sendEmail: Resend responded ${res.status}`);
      return { sent: false, reason: "send-failed" };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: data.id };
  } catch (error) {
    console.error("sendEmail: request failed", error);
    return { sent: false, reason: "send-failed" };
  }
}
