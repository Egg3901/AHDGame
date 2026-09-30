import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader, exportPKCS8, generateKeyPair } from "jose";
import {
  APPLE_DEFAULT_REDIRECT_URI,
  createAppleClientSecret,
  getAppleAuthorizeUrl,
  getAppleSignInConfig,
  openAppleRefreshToken,
  parseAppleUserName,
  sealAppleRefreshToken,
} from "./apple";

const ENV_KEYS = [
  "APPLE_TEAM_ID",
  "APPLE_KEY_ID",
  "APPLE_CLIENT_ID",
  "APPLE_PRIVATE_KEY",
  "APPLE_REDIRECT_URI",
  "AUTH_SECRET",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function testPem(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return exportPKCS8(privateKey);
}

function setContractEnv(pem: string) {
  process.env.APPLE_TEAM_ID = "TEAM123456";
  process.env.APPLE_KEY_ID = "KEY1234567";
  process.env.APPLE_CLIENT_ID = "net.example.signin";
  process.env.APPLE_PRIVATE_KEY = pem;
}

describe("getAppleSignInConfig", () => {
  it("stays dark until all four contract env vars are set", async () => {
    expect(getAppleSignInConfig()).toBeNull();
    setContractEnv(await testPem());
    delete process.env.APPLE_KEY_ID;
    expect(getAppleSignInConfig()).toBeNull();
  });

  it("accepts a raw PEM, an escaped PEM, or a base64 PEM and defaults the return URL", async () => {
    const pem = await testPem();
    setContractEnv(pem);
    expect(getAppleSignInConfig()).toMatchObject({
      clientId: "net.example.signin",
      teamId: "TEAM123456",
      keyId: "KEY1234567",
      privateKey: pem.trim(),
      redirectUri: APPLE_DEFAULT_REDIRECT_URI,
    });
    process.env.APPLE_PRIVATE_KEY = pem.trim().replace(/\n/g, "\\n");
    expect(getAppleSignInConfig()?.privateKey).toBe(pem.trim());
    process.env.APPLE_PRIVATE_KEY = Buffer.from(pem).toString("base64");
    expect(getAppleSignInConfig()?.privateKey).toBe(pem);
    process.env.APPLE_REDIRECT_URI = "https://example.test/api/auth/apple/callback";
    expect(getAppleSignInConfig()?.redirectUri).toBe(
      "https://example.test/api/auth/apple/callback"
    );
  });
});

describe("Apple request building", () => {
  it("asks for name and email by form_post and carries state and nonce", async () => {
    setContractEnv(await testPem());
    const url = new URL(getAppleAuthorizeUrl(getAppleSignInConfig()!, "s1", "n1"));
    expect(url.origin + url.pathname).toBe("https://appleid.apple.com/auth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "net.example.signin",
      redirect_uri: APPLE_DEFAULT_REDIRECT_URI,
      response_type: "code",
      response_mode: "form_post",
      scope: "name email",
      state: "s1",
      nonce: "n1",
    });
  });

  it("signs a short-lived ES256 client secret with the team, key and Services ID", async () => {
    setContractEnv(await testPem());
    const secret = await createAppleClientSecret(getAppleSignInConfig()!, 1_000_000);
    expect(decodeProtectedHeader(secret)).toMatchObject({ alg: "ES256", kid: "KEY1234567" });
    expect(decodeJwt(secret)).toMatchObject({
      iss: "TEAM123456",
      sub: "net.example.signin",
      aud: "https://appleid.apple.com",
      iat: 1_000_000,
      exp: 1_000_300,
    });
  });
});

describe("Apple refresh token sealing", () => {
  it("round-trips and rejects tampering or a changed key", () => {
    process.env.AUTH_SECRET = "test-secret-one";
    const sealed = sealAppleRefreshToken("r.token.value");
    expect(sealed).not.toContain("r.token.value");
    expect(openAppleRefreshToken(sealed)).toBe("r.token.value");

    const parts = sealed.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(openAppleRefreshToken(parts.join("."))).toBeNull();
    expect(openAppleRefreshToken("garbage")).toBeNull();
    expect(openAppleRefreshToken(undefined)).toBeNull();

    process.env.AUTH_SECRET = "test-secret-two";
    expect(openAppleRefreshToken(sealed)).toBeNull();
  });

  it("refuses to seal without AUTH_SECRET", () => {
    expect(() => sealAppleRefreshToken("r")).toThrow();
  });
});

describe("parseAppleUserName", () => {
  it("uses only the name Apple sends on first authorization", () => {
    expect(parseAppleUserName('{"name":{"firstName":"Ada","lastName":"Lovelace"}}')).toBe(
      "Ada Lovelace"
    );
    expect(parseAppleUserName('{"name":{"firstName":"  "}}')).toBeNull();
    expect(parseAppleUserName("not json")).toBeNull();
    expect(parseAppleUserName(null)).toBeNull();
  });
});
