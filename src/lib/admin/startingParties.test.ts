import { ObjectId, type Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { ensureDefaultParties } from "@/lib/seeds/ensureDefaultParties";
import {
  clearStartingPolitics,
  loadStartingPartiesMode,
  resolveStartingPartiesMode,
  STARTING_POLITICAL_COLLECTIONS,
} from "./startingParties";

it("supports only an explicit 1991 empty start, with legacy default unchanged", () => {
  expect(resolveStartingPartiesMode("1991-default")).toBe("default");
  expect(resolveStartingPartiesMode("2019-default")).toBe("default");
  expect(resolveStartingPartiesMode("1991-default", "none")).toBe("none");
  expect(resolveStartingPartiesMode("2019-no-parties")).toBe("none");
  expect(() => resolveStartingPartiesMode("2019-default", "none")).toThrow("1991-default");
});

describe("reset political cleanup", () => {
  it("preserves economic ownership, independent registration, vacant seats and 1991 clock through repeat cleanup", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const ceo = new ObjectId(),
      owner = new ObjectId(),
      politician = new ObjectId(),
      technocrat = new ObjectId();
    memory.seed("gameState", [
      {
        _id: "current",
        preset: "1991-default",
        currentYear: 1991,
        startingYear: 1991,
        currentTurn: 1,
        startingPartiesMode: "none",
      },
    ]);
    memory.seed(
      "npps",
      [ceo, owner, politician, technocrat].map((_id) => ({
        _id,
        party: "1",
        currentOffice: { type: "senate" },
        funds: 17,
        currencyBalances: { personal: { USD: 123 } },
      }))
    );
    await memory
      .collection("npps")
      .updateOne({ _id: politician }, { $set: { currencyBalances: { personal: { USD: 0 } } } });
    const firm = {
      _id: new ObjectId(),
      ceoType: "npp",
      ceoId: ceo,
      shareholders: [{ nppId: owner, shares: 100 }],
      cash: 500,
    };
    memory.seed("corporations", [firm]);
    const monetaryBoard = {
      _id: "USD",
      chairNppId: technocrat,
      chairMode: "npp",
      fomcBoard: [{ nppId: technocrat, occupantType: "npp", alignment: "dove" }],
    };
    memory.seed("centralBanks", [monetaryBoard]);
    await memory
      .collection("npps")
      .updateOne(
        { _id: technocrat },
        { $set: { currentOffice: null, isTechnocrat: true, technocratRole: "fomcMember" } }
      );
    memory.seed("electedOfficials", [
      { _id: "occupied", nppId: politician, characterId: null },
      { _id: "vacant", characterId: null },
    ]);
    memory.seed("stateRegistrationPool", [{ _id: "US_PA", independent: 15, unregistered: 20 }]);
    memory.seed("elections", [{ _id: "player-race", status: "active" }]);
    memory.seed("countryState", [{ _id: "US", rulingPartyId: 1 }]);
    for (const collection of STARTING_POLITICAL_COLLECTIONS)
      memory.seed(collection, [
        { _id: new ObjectId(), partyId: "1", countryId: "US", nppId: politician },
      ]);
    await clearStartingPolitics(db, "1991-default");
    await clearStartingPolitics(db, "1991-default");
    for (const collection of STARTING_POLITICAL_COLLECTIONS)
      expect(memory.collection(collection).docs, collection).toEqual([]);
    expect(
      memory
        .collection("npps")
        .docs.map((row) => String(row._id))
        .sort()
    ).toEqual([ceo, owner, technocrat].map(String).sort());
    for (const row of memory.collection("npps").docs)
      expect(row).toMatchObject({
        party: "independent",
        currentOffice: null,
        funds: 17,
        currencyBalances: { personal: { USD: 123 } },
      });
    expect(memory.collection("corporations").docs).toEqual([firm]);
    expect(memory.collection("centralBanks").docs).toEqual([monetaryBoard]);
    expect(await memory.collection("npps").findOne({ _id: technocrat })).toMatchObject({
      isTechnocrat: true,
      technocratRole: "fomcMember",
      currentOffice: null,
    });
    expect(memory.collection("countryState").docs[0].rulingPartyId).toBeNull();
    expect(memory.collection("electedOfficials").docs).toEqual([
      { _id: "vacant", characterId: null },
    ]);
    expect(memory.collection("stateRegistrationPool").docs[0]).toMatchObject({
      independent: 80,
      unregistered: 20,
    });
    expect(memory.collection("elections").docs).toHaveLength(1);
    expect(memory.collection("gameState").docs[0]).toMatchObject({
      preset: "1991-default",
      currentYear: 1991,
    });
    expect(await loadStartingPartiesMode(db, "1991-default")).toBe("none");
    expect(await loadStartingPartiesMode(db, "1991-default", "default")).toBe("default");
  });

  it("retains savings, pending payouts and debt owners while removing unreferenced seeded wallets", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    const saver = new ObjectId(),
      payee = new ObjectId(),
      wallet = new ObjectId(),
      debtor = new ObjectId();
    memory.seed("npps", [
      { _id: saver, party: "1", currentOffice: null, currencyBalances: { personal: { GBP: 42 } } },
      { _id: payee, party: "2", currentOffice: null },
      { _id: wallet, party: "3", currentOffice: null, currencyBalances: { personal: { GBP: 42 } } },
      {
        _id: debtor,
        party: "4",
        currentOffice: null,
        lineOfCredit: { balances: { USD: 30 }, arrears: { USD: 2 } },
      },
    ]);
    const account = { _id: new ObjectId(), ownerType: "npp", ownerId: saver, balance: 50 };
    const payout = {
      _id: new ObjectId(),
      nppId: payee,
      requestedAmountAnchor: 11,
      status: "queued",
    };
    memory.seed("savingsAccounts", [account]);
    memory.seed("indexFundRedemptionQueue", [payout]);
    await clearStartingPolitics(db, "1991-default");
    expect(memory.collection("npps").docs).toHaveLength(3);
    expect(memory.collection("npps").docs.every((row) => row.party === "independent")).toBe(true);
    expect(await memory.collection("npps").findOne({ _id: wallet })).toBeNull();
    expect(await memory.collection("npps").findOne({ _id: saver })).toMatchObject({
      currencyBalances: { personal: { GBP: 42 } },
    });
    expect(await memory.collection("npps").findOne({ _id: debtor })).toMatchObject({
      lineOfCredit: { balances: { USD: 30 }, arrears: { USD: 2 } },
    });
    expect(memory.collection("savingsAccounts").docs).toEqual([account]);
    expect(memory.collection("indexFundRedemptionQueue").docs).toEqual([payout]);
  });

  it("clears only enabled player countries and preserves disabled background governments", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("countryGameStates", [
      ...["US", "UK", "DE", "JP", "RU"].map((_id) => ({ _id, enabledForPlayers: false })),
      { _id: "PL", enabledForPlayers: true, status: "active" },
    ]);
    const player = new ObjectId(),
      owner = new ObjectId(),
      background = new ObjectId();
    memory.seed("npps", [
      {
        _id: player,
        countryId: "PL",
        party: "1",
        currentOffice: { type: "sejm" },
        currencyBalances: { personal: { PLN: 1000 } },
      },
      { _id: owner, countryId: "PL", party: "1", currentOffice: null },
      { _id: background, countryId: "US", party: "2", currentOffice: { type: "president" } },
    ]);
    memory.seed("corporations", [
      { _id: new ObjectId(), ceoType: "npp", ceoId: owner, shareholders: [] },
    ]);
    for (const collection of STARTING_POLITICAL_COLLECTIONS) {
      memory.seed(collection, [
        { _id: new ObjectId(), countryId: "PL", nppId: player, partyId: "1" },
        { _id: new ObjectId(), countryId: "US", nppId: background, partyId: "2" },
      ]);
    }
    memory.seed("electedOfficials", [
      { _id: "player-seat", countryId: "PL", nppId: player, characterId: null },
      { _id: "background-seat", countryId: "US", nppId: background, characterId: null },
    ]);
    memory.seed("countryState", [
      { _id: "PL", rulingPartyId: 1 },
      { _id: "US", rulingPartyId: 2 },
    ]);
    const playerElection = new ObjectId(),
      backgroundElection = new ObjectId();
    memory.seed("statePartyElections", [
      { _id: playerElection, countryId: "PL" },
      { _id: backgroundElection, countryId: "US" },
    ]);
    memory.seed("statePartyVotes", [
      { _id: "player-vote", electionId: playerElection },
      { _id: "background-vote", electionId: backgroundElection },
    ]);
    await clearStartingPolitics(db, "1991-default");
    expect(await memory.collection("statePartyVotes").findOne({ _id: "player-vote" })).toBeNull();
    expect(
      await memory.collection("statePartyVotes").findOne({ _id: "background-vote" })
    ).not.toBeNull();
    for (const collection of STARTING_POLITICAL_COLLECTIONS) {
      expect(
        memory.collection(collection).docs.some((row) => row.countryId === "PL"),
        collection
      ).toBe(false);
      expect(
        memory.collection(collection).docs.some((row) => row.countryId === "US"),
        collection
      ).toBe(true);
    }
    expect(await memory.collection("npps").findOne({ _id: player })).toBeNull();
    expect(await memory.collection("npps").findOne({ _id: owner })).toMatchObject({
      party: "independent",
    });
    expect(await memory.collection("npps").findOne({ _id: background })).toMatchObject({
      party: "2",
      currentOffice: { type: "president" },
    });
    expect(memory.collection("electedOfficials").docs.map((row) => row._id)).toEqual([
      "background-seat",
    ]);
    expect(await memory.collection("countryState").findOne({ _id: "US" })).toMatchObject({
      rulingPartyId: 2,
    });
    expect(await memory.collection("countryState").findOne({ _id: "PL" })).toMatchObject({
      rulingPartyId: null,
    });
    // The old special preset remains globally empty, independent of country access.
    await clearStartingPolitics(db, "2019-no-parties");
    expect(memory.collection("politicalParties").docs).toEqual([]);
  });

  it("actual default-party seeding can follow none, and cleanup removes it again", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    await clearStartingPolitics(db, "1991-default");
    memory.seed("countryGameStates", [{ _id: "UK", enabledForPlayers: false }]);
    const created = await ensureDefaultParties(db, "1991-default");
    expect(created).toBeGreaterThan(0);
    expect(memory.collection("politicalParties").docs.length).toBe(created);
    await clearStartingPolitics(db, "1991-default");
    expect(
      memory.collection("politicalParties").docs.filter((row) => row.countryId === "US")
    ).toEqual([]);
    expect(memory.collection("politicalParties").docs.some((row) => row.countryId === "UK")).toBe(
      true
    );
  });

  it("actual vacant-office bootstrap creates player races under the 1991 clock without parties or NPPs", async () => {
    const memory = createInMemoryDb();
    const db = memory as unknown as Db;
    memory.seed("gameState", [
      {
        _id: "current",
        preset: "1991-default",
        currentYear: 1991,
        startingYear: 1991,
        currentTurn: 1,
        startingPartiesMode: "none",
      },
    ]);
    memory.seed("states", [{ _id: "PA", countryId: "US", name: "Pennsylvania" }]);
    const { initializeOfficials } = await import("./bootstrap/initializeOfficials");
    const result = await initializeOfficials(db);
    expect(result.counts.elections).toBeGreaterThan(0);
    expect(memory.collection("elections").docs.length).toBeGreaterThan(0);
    expect(
      memory
        .collection("electedOfficials")
        .docs.every((row) => row.characterId == null && row.nppId == null)
    ).toBe(true);
    expect(memory.collection("politicalParties").docs).toEqual([]);
    expect(memory.collection("npps").docs).toEqual([]);
    expect(memory.collection("gameState").docs[0].preIteration).toBeUndefined();
  });
});
