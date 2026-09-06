import { describe, it, expect } from "vitest";
import { resolvePvpBattle, type BattleSide } from "../battle";
import { side } from "./battleFixtures";

/**
 * `sustain` used to be one side-wide number applied to every unit's casualties, so a
 * coalition partner's rear echelon sheltered your frontline divisions. On the German
 * front that handed side B roughly a quarter off its whole line because the Soviet air
 * force was parked behind it, while side A had two airlift wings and got almost nothing.
 *
 * Measured over 400 seeds in scripts/sim/coalitionCasualtyShare.ts, an ally holding a
 * large rear echelon cut American deaths by 31.2% before this and by 8.2% after, the
 * remainder being the legitimate force-ratio effect of having an ally at all.
 */
const SEEDS = Array.from({ length: 120 }, (_, i) => i * 7919 + 13);

/** The same contingent, but every formation explicitly held in the rear. */
function heldBack(s: BattleSide): BattleSide {
  for (const u of s.units) s.positions[String(u._id)] = "rear";
  return s;
}

/** That contingent's own dead, averaged per battle. */
function lossOf(country: string, attackers: BattleSide[], defenders: BattleSide[]): number {
  let total = 0;
  for (const seed of SEEDS) {
    const r = resolvePvpBattle(attackers, defenders, "afghan", seed);
    for (const c of [...(r.attacker.contingents ?? []), ...(r.defender.contingents ?? [])]) {
      if (c.country === country) total += c.loss;
    }
  }
  return total / SEEDS.length;
}

const twelve = () => Array.from({ length: 12 }, () => 92);
const enemy = () => [side("DD", "B", twelve(), "afghan")];

describe("sustain is a property of a contingent's own tail", () => {
  it("an ally's rear echelon does not shelter your frontline", () => {
    const alone = lossOf("US", [side("US", "A", twelve(), "afghan")], enemy());
    const withAlly = lossOf(
      "US",
      [
        side("US", "A", twelve(), "afghan"),
        heldBack(
          side(
            "FR",
            "A",
            Array.from({ length: 40 }, () => 92),
            "afghan"
          )
        ),
      ],
      enemy()
    );
    // The US force is byte-identical in both runs. Some discount is legitimate: the ally
    // adds combat value even at an engagement factor of 0.10, which improves the odds and
    // lowers everyone's intensity. On these fixtures that residual is -21.1%. The
    // side-wide sustain term took it to -40.8%, and that is what this locks out.
    //
    // The threshold sits between the two measured values rather than at either, so a
    // fixture tweak does not flip the test while a return of side-wide sustain does.
    const discount = (withAlly - alone) / alone;
    expect(discount).toBeGreaterThan(-0.3);
  });

  it("a nation's own rear echelon still shelters its own line", () => {
    // The other half of the rule: scoping sustain to the contingent must not delete the
    // mechanic. Holding your own reserve back has to keep protecting your own troops.
    const bare = lossOf("US", [side("US", "A", twelve(), "afghan")], enemy());
    const withOwnTail = (() => {
      const s = side("US", "A", [...twelve(), ...Array.from({ length: 40 }, () => 92)], "afghan");
      for (const u of s.units.slice(12)) s.positions[String(u._id)] = "rear";
      return lossOf("US", [s], enemy());
    })();
    // Fewer dead per division in the line, even though the reported total now also
    // carries the rear echelon's own losses.
    expect(withOwnTail).toBeLessThan(bare);
  });
});
