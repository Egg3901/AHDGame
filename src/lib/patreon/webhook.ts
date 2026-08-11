import { createHmac, timingSafeEqual } from "crypto";
import { unauthorized } from "@/lib/api/errors";
import { getPatreonWebhookSecret } from "./config";

export interface PatreonWebhookEnvelope {
  eventType: string;
  payload: {
    data?: {
      attributes?: {
        patron_id?: string;
      };
      relationships?: {
        patron?: {
          data?: {
            id?: string;
          };
        };
        currently_entitled_tiers?: {
          data?: Array<{ id?: string }>;
        };
      };
    };
  };
}

export function verifyPatreonWebhookSignature(body: string, signature: string | null): boolean {
  const secret = getPatreonWebhookSecret();
  if (!secret || !signature) return false;

  const expected = createHmac("md5", secret).update(body).digest("hex");
  const actual = signature.trim();
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function parseAndVerifyPatreonWebhook(request: Request): Promise<{
  eventType: string;
  payload: PatreonWebhookEnvelope["payload"];
  rawBody: string;
}> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-patreon-signature");
  if (!verifyPatreonWebhookSignature(rawBody, signature)) {
    throw unauthorized("Invalid Patreon webhook signature");
  }

  const eventType = request.headers.get("x-patreon-event") ?? "unknown";
  const payload = JSON.parse(rawBody) as PatreonWebhookEnvelope["payload"];
  return { eventType, payload, rawBody };
}

export function getPatreonUserIdFromPayload(
  payload: PatreonWebhookEnvelope["payload"]
): string | null {
  return (
    payload.data?.attributes?.patron_id ?? payload.data?.relationships?.patron?.data?.id ?? null
  );
}

export function getPrimaryPatreonTierId(payload: PatreonWebhookEnvelope["payload"]): string | null {
  return payload.data?.relationships?.currently_entitled_tiers?.data?.[0]?.id ?? null;
}
