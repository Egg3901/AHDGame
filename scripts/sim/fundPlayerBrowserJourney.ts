/** Bounded player fund journey. Uses an existing synthetic sandbox, never a world job. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { MongoClient, ObjectId } from "mongodb";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { bankingJourneyApp } from "./bankingJourneyApp";
import { runIndexFundCron } from "@/lib/indexFunds/fundCron";

const arg = (key: string) =>
  process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);

async function main() {
  const uri = process.env.SIM_MONGODB_URI,
    target = arg("target"),
    out = arg("out");
  assert(uri && /^mongodb:\/\/(127\.0\.0\.1|localhost):27018\/?$/.test(uri));
  assert(target && /^ahd_sim_fund_commands_[a-z0-9_]+$/.test(target) && out);
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
    actor = new ObjectId("000000000000000000002120");
  const fundId = new ObjectId("000000000000000000002121");
  assert.equal(
    (await db.collection("characters").findOne({ _id: actor }))?.name,
    "Synthetic fund investor"
  );
  const existingUser = await db.collection("users").findOne({ _id: actor });
  assert.equal(await db.collection("users").countDocuments(), existingUser ? 1 : 0);
  if (existingUser) assert.equal(existingUser.email, "fund-player@example.invalid");
  else
    await db.collection("users").insertOne({
      _id: actor,
      username: "Synthetic fund investor",
      email: "fund-player@example.invalid",
      role: "player",
      isAdmin: false,
      activeCharacterId: actor,
      createdAt: new Date(),
    });
  await db
    .collection("characters")
    .updateOne(
      { _id: actor },
      { $set: { userId: actor, isSynthetic: true, statsAllocated: true, isActive: true } }
    );
  const snapshot = async () => {
    const character = await db.collection("characters").findOne({ _id: actor });
    const fund = await db.collection("indexFunds").findOne({ _id: fundId });
    const position = await db
      .collection("indexFundPositions")
      .findOne({ fundId, characterId: actor });
    return {
      wallet: character!.currencyBalances.personal.USD,
      cashAnchor: fund!.cashAnchor,
      nav: fund!.quotedNav,
      supply: fund!.unitSupply,
      units: position?.units ?? 0,
      transactions: await db.collection("indexFundTransactions").countDocuments({ fundId }),
    };
  };
  const app = bankingJourneyApp(uri, target, out, sourceCommit);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      app.assertAlive();
      try {
        ready =
          (await fetch(`${app.base}/api/health`, { signal: AbortSignal.timeout(2500) })).status <
          500;
      } catch {
        /* cold route compilation */
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
      userId: actor.toHexString(),
      username: "Synthetic fund investor",
      email: "fund-player@example.invalid",
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
    // Keep the same app and authenticated context while each exact module warms.
    for (const path of [
      "/api/game/turn/status",
      "/api/client-nav",
      "/api/maintenance",
      "/api/client-status",
      "/api/auth/me",
      "/api/character/me",
      "/api/world/flags",
      "/api/forex/rates",
      "/api/investment-funds/fixture",
      "/api/investment-funds/fixture/transactions",
    ]) {
      const response = await context.request.get(`${app.base}${path}`, { timeout: 120000 });
      assert(response.status() < 500, `${path}: ${response.status()}`);
    }
    const page = await context.newPage();
    const diagnostics: unknown[] = [];
    page.on("pageerror", (error) => diagnostics.push({ pageError: error.message }));
    page.on("requestfailed", (request) =>
      diagnostics.push({
        failedRequest: new URL(request.url()).pathname,
        failure: request.failure(),
      })
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        diagnostics.push({ response: new URL(response.url()).pathname, status: response.status() });
    });
    const capture = async () => {
      writeFileSync(
        `${out}.diagnostics.json`,
        JSON.stringify(
          { url: page.url(), text: await page.locator("body").innerText(), diagnostics },
          null,
          2
        )
      );
      await page.screenshot({ path: `${out}.diagnostics.png`, fullPage: true });
    };
    const checkpoints: unknown[] = [];
    await page.goto(`${app.base}/stockmarket/us/fund/fixture`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    for (const mode of ["subscribe", "redeem"] as const) {
      const requests: Array<{ operationId: string; units: number }> = [];
      let lost = false;
      await context.route(`**/api/investment-funds/*/${mode}`, async (route) => {
        requests.push(route.request().postDataJSON());
        const response = await route.fetch({ timeout: 120000 });
        if (!lost && response.ok()) {
          lost = true;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      const before = await snapshot();
      if (mode === "redeem")
        await page.getByRole("button", { name: "Redeem", exact: true }).click();
      const action = () =>
        mode === "subscribe"
          ? page.getByRole("button", { name: "Subscribe", exact: true }).last()
          : page.getByRole("button", { name: "Redeem units", exact: true });
      try {
        await action().click({ timeout: 120000 });
      } catch (error) {
        await capture();
        throw error;
      }
      await page.getByText("Network error", { exact: true }).waitFor({ timeout: 120000 });
      assert(lost);
      const committed = await snapshot();
      assert.equal(committed.units, before.units + (mode === "subscribe" ? 1 : -1));
      assert.equal(committed.wallet + committed.cashAnchor, before.wallet + before.cashAnchor);
      assert.equal(committed.supply, committed.units);
      assert(await page.getByRole("spinbutton").isDisabled());
      await action().click();
      await page
        .getByText("Network error", { exact: true })
        .waitFor({ state: "hidden", timeout: 120000 });
      await page.getByRole("spinbutton").waitFor({ timeout: 120000 });
      assert.equal(requests.length, 2);
      assert.equal(requests[0].operationId, requests[1].operationId);
      assert.deepEqual(await snapshot(), committed);
      const read = await context.request.get(`${app.base}/api/investment-funds/fixture`);
      assert.equal((await read.json()).myPosition.units, committed.units);
      checkpoints.push({
        mode,
        before,
        committed,
        requests,
        lostSuccessfulResponse: true,
        readModelMatches: true,
      });
      writeFileSync(
        `${out}.checkpoint.json`,
        JSON.stringify({ sourceCommit, checkpoints }, null, 2)
      );
      await context.unroute(`**/api/investment-funds/*/${mode}`);
    }
    const beforeTurn = await snapshot();
    const turn = await runIndexFundCron(db, { currentTurn: 3 });
    const afterTurn = await snapshot();
    assert.equal(
      afterTurn.wallet + afterTurn.cashAnchor,
      beforeTurn.wallet + beforeTurn.cashAnchor
    );
    assert.equal(afterTurn.supply, afterTurn.units);
    const read = await context.request.get(`${app.base}/api/investment-funds/fixture`);
    const model = await read.json();
    assert.equal(model.myPosition.units, afterTurn.units);
    assert.equal(model.fund.cashAnchor, afterTurn.cashAnchor);
    await page.screenshot({ path: `${out}.png`, fullPage: true });
    writeFileSync(
      out,
      JSON.stringify(
        {
          sourceCommit,
          scope:
            "Synthetic fixture, real fund UI, authenticated routes, native Mongo, normal fund turn and read model. No world simulation.",
          checkpoints,
          turn,
          afterTurn,
          knownLimit:
            "An unknown interrupted standalone settlement remains pending for reconciliation; it is never blindly repeated.",
        },
        null,
        2
      )
    );
    console.log("Fund player browser journey passed");
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
