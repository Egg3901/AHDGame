import { suppressTracing } from "@sentry/nextjs";
import { createPrivateKey, sign } from "node:crypto";
import { connect, constants } from "node:http2";
import type { DeliveryResult, PushDevice, PushProvider } from "./types";
import { PUSH_PREVIEW } from "./policy";

export function providerConfigured(provider: PushProvider): boolean {
  if (process.env.NATIVE_PUSH_ENABLED !== "true") return false;
  return provider === "fcm"
    ? !!(process.env.FCM_PROJECT_ID && process.env.FCM_CLIENT_EMAIL && process.env.FCM_PRIVATE_KEY)
    : !!(process.env.APNS_TEAM_ID && process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
}
function jwt(header: object, payload: object, pem: string, algorithm: "RSA-SHA256" | "SHA256") {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;
  const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
  const signature = sign(algorithm, Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${signature.toString("base64url")}`;
}
let googleToken: { value: string; expiresAt: number; identity: string } | undefined;
let googlePending: Promise<string> | undefined;
async function fcmAccessToken(): Promise<string> {
  const identity = `${process.env.FCM_CLIENT_EMAIL}:${process.env.FCM_PRIVATE_KEY}`;
  if (googleToken?.identity === identity && googleToken.expiresAt > Date.now())
    return googleToken.value;
  if (googlePending) return googlePending;
  googlePending = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt(
      { alg: "RS256", typ: "JWT" },
      {
        iss: process.env.FCM_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      },
      process.env.FCM_PRIVATE_KEY!,
      "RSA-SHA256"
    );
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new Error("Push provider authentication failed");
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("access_token" in body) ||
      typeof body.access_token !== "string"
    ) {
      throw new Error("Push provider authentication failed");
    }
    googleToken = { value: body.access_token, expiresAt: Date.now() + 50 * 60_000, identity };
    return body.access_token;
  })();
  try {
    return await googlePending;
  } finally {
    googlePending = undefined;
  }
}
async function sendFcm(device: PushDevice): Promise<DeliveryResult> {
  const accessToken = await fcmAccessToken();
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(process.env.FCM_PROJECT_ID!)}/messages:send`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: device.token,
          data: PUSH_PREVIEW,
          android: {
            priority: "high",
            ttl: "300s",
            collapse_key: "ahd-inbox",
            restricted_package_name: "net.lakesidegames.ahdclient",
          },
        },
      }),
    }
  );
  if (response.ok) return "sent";
  if (response.status === 401) googleToken = undefined;
  const body: unknown = await response.json().catch(() => null);
  // Only an explicit unregistered-token error deletes a device. Bad provider
  // credentials, mismatched projects and malformed payloads remain retryable.
  const unregistered =
    body &&
    typeof body === "object" &&
    "error" in body &&
    body.error &&
    typeof body.error === "object" &&
    "details" in body.error &&
    Array.isArray(body.error.details) &&
    body.error.details.some(
      (detail: unknown) =>
        !!detail &&
        typeof detail === "object" &&
        "errorCode" in detail &&
        detail.errorCode === "UNREGISTERED"
    );
  return unregistered ? "invalid" : "retry";
}
let appleToken: { value: string; expiresAt: number; identity: string } | undefined;
function apnsAccessToken(): string {
  const identity = `${process.env.APNS_TEAM_ID}:${process.env.APNS_KEY_ID}:${process.env.APNS_PRIVATE_KEY}`;
  if (appleToken?.identity === identity && appleToken.expiresAt > Date.now())
    return appleToken.value;
  const value = jwt(
    { alg: "ES256", kid: process.env.APNS_KEY_ID },
    {
      iss: process.env.APNS_TEAM_ID,
      iat: Math.floor(Date.now() / 1000),
    },
    process.env.APNS_PRIVATE_KEY!,
    "SHA256"
  );
  appleToken = { value, expiresAt: Date.now() + 45 * 60_000, identity };
  return value;
}
async function sendApns(device: PushDevice): Promise<DeliveryResult> {
  const authorization = `bearer ${apnsAccessToken()}`;
  const origin =
    device.environment === "development"
      ? "https://api.sandbox.push.apple.com"
      : "https://api.push.apple.com";
  return new Promise((resolve) => {
    const client = connect(origin);
    let finished = false;
    const finish = (result: DeliveryResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish("retry"), 8000);
    client.on("error", () => finish("retry"));
    const request = client.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${device.token}`,
      authorization,
      "apns-topic": "net.lakesidegames.ahdclient",
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": "ahd-inbox",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 300),
    });
    request.on("error", () => finish("retry"));
    request.on("response", (headers) => {
      const status = Number(headers[constants.HTTP2_HEADER_STATUS]);
      // 400 can mean an environment/configuration error. Keep those devices.
      finish(status === 200 ? "sent" : status === 410 ? "invalid" : "retry");
    });
    request.end(
      JSON.stringify({
        aps: {
          alert: { title: PUSH_PREVIEW.title, body: PUSH_PREVIEW.body },
          sound: "default",
          "thread-id": "ahd-inbox",
        },
        path: PUSH_PREVIEW.path,
      })
    );
  });
}
export async function sendNativePush(device: PushDevice): Promise<DeliveryResult> {
  if (!providerConfigured(device.provider)) return "retry";
  try {
    return await suppressTracing(() =>
      device.provider === "fcm" ? sendFcm(device) : sendApns(device)
    );
  } catch {
    return "retry";
  }
}
