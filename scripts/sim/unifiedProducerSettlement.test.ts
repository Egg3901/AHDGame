import { describe, expect, it } from "vitest";
import { advanceProducerEconomy } from "../../src/lib/market/producerMarket/production";
import { makeProducerRecipeFixture } from "./fixtures/producerEconomy";

describe("producer recipe trajectories", () => {
  it.each(["1991-default", "2019-default"])(
    "sustains funded %s suppliers across repeated clearing with retained inputs",
    (preset) => {
      const plans = makeProducerRecipeFixture(preset);
      let accounts = [
        ...plans.map((p) => ({ id: p.accountId, cash: 1e6 })),
        { id: "households", cash: 0 },
        { id: "operating-payee", cash: 0 },
      ];
      const output: number[] = [];
      for (let turn = 1; turn <= 48; turn++) {
        const result = advanceProducerEconomy({ turn, accounts, producers: plans });
        output.push(result.producers.reduce((sum, p) => sum + p.producedUnits, 0));
        for (const plan of plans) {
          const settled = result.producers.find((p) => p.id === plan.id)!;
          plan.inputStock = settled.inputStock;
          plan.outputStock = settled.outputStock;
        }
        accounts = result.accounts;
      }
      expect(output[0]).toBeGreaterThan(400);
      expect(output.at(-1)!).toBeGreaterThanOrEqual(output[0] * 0.999999);
    }
  );
});
