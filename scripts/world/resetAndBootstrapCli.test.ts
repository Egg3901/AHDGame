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

  it.each([
    [[], true],
    [["--no-pre-iteration"], false],
  ] as const)(
    "preserves partyless 1991 founding defaults and explicit opt-out (%s)",
    async (foundingArgs, foundingExpected) => {
      const reset = vi.fn(async () => ({}));
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        await runResetAndBootstrapCli(
          [
            "--expect-db=fixture-world",
            "--preset=1991-default",
            "--no-starting-parties",
            ...foundingArgs,
          ],
          {
            validateEnvironment: () => validEnv,
            connectDb: vi.fn(async () => ({ databaseName: "fixture-world" }) as unknown as Db),
            closeDb: vi.fn(async () => {}),
            reset,
          }
        );
        expect(reset).toHaveBeenCalledWith(
          expect.objectContaining({
            preset: "1991-default",
            startingParties: "none",
            preIteration: foundingExpected ? undefined : false,
          })
        );
        const resetAnnouncement = log.mock.calls.find(([message]) =>
          String(message).startsWith("Resetting and bootstrapping")
        );
        expect(String(resetAnnouncement?.[0]).includes("pre-iteration founding")).toBe(
          foundingExpected
        );
      } finally {
        log.mockRestore();
      }
    }
  );

  it("rejects --preserve-reference for a 1991 reset before connecting", async () => {
    const connectDb = vi.fn(async () => ({ databaseName: "fixture-world" }) as unknown as Db);
    const reset = vi.fn(async () => ({}));

    await expect(
      runResetAndBootstrapCli(
        ["--expect-db=fixture-world", "--preset=1991-default", "--preserve-reference"],
        { validateEnvironment: () => validEnv, connectDb, closeDb: vi.fn(async () => {}), reset }
      )
    ).rejects.toThrow("--preserve-reference is not supported for 1991-default");

    expect(connectDb).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
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
