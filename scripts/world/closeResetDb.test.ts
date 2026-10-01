import { MongoClient } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeResetDb } from "./closeResetDb";

const { closePrimary } = vi.hoisted(() => ({ closePrimary: vi.fn() }));
vi.mock("../utils/db", () => ({ closeDb: closePrimary }));

describe("reset CLI connection cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closePrimary.mockResolvedValue(undefined);
    global._mongoClientPromise = undefined;
  });
  afterEach(() => {
    global._mongoClientPromise = undefined;
    vi.restoreAllMocks();
  });

  it("closes the application pool opened by nested seed helpers", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    const closeApplication = vi.spyOn(client, "close").mockResolvedValue(undefined);
    global._mongoClientPromise = Promise.resolve(client);

    await closeResetDb();

    expect(closeApplication).toHaveBeenCalledOnce();
    expect(closePrimary).toHaveBeenCalledOnce();
    expect(global._mongoClientPromise).toBeUndefined();
  });

  it("closes the primary when no application pool was opened", async () => {
    await closeResetDb();
    expect(closePrimary).toHaveBeenCalledOnce();
  });

  it("still closes the primary when application cleanup fails", async () => {
    const client = new MongoClient("mongodb://127.0.0.1:27018");
    vi.spyOn(client, "close").mockRejectedValue(new Error("Application cleanup failed"));
    global._mongoClientPromise = Promise.resolve(client);

    await expect(closeResetDb()).rejects.toThrow("Application cleanup failed");

    expect(closePrimary).toHaveBeenCalledOnce();
    expect(global._mongoClientPromise).toBeUndefined();
  });
});
