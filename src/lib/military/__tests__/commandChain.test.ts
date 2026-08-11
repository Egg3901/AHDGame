import { describe, it, expect } from "vitest";
import { resolveCommandChain, type CommandChainInput } from "../commandChain";

const at = (over: Partial<CommandChainInput> = {}): CommandChainInput => ({
  ownSide: "A",
  isDefenseHolder: false,
  isCommandingGeneral: false,
  isPostedGeneral: false,
  isTheaterCommander: false,
  isAdmin: false,
  resolved: false,
  hasTheaterCommander: false,
  ...over,
});

/**
 * The three questions this exists to answer, asked by a player in one sitting:
 * "where can I see if I am part of a battle as a general, not SoD?", "where do I
 * assign more troops to the battlefield as SoD?", and who declares what.
 */
describe("resolveCommandChain", () => {
  it("tells a non-belligerent they are reading, not commanding", () => {
    const v = resolveCommandChain(at({ ownSide: null }));
    expect(v.role).toBe("observer");
    expect(v.can).toEqual([]);
    expect(v.standing).toMatch(/not a belligerent/i);
  });

  it("names an admin as an admin rather than handing them a seat", () => {
    const v = resolveCommandChain(at({ ownSide: null, isAdmin: true }));
    expect(v.roleLabel).toBe("Administrator");
  });

  // An account flag is not an office. A staff member with no seat in a
  // belligerent nation is a citizen there, and the panel has to say the same
  // thing the page's own `canAct` does — it used to promise a declare button
  // that sat under the sentence "You give no orders at this front".
  it("gives a staff account with no seat at a belligerent nothing to declare", () => {
    const v = resolveCommandChain(at({ ownSide: "A", isAdmin: true }));
    expect(v.role).toBe("belligerent");
    expect(v.can).toEqual([]);
    expect(v.locked).toBeTruthy();
    expect(v.handoffs.some((h) => /declare an offensive/i.test(h.what))).toBe(true);
  });

  // Being staff does not make the defence holder's own authority conditional on
  // it either: with a Theater Commander sitting, the seat is locked out.
  it("does not let staff status override a sitting Theater Commander", () => {
    const v = resolveCommandChain(
      at({ isDefenseHolder: true, isAdmin: true, hasTheaterCommander: true })
    );
    expect(v.can).not.toContain(
      "Declare offensives at this front, while no Theater Commander is designated."
    );
    expect(v.locked).toMatch(/holds this theater/i);
  });

  // The question with no button: units are never moved to a front directly, so the
  // answer has to be a sentence and it has to point somewhere.
  it("always tells a belligerent how troops actually reach the front", () => {
    for (const who of [
      at({ isDefenseHolder: true }),
      at({ isTheaterCommander: true, hasTheaterCommander: true }),
    ]) {
      const v = resolveCommandChain(who);
      const reinforce = v.handoffs.find((h) => /more troops/i.test(h.what));
      expect(reinforce, `no reinforcement handoff for ${v.role}`).toBeTruthy();
      expect(reinforce!.who).toMatch(/follow the general/i);
      expect(reinforce!.href).toBeTruthy();
    }
  });

  it("lets the defense secretary declare only while no theater commander is designated", () => {
    const alone = resolveCommandChain(at({ isDefenseHolder: true }));
    expect(alone.can.some((c) => /declare/i.test(c))).toBe(true);

    const superseded = resolveCommandChain(
      at({ isDefenseHolder: true, hasTheaterCommander: true })
    );
    expect(superseded.can.some((c) => /declare/i.test(c))).toBe(false);
    // ...and says who took it over, rather than the option simply vanishing.
    expect(superseded.handoffs.some((h) => /Theater Commander/i.test(h.who))).toBe(true);
  });

  it("gives the theater commander the orders and says the xp is theirs", () => {
    const v = resolveCommandChain(at({ isTheaterCommander: true, hasTheaterCommander: true }));
    expect(v.role).toBe("theaterCommander");
    expect(v.can.some((c) => /declare/i.test(c))).toBe(true);
    expect(v.can.some((c) => /whether or not you lead units/i.test(c))).toBe(true);
  });

  // "Where can I see if I am part of a battle as a general?" — being posted is the
  // answer, so the panel states it outright.
  it("tells a posted general their units are at this front", () => {
    const v = resolveCommandChain(at({ isPostedGeneral: true }));
    expect(v.role).toBe("postedGeneral");
    expect(v.standing).toMatch(/posted to this conflict/i);
    expect(v.standing).toMatch(/units assigned to you are at this front/i);
  });

  it("points a commanding general at the seat that posts generals — their own", () => {
    const v = resolveCommandChain(at({ isCommandingGeneral: true }));
    expect(v.role).toBe("commandingGeneral");
    expect(v.can.some((c) => /post the generals under your command/i.test(c))).toBe(true);
  });

  // Precedence: the most specific seat wins, so a defense holder who is also posted
  // here reads as the general at the front rather than the minister at a desk.
  it("prefers the most specific seat the viewer holds", () => {
    expect(resolveCommandChain(at({ isDefenseHolder: true, isPostedGeneral: true })).role).toBe(
      "postedGeneral"
    );
    expect(
      resolveCommandChain(
        at({ isPostedGeneral: true, isTheaterCommander: true, hasTheaterCommander: true })
      ).role
    ).toBe("theaterCommander");
  });

  it("offers no orders on a resolved war", () => {
    const v = resolveCommandChain(
      at({ isTheaterCommander: true, hasTheaterCommander: true, resolved: true })
    );
    expect(v.can).toEqual([]);
  });

  it("tells a citizen of a belligerent nation they hold no seat", () => {
    const v = resolveCommandChain(at({}));
    expect(v.role).toBe("belligerent");
    expect(v.can).toEqual([]);
    expect(v.handoffs.length).toBeGreaterThan(0);
  });
});
