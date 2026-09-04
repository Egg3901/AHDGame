import { describe, expect, it } from "vitest";
import { collectionFromCommand } from "./mongoMonitor";

/**
 * Collection attribution drives both the Sentry `db` breadcrumbs and the
 * per-phase round-trip profiler. Getting it wrong on `getMore` sent every
 * paginated batch to "unknown", which is most of the documents a turn reads:
 * large result sets are precisely the ones that paginate.
 */
describe("collectionFromCommand", () => {
  it("reads the collection from the command's own value", () => {
    expect(collectionFromCommand("find", { find: "corporations" })).toBe("corporations");
    expect(collectionFromCommand("aggregate", { aggregate: "ledgerEntries" })).toBe(
      "ledgerEntries"
    );
    expect(collectionFromCommand("update", { update: "npps" })).toBe("npps");
  });

  it("reads getMore's collection from its separate field, not the cursor id", () => {
    // The driver sends `{ getMore: <Long cursorId>, collection: "name" }`.
    // The id's exact type does not matter here, only that it is not a string.
    expect(
      collectionFromCommand("getMore", { getMore: { _bsontype: "Long" }, collection: "ledgerEntries" })
    ).toBe("ledgerEntries");
  });

  it("falls back to the collection field for any command with a non-string value", () => {
    expect(collectionFromCommand("weird", { weird: 42, collection: "corporations" })).toBe(
      "corporations"
    );
  });

  it("reports unknown when neither is available", () => {
    expect(collectionFromCommand("ping", {})).toBe("unknown");
    expect(collectionFromCommand("getMore", { getMore: { _bsontype: "Long" } })).toBe("unknown");
    expect(collectionFromCommand("find", { find: 1, collection: 2 })).toBe("unknown");
  });
});
