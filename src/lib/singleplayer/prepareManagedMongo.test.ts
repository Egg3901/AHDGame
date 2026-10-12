import { describe, expect, it, vi } from "vitest";
import { initializeLocalReplicaSet } from "./prepareManagedMongo";
const host = "127.0.0.1:27117";
describe("managed singleplayer replica set", () => {
  it("initializes a fresh or previously standalone data directory before serving", async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("not initialized"), { code: 94 }))
      .mockResolvedValueOnce({ ok: 1 })
      .mockResolvedValueOnce({ isWritablePrimary: true, setName: "ahd-local" });
    await initializeLocalReplicaSet({ command }, host);
    expect(command).toHaveBeenNthCalledWith(2, {
      replSetInitiate: { _id: "ahd-local", members: [{ _id: 0, host }] },
    });
  });
  it("preserves an existing single-node replica set", async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ set: "ahd-local", members: [{ name: host }] })
      .mockResolvedValueOnce({ isWritablePrimary: true, setName: "ahd-local" });
    await initializeLocalReplicaSet({ command }, host);
    expect(command).toHaveBeenCalledTimes(2);
  });
  it("accepts a concurrent initializer winning the race", async () => {
    const command = vi
      .fn()
      .mockRejectedValueOnce({ code: 94 })
      .mockRejectedValueOnce({ code: 23 })
      .mockResolvedValueOnce({ isWritablePrimary: true, setName: "ahd-local" });
    await initializeLocalReplicaSet({ command }, host);
  });
  it("refuses unrelated replication configurations without changing them", async () => {
    const command = vi.fn().mockResolvedValue({ set: "other", members: [{ name: host }] });
    await expect(initializeLocalReplicaSet({ command }, host)).rejects.toThrow("configuration");
    expect(command).toHaveBeenCalledOnce();
  });
  it("does not suppress startup failures", async () => {
    const command = vi.fn().mockRejectedValue(new Error("unavailable"));
    await expect(initializeLocalReplicaSet({ command }, host)).rejects.toThrow("unavailable");
  });
});
