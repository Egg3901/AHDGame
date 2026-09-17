import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import {
  SourcePasswordOwnershipError,
  verifySourcePasswordOwnership,
  type SourcePasswordOwnershipUser,
} from "./sourcePasswordOwnership";

const SOURCE_ACCOUNT_ID = "0123456789abcdef01234567";
const PASSWORD = "correct-horse-test-pw";
const WRONG_PASSWORD = "wrong-horse-test-pw";
const PASSWORD_71 = `\u00e9${"a".repeat(69)}`;
const PASSWORD_72 = `\u00e9${"a".repeat(70)}`;

// Generated synthetic credentials exercise actual bcrypt without storing hashes.
const HASH_2B = bcrypt.hashSync(PASSWORD, 12);
const HASH_2A = `$2a$12$${HASH_2B.slice(7)}`;
const HASH_2Y = `$2y$12$${HASH_2B.slice(7)}`;
const HASH_71 = bcrypt.hashSync(PASSWORD_71, 12);
const HASH_COST_10 = HASH_2B.replace("$12$", "$10$");

const originalCompare = bcrypt.compare.bind(bcrypt);

afterEach(() => {
  vi.restoreAllMocks();
});

function baseUser(): SourcePasswordOwnershipUser {
  return {
    _id: new ObjectId(SOURCE_ACCOUNT_ID),
    password: HASH_2B,
    role: "player",
    isAdmin: false,
    isBanned: false,
  };
}

function rowWith(key: string, value: unknown): SourcePasswordOwnershipUser {
  const row: Record<string, unknown> = { ...(baseUser() as unknown as Record<string, unknown>) };
  row[key] = value;
  return row as unknown as SourcePasswordOwnershipUser;
}

function rowWithout(key: string): SourcePasswordOwnershipUser {
  const row: Record<string, unknown> = { ...(baseUser() as unknown as Record<string, unknown>) };
  delete row[key];
  return row as unknown as SourcePasswordOwnershipUser;
}

function mutableUser(
  overrides: Partial<SourcePasswordOwnershipUser> = {}
): SourcePasswordOwnershipUser {
  return { ...baseUser(), ...overrides };
}

function expectRejected(run: () => Promise<unknown>, marker?: string): Promise<void> {
  return run().then(
    () => {
      throw new Error("expected rejection");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(SourcePasswordOwnershipError);
      const message = (error as Error).message;
      expect(message).not.toContain(PASSWORD);
      expect(message).not.toContain(HASH_2B);
      expect(message).not.toContain(HASH_71);
      if (marker) expect(message).not.toContain(marker);
    }
  );
}

describe("source password ownership", { timeout: 30000 }, () => {
  it("accepts the matching cost-12 password on an ordinary password-only account", async () => {
    await expect(verifySourcePasswordOwnership(baseUser(), PASSWORD)).resolves.toBe(true);
  });

  it("rejects a wrong password without throwing", async () => {
    await expect(verifySourcePasswordOwnership(baseUser(), WRONG_PASSWORD)).resolves.toBe(false);
  });

  it("does not trim the supplied password", async () => {
    await expect(verifySourcePasswordOwnership(baseUser(), ` ${PASSWORD}`)).resolves.toBe(false);
  });

  it("accepts a 71-byte UTF-8 password that includes a multibyte character", async () => {
    expect(new TextEncoder().encode(PASSWORD_71).byteLength).toBe(71);
    await expect(
      verifySourcePasswordOwnership(rowWith("password", HASH_71), PASSWORD_71)
    ).resolves.toBe(true);
  });

  it("rejects a 72-byte UTF-8 password before compare", async () => {
    expect(new TextEncoder().encode(PASSWORD_72).byteLength).toBe(72);
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() => verifySourcePasswordOwnership(baseUser(), PASSWORD_72));
    expect(compare).not.toHaveBeenCalled();
  });

  it.each([
    ["$2a$12$", HASH_2A],
    ["$2y$12$", HASH_2Y],
  ])("accepts the %s prefix when bcryptjs compares it", async (_name, hash) => {
    await expect(verifySourcePasswordOwnership(rowWith("password", hash), PASSWORD)).resolves.toBe(
      true
    );
  });

  it("allows absent admin, ban, social, and revocation fields", async () => {
    const row: SourcePasswordOwnershipUser = {
      _id: new ObjectId(SOURCE_ACCOUNT_ID),
      password: HASH_2B,
      role: "player",
    };
    await expect(verifySourcePasswordOwnership(row, PASSWORD)).resolves.toBe(true);
  });

  it("allows explicit empty or null social methods and a null revocation instant", async () => {
    const user: SourcePasswordOwnershipUser = {
      ...baseUser(),
      googleId: "",
      discordId: null,
      authRevokedAt: null,
    };
    await expect(verifySourcePasswordOwnership(user, PASSWORD)).resolves.toBe(true);
  });

  it("allows only an exact configured privileged cohort account", async () => {
    const user: SourcePasswordOwnershipUser = {
      ...baseUser(),
      role: "admin",
      isAdmin: true,
      discordId: "synthetic-discord-subject",
    };
    await expect(
      verifySourcePasswordOwnership(user, PASSWORD, {
        privilegedCohortSourceAccountIds: [SOURCE_ACCOUNT_ID],
      })
    ).resolves.toBe(true);
    await expectRejected(() =>
      verifySourcePasswordOwnership(user, PASSWORD, {
        privilegedCohortSourceAccountIds: ["fedcba987654321001234567"],
      })
    );
  });

  it("fails closed on malformed privileged cohort policy", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() =>
      verifySourcePasswordOwnership(baseUser(), PASSWORD, {
        privilegedCohortSourceAccountIds: ["not-an-object-id"],
      })
    );
    await expectRejected(() =>
      verifySourcePasswordOwnership(baseUser(), PASSWORD, {
        privilegedCohortSourceAccountIds: [SOURCE_ACCOUNT_ID, SOURCE_ACCOUNT_ID],
      })
    );
    expect(compare).not.toHaveBeenCalled();
  });

  it.each([
    ["unpaired leading surrogate", "\uD800x"],
    ["unpaired trailing surrogate", "x\uDC00"],
    ["NUL", "ab\u0000cd"],
    ["empty", ""],
  ])("rejects a malformed supplied password: %s", async (_name, password) => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() => verifySourcePasswordOwnership(baseUser(), password));
    expect(compare).not.toHaveBeenCalled();
  });

  it("rejects a non-string supplied password", async () => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() => verifySourcePasswordOwnership(baseUser(), 42 as unknown as string));
    expect(compare).not.toHaveBeenCalled();
  });

  it.each([
    ["absent hash", () => rowWithout("password")],
    ["null hash", () => rowWith("password", null)],
    ["empty hash", () => rowWith("password", "")],
    ["cost 10", () => rowWith("password", HASH_COST_10)],
    ["cost 11", () => rowWith("password", HASH_2B.replace("$12$", "$11$"))],
    ["cost 13", () => rowWith("password", HASH_2B.replace("$12$", "$13$"))],
    ["invalid alphabet", () => rowWith("password", `$2b$12${"$".repeat(1)}${"+".repeat(53)}`)],
    ["short hash", () => rowWith("password", HASH_2B.slice(0, 59))],
    ["long hash", () => rowWith("password", `${HASH_2B}x`)],
    ["unknown scheme", () => rowWith("password", `$2x$12$${HASH_2B.slice(7)}`)],
  ])("rejects a malformed stored hash: %s", async (_name, make) => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() => verifySourcePasswordOwnership(make(), PASSWORD));
    expect(compare).not.toHaveBeenCalled();
  });

  it.each([
    ["banned true", () => rowWith("isBanned", true)],
    ["banned numeric", () => rowWith("isBanned", 1)],
    ["banned null", () => rowWith("isBanned", null)],
    ["admin true", () => rowWith("isAdmin", true)],
    ["admin string", () => rowWith("isAdmin", "true")],
    ["role admin", () => rowWith("role", "admin")],
    ["role moderator", () => rowWith("role", "moderator")],
    ["role unknown", () => rowWith("role", "superadmin")],
    ["role empty", () => rowWith("role", "")],
    ["role null", () => rowWith("role", null)],
    ["role absent", () => rowWithout("role")],
    ["role malformed", () => rowWith("role", 0)],
    ["google nonempty", () => rowWith("googleId", "g-1")],
    ["discord nonempty", () => rowWith("discordId", "d-1")],
    ["google malformed", () => rowWith("googleId", 42)],
    ["discord malformed", () => rowWith("discordId", { id: "d" })],
    ["null fence", () => ({ ...baseUser(), authMigrationFence: null })],
    ["undefined fence", () => ({ ...baseUser(), authMigrationFence: undefined })],
    ["object fence", () => ({ ...baseUser(), authMigrationFence: { operationId: "op" } })],
    ["null deletion", () => ({ ...baseUser(), accountDeletion: null })],
    ["undefined deletion", () => ({ ...baseUser(), accountDeletion: undefined })],
    ["object deletion", () => ({ ...baseUser(), accountDeletion: { requestedAt: "soon" } })],
    ["numeric revokedAt", () => rowWith("authRevokedAt", 1767323045006)],
    ["string revokedAt", () => rowWith("authRevokedAt", "2026-01-02T03:04:05.006Z")],
    ["invalid revokedAt", () => rowWith("authRevokedAt", new Date("not-a-date"))],
    ["undefined revokedAt", () => rowWith("authRevokedAt", undefined)],
  ])("rejects an ineligible account: %s", async (_name, make) => {
    const compare = vi.spyOn(bcrypt, "compare");
    await expectRejected(() =>
      verifySourcePasswordOwnership(make() as SourcePasswordOwnershipUser, PASSWORD)
    );
    expect(compare).not.toHaveBeenCalled();
  });

  it("never echoes hostile input in error messages", async () => {
    const marker = "H0ST1LE-MARKER";
    await expectRejected(
      () => verifySourcePasswordOwnership(rowWith("role", `${marker}-admin`), PASSWORD),
      marker
    );
    await expectRejected(
      () => verifySourcePasswordOwnership(rowWith("password", `${marker}$2b$12$aaaa`), PASSWORD),
      marker
    );
    await expectRejected(
      () => verifySourcePasswordOwnership(baseUser(), `${marker}\u0000password`),
      marker
    );
  });

  it("treats compare errors as unsuccessful without leaking input", async () => {
    vi.spyOn(bcrypt, "compare").mockRejectedValue(new Error(`boom ${HASH_2B} ${PASSWORD}`));
    await expect(verifySourcePasswordOwnership(baseUser(), PASSWORD)).resolves.toBe(false);
  });

  it("does not treat a record mutated during compare as verified", async () => {
    const user = mutableUser();
    vi.spyOn(bcrypt, "compare").mockImplementation(async (pw, hash) => {
      (user as { role: string }).role = "admin";
      return originalCompare(pw, hash);
    });
    await expectRejected(() => verifySourcePasswordOwnership(user, PASSWORD));
  });

  it("does not treat a stored hash swapped during compare as verified", async () => {
    const user = mutableUser();
    vi.spyOn(bcrypt, "compare").mockImplementation(async (pw, hash) => {
      (user as { password: string }).password = HASH_71;
      return originalCompare(pw, hash);
    });
    await expectRejected(() => verifySourcePasswordOwnership(user, PASSWORD));
  });

  it("does not treat an in-place revocation date mutation during compare as verified", async () => {
    const revokedAt = new Date("2026-01-02T03:04:05.006Z");
    const user = mutableUser({ authRevokedAt: revokedAt });
    vi.spyOn(bcrypt, "compare").mockImplementation(async (pw, hash) => {
      revokedAt.setTime(0);
      return originalCompare(pw, hash);
    });
    await expectRejected(() => verifySourcePasswordOwnership(user, PASSWORD));
  });

  it("ignores profile field mutation during compare", async () => {
    const user = {
      ...baseUser(),
      email: "before@example.com",
    } as SourcePasswordOwnershipUser & { email: string };
    vi.spyOn(bcrypt, "compare").mockImplementation(async (pw, hash) => {
      user.email = "after@example.com";
      return originalCompare(pw, hash);
    });
    await expect(verifySourcePasswordOwnership(user, PASSWORD)).resolves.toBe(true);
  });
});
