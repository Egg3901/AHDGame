import { describe, expect, it } from "vitest";
import {
  liveCabinetMigrationTarget,
  parseLiveCabinetMigrationArgs,
  runLiveCabinetMigration,
} from "./complete-cabinet-v2-accounts-live";

describe("explicit live Cabinet migration", () => {
  it("defaults to dry-run and requires an explicit apply flag", () => {
    expect(parseLiveCabinetMigrationArgs([])).toMatchObject({ dryRun: true, force: false });
    expect(parseLiveCabinetMigrationArgs(["--apply", "--force"])).toMatchObject({
      dryRun: false,
      force: true,
    });
    expect(() => parseLiveCabinetMigrationArgs(["--apply", "--dry-run"])).toThrow();
    expect(() => parseLiveCabinetMigrationArgs(["--only=anything"])).toThrow();
  });
  it("never uses the local URI or local database override", () => {
    expect(() => liveCabinetMigrationTarget({ MONGODB_URI: "mongodb://local/localdb" })).toThrow(
      "MONGODB_URI_LIVE"
    );
    expect(
      liveCabinetMigrationTarget({
        MONGODB_URI_LIVE: "mongodb://live.example/livegame",
        MONGODB_DB: "localdb",
        MONGO_DB_NAME: "other",
      }).databaseName
    ).toBe("livegame");
    expect(
      liveCabinetMigrationTarget({
        MONGODB_URI_LIVE: "mongodb://live.example/livegame",
        MONGODB_DB_LIVE: "explicit",
      }).databaseName
    ).toBe("explicit");
    expect(() => liveCabinetMigrationTarget({ MONGODB_URI_LIVE: "https://invalid" })).toThrow(
      "scheme"
    );
  });
  it("shows help without any environment or database connection", async () => {
    await expect(runLiveCabinetMigration(["--help"], {})).resolves.toBeUndefined();
  });
});
