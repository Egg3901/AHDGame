/** Failed delivery and stale bank destination, with real command state checked around recovery. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { revokeCharter } from "@/lib/banking/charter";
import { BANK, journeySnapshot } from "./bankingJourneyFixture";

export async function runRecoveryJourney(page: Page, db: Db, base: string, development: boolean) {
  const beforeFailure = await journeySnapshot(db);
  const failure = page
    .waitForEvent("pageerror", { timeout: 1500 })
    .then((e) => e.message)
    .catch(() => null);
  await page.route("**/api/character/savings-holder", (route) => route.abort("failed"), {
    times: 1,
  });
  await page.getByLabel("Savings holder for USD").selectOption("centralBank");
  const unhandledFailure = await failure;
  const afterFailure = await journeySnapshot(db);
  assert.deepEqual(
    { ...afterFailure, audits: [] },
    { ...beforeFailure, audits: [] },
    "Failed network delivery must not mutate savings"
  );
  const feedbackVisible = await page
    .getByText("Could not move savings. Check your connection and try again.", { exact: true })
    .isVisible();
  writeFileSync(
    `${process.env.JOURNEY_SCREENSHOT_PREFIX}.recovery.json`,
    JSON.stringify({ unhandledFailure, feedbackVisible }, null, 2)
  );
  if (!development) {
    assert.equal(
      unhandledFailure,
      null,
      "Holder failure must not escape as an unhandled rejection"
    );
    assert(feedbackVisible, "Holder failure must show recovery feedback");
  }
  // The request was never delivered, so a fresh user attempt may safely retry.
  const recoveredResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/character/savings-holder" &&
      r.request().method() === "PUT"
  );
  await page.getByLabel("Savings holder for USD").selectOption("centralBank");
  assert((await recoveredResponse).ok());
  const recovered = await journeySnapshot(db);
  assert.equal(recovered.savings[0].holder, "centralBank");
  assert.equal(recovered.savings[0].balance, beforeFailure.savings[0].balance);
  // Open a real deposit form, then let actual supervisory revocation make its destination stale.
  await page.getByRole("tab", { name: /Private banks/ }).click();
  await page
    .getByRole("button", { name: "Deposit savings at Journey Savings Bank", exact: true })
    .click();
  await page.getByLabel("Deposit amount in USD").fill("1000");
  const revoked = await revokeCharter(
    db,
    BANK,
    "Synthetic sandbox stale-destination qualification"
  );
  assert(revoked.ok);
  const beforeDeposit = await journeySnapshot(db);
  const depositResponse = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/character/savings/deposit" &&
      r.request().method() === "POST",
    { timeout: 180_000 }
  );
  await page.getByRole("button", { name: "Deposit savings", exact: true }).click();
  const deposit = await depositResponse;
  assert(deposit.ok());
  const result = await deposit.json();
  assert.equal(
    result.holderRouted,
    false,
    "Stale destination must be disclosed independently of the successful deposit"
  );
  await page
    .getByRole("dialog", { name: "Deposit with Journey Savings Bank" })
    .waitFor({ state: "hidden" });
  const afterDeposit = await journeySnapshot(db);
  assert(
    Math.abs(afterDeposit.cash - beforeDeposit.cash) < 0.02,
    "Successful central deposit conserves cash"
  );
  assert.equal(afterDeposit.saverWallet, beforeDeposit.saverWallet - 1000);
  assert.equal(afterDeposit.savings[0].balance, beforeDeposit.savings[0].balance + 1000);
  assert.equal(afterDeposit.savings[0].holder, "centralBank");
  assert(
    await page.getByText(/Deposited, but could not route to Journey Savings Bank/).isVisible()
  );
  await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.getByRole("tab", { name: "Your accounts", exact: true }).click();
  assert.equal(
    await page.getByRole("dialog", { name: "Deposit with Journey Savings Bank" }).count(),
    0,
    "A successful deposit must not leave a retryable form"
  );
  const afterReload = await journeySnapshot(db);
  assert.equal(afterReload.saverWallet, afterDeposit.saverWallet);
  assert.equal(afterReload.savings[0].balance, afterDeposit.savings[0].balance);
  const observed = await page.request.get(`${base}/api/banking/hub`);
  const readModel = await observed.json();
  assert.equal(readModel.savings[0].balance, afterDeposit.savings[0].balance);
  console.log("completed savings failure recovery and stale destination finality");
  return {
    unhandledFailure,
    feedbackVisible,
    beforeFailure,
    afterFailure,
    recovered,
    revoked,
    beforeDeposit,
    afterDeposit,
    result,
    dialogClosed: true,
    reloadDidNotRepeatCommand: true,
  };
}
