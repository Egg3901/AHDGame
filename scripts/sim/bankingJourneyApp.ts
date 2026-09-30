/** Reuse one explicitly owned loopback app while qualifying serial browser journeys. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";

interface Session {
  pid: number;
  secret: string;
  target: string;
  workdir: string;
  sourceCommit: string;
}
export function bankingJourneyApp(
  uri: string,
  target: string,
  out: string,
  sourceCommit: string,
  sessionPath?: string
) {
  const base = "http://127.0.0.1:39128";
  let session: Session;
  if (sessionPath && existsSync(sessionPath)) {
    session = JSON.parse(readFileSync(sessionPath, "utf8")) as Session;
    assert.equal(session.target, target);
    assert.equal(session.workdir, process.cwd());
    process.kill(session.pid, 0);
    assert.equal(readlinkSync(`/proc/${session.pid}/cwd`), process.cwd());
    const command = readFileSync(`/proc/${session.pid}/cmdline`, "utf8");
    assert(
      command.includes("next/dist/bin/next") && command.includes("39128"),
      "Stored app process is not the owned local server"
    );
    const changed = execFileSync(
      "git",
      ["diff", "--name-only", session.sourceCommit, sourceCommit],
      { encoding: "utf8" }
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    assert(
      changed.every(
        (path) =>
          path.startsWith("scripts/sim/") ||
          path.includes(".test.") ||
          path.startsWith("content/changelog/")
      ),
      "Cannot reuse app across gameplay source changes"
    );
    console.log("reusing owned loopback app");
  } else {
    const secret = randomBytes(32).toString("hex");
    const log = openSync(`${out}.app.log`, "a", 0o600);
    const app = spawn(
      process.execPath,
      [
        resolve("node_modules/next/dist/bin/next"),
        "dev",
        "--webpack",
        "--hostname",
        "127.0.0.1",
        "--port",
        "39128",
      ],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", log, log],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_ENV: "development",
          MONGODB_URI: uri,
          MONGODB_DB: target,
          MONGO_DB_NAME: target,
          AUTH_SECRET: secret,
          ADMIN_REGISTRATION_KEY: "synthetic-local-only",
          CRON_SECRET: "synthetic-local-only",
          DISABLE_DEV_BACKGROUND: "1",
          AHD_BROWSER_JOURNEY: "1",
          CRON_OWNER: "worker",
          NEXT_TELEMETRY_DISABLED: "1",
          NEXT_PUBLIC_BASE_URL: base,
          ALLOWED_ORIGINS: base,
          SENTRY_DSN: "",
          NEXT_PUBLIC_SENTRY_DSN: "",
        },
      }
    );
    closeSync(log);
    assert(app.pid);
    session = { pid: app.pid, secret, target, workdir: process.cwd(), sourceCommit };
    app.unref();
    if (sessionPath) writeFileSync(sessionPath, JSON.stringify(session), { mode: 0o600 });
  }
  return {
    base,
    secret: session.secret,
    assertAlive() {
      process.kill(session.pid, 0);
    },
    finish(success: boolean) {
      if (!success && sessionPath) {
        console.log("Preserved owned warm app for the next bounded retry");
        return;
      }
      try {
        process.kill(-session.pid, "SIGTERM");
      } catch {
        /* already stopped */
      }
      if (sessionPath && existsSync(sessionPath)) unlinkSync(sessionPath);
    },
  };
}
