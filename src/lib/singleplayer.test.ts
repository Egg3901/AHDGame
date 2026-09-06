import { describe, expect, it } from "vitest";
import {
  assertSingleplayerAllowed,
  isLocalMongoUri,
  isLoopbackOrigin,
  isSingleplayer,
  singleplayerIsAdmin,
  SingleplayerNotAllowedError,
  SINGLEPLAYER_USER_ID,
  type SingleplayerEnv,
} from "./singleplayer";
import { ObjectId } from "mongodb";

/**
 * Singleplayer replaces authentication with a fixed session. These tests
 * exist for one reason: to prove it cannot switch on anywhere that serves
 * more than one person. Every case below is a way that could happen.
 */

const LOCAL: SingleplayerEnv = {
  SINGLEPLAYER: "1",
  MONGODB_URI: "mongodb://127.0.0.1:27099/ahd-singleplayer",
  NEXT_PUBLIC_BASE_URL: "http://127.0.0.1:3111",
};

describe("singleplayer safety", () => {
  it("is off unless explicitly requested", () => {
    expect(isSingleplayer({})).toBe(false);
    expect(isSingleplayer({ SINGLEPLAYER: "0" })).toBe(false);
    expect(isSingleplayer({ SINGLEPLAYER: "" })).toBe(false);
    expect(isSingleplayer({ SINGLEPLAYER: "no" })).toBe(false);
  });

  it("is on for a local world", () => {
    expect(isSingleplayer(LOCAL)).toBe(true);
    expect(isSingleplayer({ ...LOCAL, SINGLEPLAYER: "true" })).toBe(true);
  });

  it.each([
    ["RAILWAY_ENVIRONMENT_NAME", { RAILWAY_ENVIRONMENT_NAME: "production" }],
    ["RAILWAY_SERVICE_NAME", { RAILWAY_SERVICE_NAME: "main-site" }],
    ["RAILWAY_PROJECT_ID", { RAILWAY_PROJECT_ID: "abc" }],
    ["VERCEL_ENV", { VERCEL_ENV: "production" }],
    ["KUBERNETES_SERVICE_HOST", { KUBERNETES_SERVICE_HOST: "10.0.0.1" }],
  ])("throws rather than enabling when %s is present", (_name, overrides) => {
    const env = { ...LOCAL, ...overrides };
    expect(() => isSingleplayer(env)).toThrow(SingleplayerNotAllowedError);
    expect(() => assertSingleplayerAllowed(env)).toThrow(SingleplayerNotAllowedError);
  });

  it("throws when the app serves a public origin", () => {
    expect(() =>
      isSingleplayer({ ...LOCAL, NEXT_PUBLIC_BASE_URL: "https://www.ahousedividedgame.com" })
    ).toThrow(SingleplayerNotAllowedError);
  });

  it("throws when the database is not on this machine", () => {
    for (const uri of [
      "mongodb+srv://user:pw@cluster0.mongodb.net/ahd",
      "mongodb://user:pw@db.railway.internal:27017/ahd",
      "mongodb://10.0.0.5:27017/ahd",
      "mongodb://127.0.0.1:27017,remote:27017/ahd",
    ]) {
      expect(() => isSingleplayer({ ...LOCAL, MONGODB_URI: uri }), uri).toThrow(
        SingleplayerNotAllowedError
      );
    }
  });

  it("does nothing when singleplayer was never requested, even on a server", () => {
    expect(() =>
      assertSingleplayerAllowed({
        RAILWAY_ENVIRONMENT_NAME: "production",
        MONGODB_URI: "mongodb+srv://user:pw@cluster0.mongodb.net/ahd",
      })
    ).not.toThrow();
  });

  it("keeps admin powers opt-in and singleplayer-only", () => {
    expect(singleplayerIsAdmin(LOCAL)).toBe(false);
    expect(singleplayerIsAdmin({ ...LOCAL, SINGLEPLAYER_ADMIN: "1" })).toBe(true);
    expect(singleplayerIsAdmin({ SINGLEPLAYER_ADMIN: "1" })).toBe(false);
  });
});

describe("host classification", () => {
  it("accepts only loopback origins", () => {
    expect(isLoopbackOrigin("http://127.0.0.1:3111")).toBe(true);
    expect(isLoopbackOrigin("http://localhost:3000")).toBe(true);
    expect(isLoopbackOrigin("https://www.ahousedividedgame.com")).toBe(false);
    // Not a loopback host, despite the substring.
    expect(isLoopbackOrigin("https://localhost.evil.example")).toBe(false);
    expect(isLoopbackOrigin("not a url")).toBe(false);
  });

  it("accepts only local mongo URIs", () => {
    expect(isLocalMongoUri("mongodb://127.0.0.1:27099/ahd")).toBe(true);
    expect(isLocalMongoUri("mongodb://localhost:27017/ahd")).toBe(true);
    expect(isLocalMongoUri("mongodb://user:pw@127.0.0.1:27017/ahd")).toBe(true);
    expect(isLocalMongoUri("mongodb+srv://user:pw@cluster0.mongodb.net/ahd")).toBe(false);
    expect(isLocalMongoUri("mongodb://mongo.railway.internal:27017/ahd")).toBe(false);
    // Every host must be local, not just the first.
    expect(isLocalMongoUri("mongodb://127.0.0.1:27017,10.0.0.5:27017/ahd")).toBe(false);
  });
});

describe("the local player id", () => {
  it("is a usable ObjectId", () => {
    expect(SINGLEPLAYER_USER_ID).toHaveLength(24);
    expect(new ObjectId(SINGLEPLAYER_USER_ID).toString()).toBe(SINGLEPLAYER_USER_ID);
  });
});
