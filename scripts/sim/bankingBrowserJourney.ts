/** Real browser -> local Next routes -> sandbox journal -> banking turn qualification. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { SignJWT } from "jose";
import { chromium, type Page } from "playwright";
import { runBankingActions } from "./bankingJourneyActions";
import { runGovernanceJourney } from "./bankingJourneyGovernance";
import { runRecoveryJourney } from "./bankingJourneyRecovery";
import { runCharterJourney } from "./bankingJourneyCharter";
import { loadRetainedContext } from "./bankingParameterSetup";
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
  const resumeDepositEvidence = arg("resume-deposit-evidence");
  const resumedDepositBaseline = resumeDepositEvidence
    ? (
        JSON.parse(readFileSync(resumeDepositEvidence, "utf8")) as {
          stage: string;
          state: Awaited<ReturnType<typeof journeySnapshot>>;
        }[]
      ).find((row) => row.stage === "baseline")?.state
    : undefined;
  if (resumeDepositEvidence) assert(resumedDepositBaseline, "Missing initial deposit baseline");
  const probeHub = arg("probe-hub") === "true";
  const resumeUntouchedFixture = arg("resume-untouched-fixture") === "true";
  let fixture;
  if (probeHub || resumedDepositBaseline) {
    assert.equal(
      (await db.collection("users").findOne({ _id: USER }))?.email,
      "banking-player@example.invalid"
    );
    const retained = await loadRetainedContext(client.db(sourceName));
    fixture = {
      setup: { turn: (resumedDepositBaseline?.turn as number) ?? 0 },
      retainedHash: retained.hash,
    };
    if (resumedDepositBaseline) {
      const existing = await journeySnapshot(db);
      assert.equal(existing.turn, resumedDepositBaseline.turn);
      assert.equal(existing.loans.length, 0);
      assert.equal(existing.bank.status, "active");
      assert.equal(existing.savings.length, 1);
      assert.equal(existing.savings[0].balance, 1_000_000);
      assert.equal(existing.bank.liability, 1_000_000);
      assert.equal(existing.saverWallet, resumedDepositBaseline.saverWallet - 1_000_000);
    }
  } else if (resumeUntouchedFixture) {
    // Reuse a previously prepared but never exercised local browser fixture.
    assert.equal(
      (await db.collection("users").findOne({ _id: USER }))?.email,
      "banking-player@example.invalid"
    );
    const existing = await journeySnapshot(db);
    assert.equal(
      existing.savings.reduce((sum, account) => sum + account.balance, 0),
      0
    );
    assert.equal(existing.loans.length, 0);
    assert.equal(existing.bank.liability, 0);
    assert.equal(existing.bank.status, "active");
    assert(
      existing.journals.every((move) =>
        ["banking_parameter_fixture_transfer", "bank_capital_injection"].includes(move.kind)
      ),
      "Existing fixture must have no gameplay commands"
    );
    const retained = await loadRetainedContext(client.db(sourceName));
    fixture = { setup: { turn: existing.turn as number }, retainedHash: retained.hash };
  } else {
    assert.equal((await db.listCollections().toArray()).length, 0, "Target must be new");
    fixture = await prepareJourney(db, client.db(sourceName));
  }
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
  let page: Page | undefined;
  process.env.JOURNEY_SCREENSHOT_PREFIX = out;
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
    const excludedAuxiliaryPaths = [
      "/api/players/online",
      "/api/poll-banner",
      "/api/global-alerts/active",
      "/api/flags/country/",
    ];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (
        url.origin === base &&
        excludedAuxiliaryPaths.some((path) => url.pathname.startsWith(path))
      )
        await route.abort();
      else if (url.origin === base || ["data:", "blob:"].includes(url.protocol))
        await route.continue();
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
    // The real session bundle is a readiness read, so cold compilation cannot trigger the UI's short network timeout.
    const authenticated = await context.request.get(`${base}/api/client-nav`, { timeout: 300_000 });
    assert(authenticated.ok(), "Synthetic session bundle failed");
    if (probeHub) {
      const measurements = [];
      for (let index = 0; index < 3; index++) {
        const started = performance.now();
        const response = await context.request.get(`${base}/api/banking/hub`, { timeout: 300_000 });
        const body = await response.json();
        measurements.push({
          index,
          elapsedMs: performance.now() - started,
          status: response.status(),
          currentTurn: body.currentTurn,
          savings: body.savings,
        });
        console.log("authenticated hub probe", JSON.stringify(measurements.at(-1)));
        assert(response.ok(), "Hub probe failed");
      }
      writeFileSync(
        out,
        JSON.stringify({ sourceCommit, measurements, state: await journeySnapshot(db) }, null, 2)
      );
      return;
    }
    page = await context.newPage();
    const errors: string[] = [],
      requests: { path: string; status: number }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (new URL(response.url()).origin === base && response.request().method() !== "GET")
        requests.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    await page.goto(`${base}/banking`, { waitUntil: "domcontentloaded", timeout: 300_000 });
    await page
      .getByText("Journey Savings Bank", { exact: true })
      .first()
      .waitFor({ timeout: 300_000 });
    const rejectCookies = page.getByRole("button", { name: "Reject", exact: true });
    if (await rejectCookies.isVisible()) await rejectCookies.click();
    await page
      .screenshot({ path: `${out}.png`, fullPage: true, timeout: 5000 })
      .catch(() => console.log("Optional banking screenshot unavailable"));
    const baseline = await journeySnapshot(db);
    const actions = await runBankingActions(
      page,
      db,
      base,
      fixture.setup.turn,
      resumedDepositBaseline
    );
    const recovery = await runRecoveryJourney(page, db, base, arg("development") === "true");
    const governance = await runGovernanceJourney(page, db, base, async () => {
      await context.addCookies([
        {
          name: "auth-token-local",
          value: await tokenFor(true),
          url: base,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    });
    await context.addCookies([
      {
        name: "auth-token-local",
        value: await tokenFor(),
        url: base,
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const charter = await runCharterJourney(page, db, base);
    assert.equal(
      (await loadRetainedContext(client.db(sourceName))).hash,
      fixture.retainedHash,
      "Retained source was changed"
    );
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          retainedHash: fixture.retainedHash,
          stage: "banking actions",
          actions,
          governance,
          recovery,
          charter,
          resumeUntouchedFixture,
          resumedCompletedDeposit: Boolean(resumedDepositBaseline),
          excludedAuxiliaryPaths,
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
  } catch (error) {
    if (page) {
      await page
        .screenshot({ path: `${out}.failed.png`, fullPage: true, timeout: 5000 })
        .catch(() => {});
      writeFileSync(
        `${out}.failed.txt`,
        await page
          .locator("body")
          .innerText()
          .catch(() => "unavailable")
      );
    }
    throw error;
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
