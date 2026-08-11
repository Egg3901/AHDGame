import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import { withCorpLock } from "./corpMoneyLock";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("withCorpLock", () => {
  it("serializes same-corp ops in call order (no interleave)", async () => {
    const corp = new ObjectId();
    const order: string[] = [];
    const op = (id: string) =>
      withCorpLock(corp, async () => {
        order.push(`${id}:start`);
        await tick();
        await tick();
        order.push(`${id}:end`);
      });
    await Promise.all([op("A"), op("B"), op("C")]);
    // Each op must fully finish before the next starts.
    expect(order).toEqual(["A:start", "A:end", "B:start", "B:end", "C:start", "C:end"]);
  });

  it("simulates the drop: a read-modify-write race is prevented", async () => {
    const corp = new ObjectId();
    let balance = 100; // shared 'DB' cell mutated via read-then-write
    const rmw = (delta: number) =>
      withCorpLock(corp, async () => {
        const read = balance; // read
        await tick(); // yield — lets the other op run if NOT serialized
        balance = read + delta; // write
      });
    await Promise.all([rmw(50), rmw(25)]);
    expect(balance).toBe(175); // 100 + 50 + 25, nothing lost
  });

  it("runs different corps concurrently", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    let bStartedWhileAHeld = false;
    let aHeld = false;
    const opA = withCorpLock(a, async () => {
      aHeld = true;
      await tick();
      await tick();
      aHeld = false;
    });
    const opB = withCorpLock(b, async () => {
      if (aHeld) bStartedWhileAHeld = true;
    });
    await Promise.all([opA, opB]);
    expect(bStartedWhileAHeld).toBe(true); // b did not wait on a
  });

  it("a rejecting op does not poison the queue", async () => {
    const corp = new ObjectId();
    const order: string[] = [];
    const bad = withCorpLock(corp, async () => {
      order.push("bad");
      throw new Error("boom");
    }).catch(() => order.push("bad-caught"));
    const good = withCorpLock(corp, async () => {
      order.push("good");
    });
    await Promise.all([bad, good]);
    expect(order).toContain("good");
  });

  it("returns fn's resolved value", async () => {
    const corp = new ObjectId();
    await expect(withCorpLock(corp, async () => 42)).resolves.toBe(42);
  });
});
