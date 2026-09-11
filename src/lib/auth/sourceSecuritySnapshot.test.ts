import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  SOURCE_SECURITY_SNAPSHOT_VERSION,
  SourceSecuritySnapshotError,
  captureSourceSecuritySnapshot,
  type SourceSecuritySnapshotBinding,
  type SourceSecuritySnapshotUser,
} from "./sourceSecuritySnapshot";

const SOURCE_ACCOUNT_ID = "0123456789abcdef01234567";
const CANONICAL_ACCOUNT_ID = "abcdef12-abcd-4abc-8abc-abcdef123456";
const ENROLLMENT_OPERATION_ID = "12345678-90ab-4cde-b123-456789abcdef";
const ALT_CANONICAL_ACCOUNT_ID = "33333333-3333-4333-a333-333333333333";
const ALT_ENROLLMENT_OPERATION_ID = "44444444-4444-4444-a444-444444444444";
const STORED_CREDENTIAL = "synthetic-stored-credential-for-snapshot-vector";
const REVOKED_ISO = "2026-01-02T03:04:05.006Z";

// Fixed compatibility vector: the canonical encoding byte layout and its digest
// are pinned here so any future encoder change fails loudly on version drift.
const EXPECTED_CANONICAL_ENCODING =
  '{"v":1,"sourceIssuer":"lakeside-test","sourceAccountId":"0123456789abcdef01234567",' +
  '"canonicalAccountId":"abcdef12-abcd-4abc-8abc-abcdef123456",' +
  '"enrollmentOperationId":"12345678-90ab-4cde-b123-456789abcdef",' +
  '"password":{"t":"sha256","v":"fba85919912b4be39f71c2e7d730824ff678c8123a5b797ffd4ce3f052c8503e"},' +
  '"googleId":{"t":"id","v":"google-opaque-ABC-123"},"discordId":{"t":"null"},' +
  '"role":{"t":"role","v":"player"},"isAdmin":{"t":"bool","v":false},' +
  '"isBanned":{"t":"bool","v":false},"authRevokedAt":{"t":"ms","v":1767323045006},' +
  '"accountDeletion":{"t":"absent"},"authMigrationFence":{"t":"absent"}}';
const EXPECTED_SNAPSHOT_DIGEST = "d7640473c28b8663f3c6168e57f01b2353d0bb4b18a5db198ef0f1d84ea2b80f";

function baseUser(): SourceSecuritySnapshotUser {
  return {
    _id: new ObjectId(SOURCE_ACCOUNT_ID),
    password: STORED_CREDENTIAL,
    googleId: "google-opaque-ABC-123",
    discordId: null,
    role: "player",
    isAdmin: false,
    isBanned: false,
    authRevokedAt: new Date(REVOKED_ISO),
  };
}

function baseBinding(): SourceSecuritySnapshotBinding {
  return {
    sourceIssuer: "lakeside-test",
    sourceAccountId: SOURCE_ACCOUNT_ID,
    canonicalAccountId: CANONICAL_ACCOUNT_ID,
    enrollmentOperationId: ENROLLMENT_OPERATION_ID,
  };
}

/** Single documented escape hatch for hostile-shape rows no honest caller builds. */
function rowWith(key: string, value: unknown): SourceSecuritySnapshotUser {
  const row: Record<string, unknown> = { ...(baseUser() as unknown as Record<string, unknown>) };
  row[key] = value;
  return row as unknown as SourceSecuritySnapshotUser;
}

function rowWithout(key: string): SourceSecuritySnapshotUser {
  const row: Record<string, unknown> = { ...(baseUser() as unknown as Record<string, unknown>) };
  delete row[key];
  return row as unknown as SourceSecuritySnapshotUser;
}

function bindingWith(key: string, value: unknown): SourceSecuritySnapshotBinding {
  return { ...baseBinding(), [key]: value } as SourceSecuritySnapshotBinding;
}

function capture(
  user: SourceSecuritySnapshotUser = baseUser(),
  binding: SourceSecuritySnapshotBinding = baseBinding()
) {
  return captureSourceSecuritySnapshot(user, binding);
}

describe("source security snapshot", () => {
  it("pins the versioned canonical encoding and digest for a fixed vector", () => {
    const out = capture();
    expect(SOURCE_SECURITY_SNAPSHOT_VERSION).toBe(1);
    expect(out.version).toBe(1);
    expect(out.canonicalEncoding).toBe(EXPECTED_CANONICAL_ENCODING);
    expect(out.snapshotDigest).toBe(EXPECTED_SNAPSHOT_DIGEST);
    const independent = createHash("sha256")
      .update(EXPECTED_CANONICAL_ENCODING, "utf8")
      .digest("hex");
    expect(independent).toBe(EXPECTED_SNAPSHOT_DIGEST);
    expect(Object.keys(JSON.parse(out.canonicalEncoding))).toEqual([
      "v",
      "sourceIssuer",
      "sourceAccountId",
      "canonicalAccountId",
      "enrollmentOperationId",
      "password",
      "googleId",
      "discordId",
      "role",
      "isAdmin",
      "isBanned",
      "authRevokedAt",
      "accountDeletion",
      "authMigrationFence",
    ]);
  });

  it("is deterministic for the same input", () => {
    expect(capture()).toEqual(capture());
  });

  it("ignores input property order", () => {
    const reorderedUser = {
      authRevokedAt: new Date(REVOKED_ISO),
      isBanned: false,
      isAdmin: false,
      role: "player",
      discordId: null,
      googleId: "google-opaque-ABC-123",
      password: STORED_CREDENTIAL,
      _id: new ObjectId(SOURCE_ACCOUNT_ID),
    } as SourceSecuritySnapshotUser;
    const reorderedBinding = {
      enrollmentOperationId: ENROLLMENT_OPERATION_ID,
      canonicalAccountId: CANONICAL_ACCOUNT_ID,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      sourceIssuer: "lakeside-test",
    };
    expect(capture(reorderedUser, reorderedBinding)).toEqual(capture());
  });

  it.each([
    [
      "password value",
      (u: SourceSecuritySnapshotUser) => ({ ...u, password: `${STORED_CREDENTIAL}x` }),
    ],
    ["googleId value", (u: SourceSecuritySnapshotUser) => ({ ...u, googleId: "other-id" })],
    ["discordId set", (u: SourceSecuritySnapshotUser) => ({ ...u, discordId: "d-1" })],
    ["role value", (u: SourceSecuritySnapshotUser) => ({ ...u, role: "admin" })],
    ["isAdmin flip", (u: SourceSecuritySnapshotUser) => ({ ...u, isAdmin: true })],
    ["isBanned flip", (u: SourceSecuritySnapshotUser) => ({ ...u, isBanned: true })],
    [
      "authRevokedAt instant",
      (u: SourceSecuritySnapshotUser) => ({
        ...u,
        authRevokedAt: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ],
  ])("changes the digest when a critical field changes: %s", (_name, mutate) => {
    const mutated = mutate(baseUser());
    expect(capture(mutated).snapshotDigest).not.toBe(capture().snapshotDigest);
  });

  it.each([
    ["sourceIssuer", bindingWith("sourceIssuer", "other-issuer")],
    ["canonicalAccountId", bindingWith("canonicalAccountId", ALT_CANONICAL_ACCOUNT_ID)],
    ["enrollmentOperationId", bindingWith("enrollmentOperationId", ALT_ENROLLMENT_OPERATION_ID)],
  ])("changes the digest when binding changes: %s", (_name, binding) => {
    expect(capture(baseUser(), binding).snapshotDigest).not.toBe(capture().snapshotDigest);
  });

  it("rejects instead of digesting a mismatched source account id", () => {
    const other = "aaaaaaaaaaaaaaaaaaaaaaaa";
    expect(new ObjectId(other).toHexString()).toBe(other);
    expect(() => capture(baseUser(), bindingWith("sourceAccountId", other))).toThrow(
      SourceSecuritySnapshotError
    );
  });

  it.each([
    ["absent", () => rowWithout("password")],
    ["null", () => rowWith("password", null)],
    ["empty", () => rowWith("password", "")],
    ["digest-a", () => rowWith("password", STORED_CREDENTIAL)],
    ["digest-b", () => rowWith("password", `${STORED_CREDENTIAL}x`)],
  ])("keeps password states distinct: %s", (_name, make) => {
    const digests = new Set<string>();
    for (const build of [
      () => rowWithout("password"),
      () => rowWith("password", null),
      () => rowWith("password", ""),
      () => rowWith("password", STORED_CREDENTIAL),
      () => rowWith("password", `${STORED_CREDENTIAL}x`),
    ]) {
      digests.add(capture(build()).snapshotDigest);
    }
    expect(digests.size).toBe(5);
    expect(make).not.toThrow();
  });

  it("keeps absent, null, empty, and set provider states distinct", () => {
    const digests = new Set(
      [
        rowWithout("googleId"),
        rowWith("googleId", null),
        rowWith("googleId", ""),
        rowWith("googleId", "g-1"),
        rowWith("googleId", "g-2"),
      ].map((row) => capture(row).snapshotDigest)
    );
    expect(digests.size).toBe(5);
  });

  it("keeps absent, null, empty, and role states distinct", () => {
    const digests = new Set(
      [
        rowWithout("role"),
        rowWith("role", null),
        rowWith("role", ""),
        rowWith("role", "player"),
        rowWith("role", "admin"),
        rowWith("role", "moderator"),
      ].map((row) => capture(row).snapshotDigest)
    );
    expect(digests.size).toBe(6);
  });

  it("keeps absent, null, false, and true ban states distinct", () => {
    const digests = new Set(
      [
        rowWithout("isBanned"),
        rowWith("isBanned", null),
        rowWith("isBanned", false),
        rowWith("isBanned", true),
      ].map((row) => capture(row).snapshotDigest)
    );
    expect(digests.size).toBe(4);
  });

  it("keeps absent, null, and instant revocation states distinct", () => {
    const digests = new Set(
      [
        rowWithout("authRevokedAt"),
        rowWith("authRevokedAt", null),
        rowWith("authRevokedAt", new Date(REVOKED_ISO)),
        rowWith("authRevokedAt", new Date("2026-06-01T00:00:00.000Z")),
      ].map((row) => capture(row).snapshotDigest)
    );
    expect(digests.size).toBe(4);
  });

  it("ignores profile and contact changes", () => {
    const withProfile = {
      ...baseUser(),
      email: "changed@example.com",
      username: "changed-name",
      displayName: "Changed Name",
      biography: "A brand new biography.",
    } as unknown as SourceSecuritySnapshotUser;
    expect(capture(withProfile).snapshotDigest).toBe(capture().snapshotDigest);
  });

  it("treats provider ids as case-sensitive opaque values", () => {
    const upper = capture(rowWith("googleId", "ABC")).snapshotDigest;
    const lower = capture(rowWith("googleId", "abc")).snapshotDigest;
    expect(upper).not.toBe(lower);
    expect(capture(rowWith("googleId", "ABC")).canonicalEncoding).toContain('"v":"ABC"');
  });

  it("records ban, role, and admin flags as exact data", () => {
    const out = capture(
      { ...baseUser(), role: "moderator", isAdmin: true, isBanned: true },
      baseBinding()
    );
    expect(out.canonicalEncoding).toContain('"role":{"t":"role","v":"moderator"}');
    expect(out.canonicalEncoding).toContain('"isAdmin":{"t":"bool","v":true}');
    expect(out.canonicalEncoding).toContain('"isBanned":{"t":"bool","v":true}');
  });

  it.each([
    ["present-undefined password", () => rowWith("password", undefined)],
    ["non-string password", () => rowWith("password", 42)],
    ["oversized password", () => rowWith("password", "x".repeat(513))],
    ["control-char password", () => rowWith("password", "ab\x00cd")],
    ["present-undefined googleId", () => rowWith("googleId", undefined)],
    ["non-string googleId", () => rowWith("googleId", 42)],
    ["oversized googleId", () => rowWith("googleId", "x".repeat(513))],
    ["control-char googleId", () => rowWith("googleId", "ab\ncd")],
    ["oversized discordId", () => rowWith("discordId", "x".repeat(513))],
    ["unknown role", () => rowWith("role", "superadmin")],
    ["non-string role", () => rowWith("role", 0)],
    ["uppercase role", () => rowWith("role", "Admin")],
    ["non-boolean isAdmin", () => rowWith("isAdmin", "true")],
    ["numeric isBanned", () => rowWith("isBanned", 1)],
    ["present-undefined isBanned", () => rowWith("isBanned", undefined)],
    ["numeric authRevokedAt", () => rowWith("authRevokedAt", 1767323045006)],
    ["string authRevokedAt", () => rowWith("authRevokedAt", REVOKED_ISO)],
    ["invalid authRevokedAt", () => rowWith("authRevokedAt", new Date("not-a-date"))],
    ["present-undefined authRevokedAt", () => rowWith("authRevokedAt", undefined)],
    ["null fence", () => ({ ...baseUser(), authMigrationFence: null })],
    ["undefined fence", () => ({ ...baseUser(), authMigrationFence: undefined })],
    ["object fence", () => ({ ...baseUser(), authMigrationFence: { operationId: "op" } })],
    ["null deletion", () => ({ ...baseUser(), accountDeletion: null })],
    ["undefined deletion", () => ({ ...baseUser(), accountDeletion: undefined })],
    ["object deletion", () => ({ ...baseUser(), accountDeletion: { requestedAt: "soon" } })],
  ])("rejects hostile or fenced rows: %s", (_name, make) => {
    expect(() => capture(make() as SourceSecuritySnapshotUser)).toThrow(
      SourceSecuritySnapshotError
    );
  });

  it.each([
    ["empty issuer", bindingWith("sourceIssuer", "")],
    ["whitespace issuer", bindingWith("sourceIssuer", "lake side")],
    ["control-char issuer", bindingWith("sourceIssuer", "lake\tside")],
    ["oversized issuer", bindingWith("sourceIssuer", "x".repeat(513))],
    ["non-string issuer", bindingWith("sourceIssuer", 42)],
    ["uppercase sourceAccountId", bindingWith("sourceAccountId", SOURCE_ACCOUNT_ID.toUpperCase())],
    ["short sourceAccountId", bindingWith("sourceAccountId", "abc")],
    [
      "uppercase canonical uuid",
      bindingWith("canonicalAccountId", CANONICAL_ACCOUNT_ID.toUpperCase()),
    ],
    [
      "non-v4 canonical uuid",
      bindingWith("canonicalAccountId", "11111111-1111-1111-8111-111111111111"),
    ],
    ["garbage enrollment uuid", bindingWith("enrollmentOperationId", "not-a-uuid")],
    ["newline canonical uuid", bindingWith("canonicalAccountId", `${CANONICAL_ACCOUNT_ID}\n`)],
    [
      "newline enrollment uuid",
      bindingWith("enrollmentOperationId", `${ENROLLMENT_OPERATION_ID}\n`),
    ],
    [
      "uppercase enrollment uuid",
      bindingWith("enrollmentOperationId", ENROLLMENT_OPERATION_ID.toUpperCase()),
    ],
  ])("rejects hostile binding: %s", (_name, binding) => {
    expect(() => capture(baseUser(), binding)).toThrow(SourceSecuritySnapshotError);
  });

  it("never echoes hostile input in error messages", () => {
    const marker = "H0ST1LE-MARKER";
    const cases: Array<() => unknown> = [
      () => capture(rowWith("role", `${marker}-role`)),
      () => capture(baseUser(), bindingWith("sourceIssuer", `${marker} bad issuer`)),
      () => capture(rowWith("googleId", `ok-prefix-${marker}\n`)),
    ];
    for (const run of cases) {
      let thrown: unknown = null;
      try {
        run();
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SourceSecuritySnapshotError);
      expect((thrown as Error).message).not.toContain(marker);
    }
  });

  it("stores only the hash of a nonempty password digest, never the bytes", () => {
    const out = capture();
    const passwordHash = createHash("sha256").update(STORED_CREDENTIAL, "utf8").digest("hex");
    expect(out.canonicalEncoding).not.toContain(STORED_CREDENTIAL);
    expect(JSON.stringify(out)).not.toContain(STORED_CREDENTIAL);
    expect(out.canonicalEncoding).toContain(`"v":"${passwordHash}"`);
  });

  it("freezes the payload against later input mutation", () => {
    const revokedAt = new Date(REVOKED_ISO);
    const user: SourceSecuritySnapshotUser = { ...baseUser(), authRevokedAt: revokedAt };
    const out = captureSourceSecuritySnapshot(user, baseBinding());
    const before = { ...out };
    (user as unknown as Record<string, unknown>)["password"] = "changed-after-capture";
    revokedAt.setTime(0);
    expect(out).toEqual(before);
    expect(Object.isFrozen(out)).toBe(true);
  });
});
