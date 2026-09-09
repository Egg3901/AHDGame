import { suppressTracing } from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { assertSameOrigin } from "@/lib/api/assertSameOrigin";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";
import { parseJsonBody } from "@/lib/api/validate";
import { withNoStore } from "@/lib/api/withNoStore";
import { providerConfigured } from "@/lib/nativePush/providers";
import { registerDevice, revokeDevice } from "@/lib/nativePush/devices";

const installation = z.string().regex(/^[a-f0-9]{64}$/);
const registration = z
  .object({
    installation,
    provider: z.enum(["fcm", "apns"]),
    token: z
      .string()
      .min(32)
      .max(4096)
      .regex(/^[A-Za-z0-9_:\-]+$/),
    environment: z.enum(["development", "production"]).default("production"),
  })
  .strict()
  .refine((value) => value.provider !== "apns" || /^[a-f0-9]{64,200}$/.test(value.token));

// Authenticated registration; credentials and provider errors never enter telemetry.
export const POST = withNoStore(async (request: Request) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;
  const limit = checkRateLimit(`native-push:${auth.user.userId}`, 30, 60_000);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);
  const parsed = await parseJsonBody(request, registration, { maxBytes: 8192 });
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid device registration" }, { status: 400 });
  if (!providerConfigured(parsed.data.provider))
    return NextResponse.json({ error: "Push is not configured yet" }, { status: 503 });
  try {
    const registered = await suppressTracing(async () =>
      registerDevice(await getDb(), new ObjectId(auth.user.userId), parsed.data)
    );
    return NextResponse.json({ registered }, { status: registered ? 200 : 409 });
  } catch {
    return NextResponse.json({ error: "Could not register this device" }, { status: 503 });
  }
});

// Possession of the installation secret authorizes revocation after sign-out.
// It cannot read registrations or subscribe to another account.
export const DELETE = withNoStore(async (request: Request) => {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const parsed = await parseJsonBody(request, z.object({ installation }).strict(), {
    maxBytes: 1024,
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid installation" }, { status: 400 });
  try {
    await suppressTracing(async () => revokeDevice(await getDb(), parsed.data.installation));
    return NextResponse.json({ registered: false });
  } catch {
    return NextResponse.json({ error: "Could not revoke this device" }, { status: 503 });
  }
});
