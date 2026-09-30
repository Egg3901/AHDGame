/** Real browser -> local Next routes -> sandbox journal -> banking turn qualification. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { SignJWT } from "jose";
import { chromium } from "playwright";
import { USER, IE_USER, prepareJourney, journeySnapshot } from "./bankingJourneyFixture";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    sourceName = arg("source"),
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(sourceName && target && out && sourceName !== target);
  assert([sourceName, target].every((name) => /^ahd_sim_[a-zA-Z0-9_-]+$/.test(name)));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (arg("development") !== "true")
    assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    MONGO_DB_NAME: target,
  });
  const client = await MongoClient.connect(uri);
  global._mongoClientPromise = Promise.resolve(client);
  const db = client.db(target);
  assert.equal((await db.listCollections().toArray()).length, 0, "Target must be new");
  const fixture = await prepareJourney(db, client.db(sourceName));
  const port = 39128,
    base = `http://127.0.0.1:${port}`;
  const secret = randomBytes(32).toString("hex");
  const appLog = createWriteStream(`${out}.app.log`);
  // Deliberate allowlist: no inherited integration credentials or production Mongo aliases.
  const app = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
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
        CRON_OWNER: "worker",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_BASE_URL: base,
        ALLOWED_ORIGINS: base,
        SENTRY_DSN: "",
        NEXT_PUBLIC_SENTRY_DSN: "",
      },
    }
  );
  app.stdout?.pipe(appLog);
  app.stderr?.pipe(appLog);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      assert(app.exitCode === null, "Local app exited before readiness");
      try {
        const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2500) });
        ready = r.status < 500;
      } catch {
        /* local server is still compiling */
      }
      if (!ready) await delay(1000);
    }
    assert(ready, "Local app did not become ready");
    console.log("local app ready");
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      extraHTTPHeaders: { "X-Synthetic-Run": "issue1328-banking-journey" },
    });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base || ["data:", "blob:"].includes(url.protocol)) await route.continue();
      else await route.abort();
    });
    const tokenFor = async (irish = false) =>
      new SignJWT({
        userId: (irish ? IE_USER : USER).toHexString(),
        username: irish ? "Synthetic Irish chair" : "Synthetic banking player",
        email: irish ? "irish-chair@example.invalid" : "banking-player@example.invalid",
        role: "player",
        isAdmin: false,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("2h")
        .sign(new TextEncoder().encode(secret));
    await context.addCookies([
      {
        name: "auth-token-local",
        value: await tokenFor(),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const page = await context.newPage();
    const errors: string[] = [],
      requests: { path: string; status: number }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (new URL(response.url()).origin === base && response.request().method() !== "GET")
        requests.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(`${base}/banking`, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page
      .getByText("Journey Savings Bank", { exact: true })
      .first()
      .waitFor({ timeout: 180_000 });
    await page.screenshot({ path: `${out}.png`, fullPage: true });
    const baseline = await journeySnapshot(db);
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          retainedHash: fixture.retainedHash,
          stage: "banking page",
          baseline,
          requests,
          errors,
          body: await page.locator("body").innerText(),
        },
        null,
        2
      )
    );
    console.log("banking page rendered");
  } finally {
    await browser?.close();
    if (app.pid) {
      try {
        process.kill(-app.pid, "SIGTERM");
      } catch {
        /* already stopped */
      }
      await Promise.race([
        new Promise<void>((done) => app.once("exit", () => done())),
        delay(5000),
      ]);
      try {
        process.kill(-app.pid, "SIGKILL");
      } catch {
        /* process group already stopped */
      }
    }
    appLog.end();
    await client.close();
  }
}
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
