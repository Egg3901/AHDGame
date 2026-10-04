import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/lib/env";
import type { Db } from "mongodb";
import { runResetAndBootstrapCli } from "./resetAndBootstrapCli";

beforeEach(() => vi.stubEnv("MONGODB_DB", "fixture-world"));
afterEach(() => vi.unstubAllEnvs());

const validEnv: Env = {
  MONGODB_URI: "mongodb://127.0.0.1/fixture-world",
  MONGODB_DB: "fixture-world",
  AUTH_SECRET: "reset-cli-test-secret-long-enough",
  ADMIN_REGISTRATION_KEY: "admin-key",
  CRON_SECRET: "cron-key",
};

describe("reset and bootstrap CLI preflight", () => {
  it.each([
    ["AUTH_SECRET", false],
    ["AUTH_SECRET", true],
    ["ADMIN_REGISTRATION_KEY", false],
    ["ADMIN_REGISTRATION_KEY", true],
    ["CRON_SECRET", false],
    ["CRON_SECRET", true],
  ] as const)(
    "fails before connecting or mutating when %s is missing (check-target: %s)",
    async (missing, checkTarget) => {
      const invalidEnv = { ...validEnv, [missing]: "" };
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("MONGODB_URI", invalidEnv.MONGODB_URI);
      vi.stubEnv("MONGODB_DB", invalidEnv.MONGODB_DB!);
      vi.stubEnv("AUTH_SECRET", invalidEnv.AUTH_SECRET);
      vi.stubEnv("ADMIN_REGISTRATION_KEY", invalidEnv.ADMIN_REGISTRATION_KEY);
      vi.stubEnv("CRON_SECRET", invalidEnv.CRON_SECRET);

      const connectDb = vi.fn(async () => ({ databaseName: "fixture-world" }) as unknown as Db);
      const closeDb = vi.fn(async () => {});
      const reset = vi.fn(async () => ({}));
      const args = ["--expect-db=fixture-world", ...(checkTarget ? ["--check-target"] : [])];

      await expect(runResetAndBootstrapCli(args, { connectDb, closeDb, reset })).rejects.toThrow(
        missing
      );

      expect(connectDb).not.toHaveBeenCalled();
      expect(reset).not.toHaveBeenCalled();
      expect(closeDb).not.toHaveBeenCalled();
      expect(process.env.MONGODB_DB).toBe("fixture-world");
    }
  );

  it("uses the validated application URI and checked database for a read-only target check", async () => {
    const connectDb = vi.fn(async () => ({ databaseName: "fixture-world" }) as unknown as Db);
    const closeDb = vi.fn(async () => {});
    const reset = vi.fn(async () => ({}));

    await runResetAndBootstrapCli(["--expect-db=fixture-world", "--check-target"], {
      validateEnvironment: () => validEnv,
      connectDb,
      closeDb,
      reset,
    });

    expect(connectDb).toHaveBeenCalledWith("fixture-world", validEnv.MONGODB_URI);
    expect(reset).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it("rejects an incorrect explicit target before connecting", async () => {
    const connectDb = vi.fn(async () => ({ databaseName: "fixture-world" }) as unknown as Db);

    await expect(
      runResetAndBootstrapCli(["--expect-db=other-world", "--check-target"], {
        validateEnvironment: () => validEnv,
        connectDb,
        closeDb: vi.fn(async () => {}),
        reset: vi.fn(async () => ({})),
      })
    ).rejects.toThrow("mismatch");

    expect(connectDb).not.toHaveBeenCalled();
  });

  it("rejects a connected database mismatch before reset or check-target success", async () => {
    const closeDb = vi.fn(async () => {});
    const reset = vi.fn(async () => ({}));

    await expect(
      runResetAndBootstrapCli(["--expect-db=fixture-world", "--check-target"], {
        validateEnvironment: () => validEnv,
        connectDb: vi.fn(async () => ({ databaseName: "other-world" }) as unknown as Db),
        closeDb,
        reset,
      })
    ).rejects.toThrow("connected database other-world");

    expect(reset).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledTimes(1);
  });
});
