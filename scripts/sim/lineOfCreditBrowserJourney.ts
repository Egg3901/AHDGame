/** Existing LOC page, actual routes and a deliberately lost successful response. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient } from "mongodb";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { bankingJourneyApp } from "./bankingJourneyApp";
import { USER, SAVER } from "./bankingJourneyFixture";
import { processLineOfCreditTurn } from "@/lib/turn/lineOfCreditTurn";
const arg = (key: string) =>
  process.argv.find((x) => x.startsWith(`--${key}=`))?.slice(key.length + 3);
async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    source = arg("source"),
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(
    source &&
      target &&
      source !== target &&
      out &&
      [source, target].every((n) => /^ahd_sim_[a-zA-Z0-9_]+$/.test(n))
  );
  assert.equal(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(), "");
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: uri,
    MONGODB_DB: target,
    MONGO_DB_NAME: target,
  });
  const client = await MongoClient.connect(uri);
  global._mongoClientPromise = Promise.resolve(client);
  const db = client.db(target),
    retained = client.db(source);
  const sourceHash = (await retained.command({ dbHash: 1 })).md5;
  assert.equal((await db.listCollections().toArray()).length, 0);
  for (const { name } of await retained.listCollections().toArray()) {
    const docs = await retained.collection(name).find({}).toArray();
    if (docs.length) await db.collection(name).insertMany(docs);
  }
  assert.equal(
    (await db.collection("users").findOne({ _id: USER }))?.email,
    "banking-player@example.invalid"
  );
  assert(
    !(await db.collection("characters").findOne({ _id: SAVER }))?.lineOfCredit,
    "Fresh LOC journey needs no existing LOC"
  );
  const snapshot = async () => {
    const c = await db.collection("characters").findOne({ _id: SAVER });
    return {
      wallet: c!.currencyBalances.personal.USD,
      loc: c!.lineOfCredit ?? null,
      journals: await db.collection("bankMoneyMoves").countDocuments({ kind: "line_of_credit" }),
      ledger: await db.collection("locLedger").countDocuments({ characterId: SAVER }),
    };
  };
  const before = await snapshot();
  const checkpoints: Array<{ stage: string; state: Awaited<ReturnType<typeof snapshot>> }> = [];
  const checkpoint = async (stage: string) => {
    checkpoints.push({ stage, state: await snapshot() });
    writeFileSync(`${out}.checkpoint.json`, JSON.stringify({ sourceCommit, checkpoints }, null, 2));
  };
  await checkpoint("before_browser");
  const app = bankingJourneyApp(uri, target, out, sourceCommit);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      app.assertAlive();
      try {
        // Harness-owned loopback sandbox readiness only.
        // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request
        ready =
          (await fetch(`${app.base}/api/health`, { signal: AbortSignal.timeout(2500) })).status <
          500;
      } catch {
        /* development route compilation */
      }
      if (!ready) await delay(1000);
    }
    assert(ready);
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const exclusions = [
      "/api/players/online",
      "/api/poll-banner",
      "/api/global-alerts/active",
      "/api/flags/country/",
      "/api/images/hero/",
    ];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === app.base && !exclusions.some((path) => url.pathname.startsWith(path))
        ? route.continue()
        : route.abort();
    });
    const token = await new SignJWT({
      userId: USER.toHexString(),
      username: "Synthetic banking player",
      email: "banking-player@example.invalid",
      role: "player",
      isAdmin: false,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(new TextEncoder().encode(app.secret));
    await context.addCookies([
      { name: "auth-token-local", value: token, url: app.base, httpOnly: true, sameSite: "Lax" },
    ]);
    for (const path of [
      "/api/client-nav",
      "/centralbank/usd?tab=loc",
      "/api/maintenance",
      "/api/auth/me",
      "/api/character/me",
      "/api/client-status",
      "/api/world/flags",
      "/api/forex/rates",
      "/api/game/turn/status",
      "/api/country/us/central-bank",
      "/api/character/loc",
      "/api/country/us/central-bank/loc",
      "/api/character/loc/open",
      "/api/character/loc/draw",
      "/api/character/loc/repay",
    ]) {
      const response = await context.request.get(`${app.base}${path}`, { timeout: 300000 });
      assert(response.status() < 500, path);
      console.log("LOC route ready", path, response.status());
    }
    const page = await context.newPage(),
      errors: string[] = [],
      commands: Array<{ operation: string; commandId: string; amount: number }> = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (req) => {
      if (
        /\/api\/character\/loc\/(draw|repay)$/.test(new URL(req.url()).pathname) &&
        req.method() === "POST"
      ) {
        const body = req.postDataJSON();
        commands.push({
          operation: new URL(req.url()).pathname.split("/").at(-1)!,
          commandId: body.commandId,
          amount: body.amount,
        });
      }
    });
    await page.goto(`${app.base}/centralbank/usd?tab=loc`, {
      waitUntil: "domcontentloaded",
      timeout: 300000,
    });
    const reject = page.getByRole("button", { name: "Reject", exact: true });
    if (await reject.isVisible()) await reject.click();
    await page
      .getByRole("button", { name: "Open account", exact: true })
      .waitFor({ timeout: 180000 });
    const [opened] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/character/loc/open") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Open account", exact: true }).click(),
    ]);
    assert(opened.ok());
    await page.getByPlaceholder("1000", { exact: true }).fill("1000");
    let dropped = false;
    await page.route("**/api/character/loc/draw", async (route) => {
      if (!dropped) {
        const response = await route.fetch();
        assert(response.ok(), await response.text());
        dropped = true;
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Borrow to wallet", exact: true }).click();
    await page
      .getByText(
        "The result could not be confirmed. Retry the same amount to check this command.",
        { exact: true }
      )
      .waitFor({ timeout: 180000 });
    const afterLostResponse = await snapshot();
    await checkpoint("afterLostResponse");
    assert.equal(afterLostResponse.wallet, before.wallet + 1000);
    assert.equal(afterLostResponse.loc.balances.USD, 1000);
    const [replayed] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/character/loc/draw") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Borrow to wallet", exact: true }).click(),
    ]);
    assert(replayed.ok());
    const afterRetry = await snapshot();
    await checkpoint("afterRetry");
    assert.deepEqual(afterRetry, afterLostResponse);
    assert.equal(commands[0].commandId, commands[1].commandId);
    await page.getByPlaceholder("1000", { exact: true }).fill("500");
    const [next] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/character/loc/draw") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Borrow to wallet", exact: true }).click(),
    ]);
    assert(next.ok());
    assert.notEqual(commands[2].commandId, commands[0].commandId);
    const afterNewDraw = await snapshot();
    await checkpoint("afterNewDraw");
    assert.equal(afterNewDraw.loc.balances.USD, 1500);
    await page.getByPlaceholder("Amount", { exact: true }).fill("1000");
    const [repaid] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/character/loc/repay") && r.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Repay", exact: true }).click(),
    ]);
    assert(repaid.ok());
    const afterRepay = await snapshot();
    await checkpoint("afterRepay");
    assert.equal(afterRepay.loc.balances.USD, 500);
    assert.equal(afterRepay.wallet, before.wallet + 500);
    const game = await db.collection("gameState").findOne({ _id: "current" as never });
    assert(game);
    const turn = game.currentTurn + 1;
    await db
      .collection("gameState")
      .updateOne({ _id: "current" as never }, { $set: { currentTurn: turn } });
    const servicing = await processLineOfCreditTurn(db, turn, new Map(), new Map(), true);
    const afterTurn = await snapshot();
    await checkpoint("afterTurn");
    assert(afterTurn.loc.balances.USD < 500);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 180000 });
    const read = await context.request.get(`${app.base}/api/country/us/central-bank/loc`);
    assert(read.ok());
    const readModel = await read.json();
    assert.equal(readModel.snapshot.balances.USD, afterTurn.loc.balances.USD);
    assert.deepEqual(errors, []);
    assert.equal((await retained.command({ dbHash: 1 })).md5, sourceHash);
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          retainedSourceUnchanged: true,
          scope:
            "Existing LOC page against copied synthetic retained banking actors; real auth/routes/settlements and one LOC turn",
          before,
          afterLostResponse,
          afterRetry,
          afterNewDraw,
          afterRepay,
          afterTurn,
          servicing,
          commandIds: { retrySame: true, nextDifferent: true },
          errors,
          readModelPrincipal: readModel.snapshot.balances.USD,
        },
        null,
        2
      )
    );
    console.log("LOC browser journey passed");
  } catch (error) {
    await checkpoint("stopped_after_error");
    throw error;
  } finally {
    await browser?.close();
    app.finish(true);
    await client.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
