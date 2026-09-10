import { generateKeyPairSync } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { providerConfigured, sendNativePush } from "./providers";
import type { PushDevice } from "./types";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const device: PushDevice = {
  _id: "hash",
  userId: new ObjectId(),
  token: "private-device-token",
  tokenHash: "hash",
  provider: "fcm",
  environment: "production",
  revision: "v1",
  cursorAt: new Date(),
  cursorId: new ObjectId(),
  expiresAt: new Date(),
  nextAttemptAt: new Date(),
  leaseUntil: new Date(),
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("NATIVE_PUSH_ENABLED", "true");
  vi.stubEnv("FCM_PROJECT_ID", "example-project");
  vi.stubEnv("FCM_CLIENT_EMAIL", `${Math.random()}@example-project.iam.gserviceaccount.com`);
  vi.stubEnv("FCM_PRIVATE_KEY", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "oauth-access-token" }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("FCM provider delivery", () => {
  it("authenticates and sends only the fixed preview with a short delivery lifetime", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ name: "accepted" }));
    expect(await sendNativePush(device)).toBe("sent");
    const [url, request] = fetchMock.mock.calls[1];
    expect(url).toBe("https://fcm.googleapis.com/v1/projects/example-project/messages:send");
    const payload = JSON.parse(String(request?.body));
    expect(payload.message.android.ttl).toBe("300s");
    expect(payload.message.data.path).toBe("/notifications");
    expect(payload.message).not.toHaveProperty("notification");
    expect(payload.message).not.toHaveProperty("userId");
    expect(request?.redirect).toBe("error");
  });
  it("invalidates only an explicitly unregistered token", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: { details: [{ errorCode: "UNREGISTERED" }] } }, { status: 404 })
    );
    expect(await sendNativePush(device)).toBe("invalid");
  });
  it("keeps devices on provider outages and authentication errors", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "outage" }, { status: 503 }));
    expect(await sendNativePush(device)).toBe("retry");
  });
  it("does no network work until explicitly enabled and configured", async () => {
    vi.stubEnv("NATIVE_PUSH_ENABLED", "false");
    expect(providerConfigured("fcm")).toBe(false);
    expect(await sendNativePush(device)).toBe("retry");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
