/** Actual finance-minister panel against an explicitly assigned synthetic sandbox actor. */
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { SAVER } from "./bankingJourneyFixture";

export async function qualifyTreasuryPanel(db: Db, page: Page, base: string) {
  const actor = await db.collection("characters").findOne({ _id: SAVER });
  assert(actor?.isSynthetic, "Treasury journey requires the synthetic banking actor");
  await db.collection("cabinetMembers").updateOne(
    { countryId: "US", positionId: "secretary_of_treasury" },
    {
      $set: {
        countryId: "US",
        positionId: "secretary_of_treasury",
        characterId: SAVER,
        characterName: actor.name,
        party: null,
        ministerialActions: 2,
        isNPP: false,
        acting: false,
      },
    },
    { upsert: true }
  );
  const snapshot = async () => {
    const budget = await db.collection("federalBudget").findOne({ _id: "federal" as never });
    const bank = await db.collection("centralBanks").findOne({ _id: "US" as never });
    assert(budget && bank);
    return {
      treasury: budget.treasuryBalance,
      annualSpending: budget.spending,
      annualRevenue: budget.revenue?.total ?? 0,
      reserves: bank.reserveBalance,
      history: bank.treasuryTransferHistory ?? [],
    };
  };
  const before = await snapshot();
  const amount = Math.floor(Math.min(100, before.annualRevenue * 0.005, before.treasury));
  assert(amount > 0, "Use existing funded treasury, never inject cash for the UI");
  const endpoint = "/api/country/us/cabinet/treasury-transfer";
  const operationIds: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith(endpoint) && request.method() === "POST")
      operationIds.push(request.postDataJSON().operationId);
  });
  let dropped = false;
  await page.route(`**${endpoint}`, async (route) => {
    if (!dropped) {
      const response = await route.fetch();
      assert(response.ok(), await response.text());
      dropped = true;
      await route.abort("failed");
    } else await route.continue();
  });
  for (const path of [
    "/api/country/us/executive/cabinet/secretary_of_treasury/briefing",
    endpoint,
  ]) {
    const response = await page.context().request.get(`${base}${path}`, { timeout: 180000 });
    assert(response.status() < 500, path);
  }
  await page.goto(`${base}/country/us/executive/cabinet/secretary_of_treasury/office#flagship`, {
    waitUntil: "domcontentloaded",
    timeout: 300000,
  });
  await page.getByRole("button", { name: "Debt & FX", exact: true }).click({ timeout: 180000 });
  const panel = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "FX Reserve Transfer", exact: true }) });
  await panel.getByLabel("Amount ($)", { exact: true }).fill(String(amount), { timeout: 180000 });
  await panel
    .getByLabel("Justification (optional, 200 chars)")
    .fill("Synthetic sandbox settlement qualification");
  const button = panel.getByRole("button", { name: "Transfer to FX Reserve", exact: true });
  await button.click();
  await panel.getByText(/Failed to fetch|NetworkError|Load failed/).waitFor({ timeout: 180000 });
  const afterLostResponse = await snapshot();
  assert.equal(afterLostResponse.treasury, before.treasury - amount);
  assert.equal(afterLostResponse.reserves, before.reserves + amount);
  const [retried] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith(endpoint) && response.request().method() === "POST"
    ),
    button.click(),
  ]);
  assert(retried.ok());
  await panel
    .getByText(`Transferred $${amount.toLocaleString("en-US")} to FX reserves.`, { exact: true })
    .waitFor();
  const afterRetry = await snapshot();
  assert.deepEqual(afterRetry, afterLostResponse);
  assert.equal(operationIds.length, 2);
  assert(operationIds[0] && operationIds[0] === operationIds[1]);
  assert.equal(afterRetry.history.length, before.history.length + 1);
  assert.deepEqual(afterRetry.annualSpending, before.annualSpending);
  return {
    fixture:
      "Explicit synthetic treasury-minister assignment; retained treasury and bank cash unchanged during setup",
    amount,
    treasuryBefore: before.treasury,
    treasuryAfter: afterRetry.treasury,
    reservesBefore: before.reserves,
    reservesAfter: afterRetry.reserves,
    responseLostAfterCommit: true,
    sameOperationRetry: true,
    oneHistoryEntry: true,
    annualSpendingUnchanged: true,
  };
}
