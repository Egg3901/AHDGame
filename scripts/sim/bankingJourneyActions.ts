/** Serial real UI commands, verified against authoritative sandbox state after each response. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import type { Page } from "playwright";
import { BANK, BORROWER, advanceJourney, journeySnapshot } from "./bankingJourneyFixture";

export async function runBankingActions(
  page: Page,
  db: Db,
  base: string,
  turn: number,
  resumedDepositBaseline?: Awaited<ReturnType<typeof journeySnapshot>>
) {
  page.setDefaultTimeout(120_000);
  const snapshots: { stage: string; state: Awaited<ReturnType<typeof journeySnapshot>> }[] = [];
  const capture = async (stage: string) => {
    const state = await journeySnapshot(db);
    snapshots.push({ stage, state });
    writeFileSync(
      `${process.env.JOURNEY_SCREENSHOT_PREFIX}.steps.json`,
      JSON.stringify(snapshots, null, 2)
    );
    assert(
      state.journals.every((move) => move.status === "applied"),
      `${stage}: partial journal`
    );
    console.log(`completed ${stage}`);
    return state;
  };
  const near = (actual: number, expected: number, label: string) =>
    assert(Math.abs(actual - expected) < 0.02, `${label}: ${actual} != ${expected}`);
  const command = async (path: string, action: () => Promise<unknown>) => {
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === path && r.request().method() !== "GET",
      { timeout: 180_000 }
    );
    const [result] = await Promise.all([response, action()]);
    const body = await result.json();
    assert(result.ok(), `${path}: ${result.status()} ${JSON.stringify(body)}`);
    return body;
  };
  const baseline = resumedDepositBaseline ?? (await capture("baseline"));
  if (!resumedDepositBaseline) {
    await page
      .getByRole("button", { name: "Deposit savings at Journey Savings Bank", exact: true })
      .click();
    await page.getByLabel("Deposit amount in USD").fill("1000000");
    await command("/api/character/savings/deposit", () =>
      page.getByRole("button", { name: "Deposit savings", exact: true }).click()
    );
    await page
      .getByRole("dialog", { name: "Deposit with Journey Savings Bank" })
      .waitFor({ state: "hidden" });
  }
  const deposited = await capture(
    resumedDepositBaseline ? "resumed completed UI deposit 1000000 USD" : "UI deposit 1000000 USD"
  );
  near(deposited.saverWallet, baseline.saverWallet - 1_000_000, "deposit wallet debit");
  near(deposited.bank.cash, baseline.bank.cash + 1_000_000, "deposit vault credit");
  near(deposited.bank.liability, 1_000_000, "deposit liability");
  near(deposited.cash, baseline.cash, "deposit cash conservation");
  assert.equal(deposited.savings[0]?.holder, "privateBank");
  await page.getByRole("tab", { name: "Your accounts", exact: true }).click();
  await page.getByLabel("Withdrawal amount in USD").fill("200000");
  await command("/api/character/savings/withdraw", () =>
    page.getByRole("button", { name: "Withdraw USD savings", exact: true }).click()
  );
  await page.getByLabel("Withdrawal amount in USD").waitFor();
  const withdrawn = await capture("UI withdrawal 200000 USD");
  near(withdrawn.saverWallet, deposited.saverWallet + 200_000, "withdraw wallet credit");
  near(withdrawn.bank.cash, deposited.bank.cash - 200_000, "withdraw vault debit");
  near(withdrawn.savings[0].balance, 800_000, "remaining savings");
  near(withdrawn.cash, baseline.cash, "withdraw cash conservation");
  await command("/api/character/savings-holder", () =>
    page.getByLabel("Savings holder for USD").selectOption("centralBank")
  );
  const central = await capture("UI holder transfer to central bank");
  assert.equal(central.savings[0].holder, "centralBank");
  near(central.bank.liability, 0, "liability released");
  near(central.cash, baseline.cash, "holder cash conservation");
  await command("/api/character/savings-holder", () =>
    page.getByLabel("Savings holder for USD").selectOption(BANK.toHexString())
  );
  const returned = await capture("UI holder transfer to private bank");
  near(returned.bank.cash, withdrawn.bank.cash, "returned backing");
  near(returned.bank.liability, 800_000, "returned liability");
  await page.getByRole("tab", { name: /Private banks/ }).click();
  await page
    .getByRole("button", { name: "Apply for a loan at Journey Savings Bank", exact: true })
    .click();
  await page.getByRole("button", { name: "Corporation loan", exact: true }).click();
  await page.getByLabel("Borrowing corporation").selectOption(BORROWER.toHexString());
  await page.getByLabel("Loan principal").fill("100000");
  await page.getByLabel("Loan term in turns").fill("12");
  await command("/api/banking/loans", () =>
    page.getByRole("button", { name: "Submit loan request", exact: true }).click()
  );
  await page
    .getByRole("dialog", { name: "Arrange private-bank credit" })
    .waitFor({ state: "hidden" });
  const loan = await capture("UI corporate loan 100000 USD");
  near(loan.borrowerCash, baseline.borrowerCash + 100_000, "loan credit");
  near(loan.bank.cash, returned.bank.cash - 100_000, "loan vault debit");
  near(loan.cash, baseline.cash, "loan cash conservation");
  assert.equal(loan.loans[0]?.outstanding, 100_000);
  const game = await db.collection("gameState").findOne({ _id: "current" as never });
  const phases = await advanceJourney(db, turn + 1, game?.currentYear ?? game?.gameYear ?? 1991);
  const afterTurn = await capture("actual banking solvency and committee turn");
  near(afterTurn.cash, baseline.cash, "turn cash conservation");
  assert(afterTurn.savings[0].balance > 800_000, "deposit interest must reach account");
  assert(afterTurn.loans[0].outstanding < 100_000, "borrower must repay actual loan");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.getByRole("tab", { name: "Your accounts", exact: true }).click();
  const hub = await page.request.get(`${base}/api/banking/hub`);
  assert(hub.ok());
  const readModel = await hub.json();
  assert.equal(readModel.currentTurn, turn + 1);
  assert.equal(readModel.loans[0]?.outstanding, afterTurn.loans[0].outstanding);
  assert.equal(readModel.savings[0]?.balance, afterTurn.savings[0].balance);
  return { snapshots, phases, readModel, body: await page.locator("body").innerText() };
}
