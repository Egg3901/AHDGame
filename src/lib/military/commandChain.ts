/**
 * Who the viewer is at a conflict, what they may do there, and who does the rest.
 *
 * Authority over a war is split across three seats and nothing said so. A player asked,
 * in order: "where can I see if I am part of a battle as a general, not SoD?", "where
 * do I assign more troops to the battlefield as SoD?", and "is it user error when I
 * made my division a logistics command?" — three symptoms of one gap.
 *
 * The chain, and the step each question was missing:
 *
 *   1. The DEFENSE HOLDER builds force structure: creates Commands, assigns units to
 *      them, and appoints each Command's Commanding General.
 *   2. The COMMANDING GENERAL of a Command employs it: posts the generals under them
 *      to Conflicts, and designates one as Theater Commander.
 *   3. UNITS FOLLOW THEIR GENERAL. A unit is at whatever front its assigned general is
 *      posted to — `theaterOfUnit`. Nobody moves units to a front directly, which is
 *      why "how do I send more troops" has no button and needs a sentence instead.
 *   4. The THEATER COMMANDER (or the defense holder where none is designated) declares
 *      offensives at the front.
 *
 * Pure. The page resolves the flags; this decides what to say about them.
 */

/** The seat a viewer holds at one conflict, most specific first. */
export type CommandChainRole =
  | "theaterCommander"
  | "postedGeneral"
  | "defenseHolder"
  | "commandingGeneral"
  | "belligerent"
  | "observer";

export interface CommandChainInput {
  /** The side the viewer's country fights on, or null when not a belligerent. */
  ownSide: "A" | "B" | null;
  isDefenseHolder: boolean;
  isCommandingGeneral: boolean;
  isPostedGeneral: boolean;
  isTheaterCommander: boolean;
  isAdmin: boolean;
  /** A resolved war takes no more orders. */
  resolved: boolean;
  /** Whether ANY general is designated Theater Commander here. */
  hasTheaterCommander: boolean;
  /**
   * The sitting Theater Commander's name, when one is designated and known.
   *
   * Who holds a theater is PUBLIC — the designation is an act of state, not a
   * disposition — so every seat, a seatless citizen included, may be told who to
   * ask. Null falls back to naming the office instead of the person.
   */
  theaterCommanderName?: string | null;
}

/** One thing the viewer cannot do here, and where it actually happens. */
export interface ChainHandoff {
  /** The thing they cannot do, phrased as they would ask it. */
  what: string;
  /** Who does it instead. */
  who: string;
  href?: string;
  linkLabel?: string;
}

export interface CommandChainView {
  role: CommandChainRole;
  roleLabel: string;
  /** One line: where the viewer stands in this war. */
  standing: string;
  /** What they may do here. Empty when they are only watching. */
  can: string[];
  /** What they cannot do here, and who does. */
  handoffs: ChainHandoff[];
  /**
   * Why the command surface is absent from THIS seat, or null when the viewer
   * may act. A missing button with no explanation reads as a broken page; this
   * is the sentence that turns it into a rule.
   */
  locked: string | null;
}

const COMMANDS_HREF = "/world/conflicts/combat";
const GENERALS_HREF = "/world/conflicts/generals";

/** How units reach a front. The single most-missed rule, so every belligerent sees it. */
const UNITS_FOLLOW: ChainHandoff = {
  what: "Send more troops to this front",
  who: "Units follow the general they are assigned to — they arrive when that general is posted here. Assign units to a general in your Commands, then have the Commanding General post them.",
  href: COMMANDS_HREF,
  linkLabel: "Your commands",
};

export function resolveCommandChain(input: CommandChainInput): CommandChainView {
  const {
    ownSide,
    isDefenseHolder,
    isCommandingGeneral,
    isPostedGeneral,
    isTheaterCommander,
    isAdmin,
    resolved,
    hasTheaterCommander,
    theaterCommanderName,
  } = input;

  // Not in the war at all. Admins are told they are looking as an admin rather than
  // being handed a role they do not hold in-fiction.
  if (!ownSide) {
    return {
      role: "observer",
      roleLabel: isAdmin ? "Administrator" : "Observer",
      standing: isAdmin
        ? "Your nation is not a belligerent here. You are viewing this front as an administrator."
        : "Your nation is not a belligerent in this conflict. You are reading the public record.",
      can: [],
      handoffs: [],
      locked: isAdmin
        ? null
        : "Your nation is not fighting this war, so nothing at this front is yours to order.",
    };
  }

  // Who declares here: the Theater Commander where one is designated, otherwise
  // the defense holder; never on a resolved war. Deliberately NOT widened for an
  // admin — this decides what the panel CLAIMS the viewer can do, and it has to
  // agree with the page's `canAct`, which no longer escalates for staff either.
  const canDeclare = !resolved && (hasTheaterCommander ? isTheaterCommander : isDefenseHolder);

  // Who holds the theater, named where the name is known. The commander is a
  // player character of unstated gender, so every sentence below refers to them
  // as they/them rather than guessing from a name.
  const tc = hasTheaterCommander
    ? (theaterCommanderName ?? "The Theater Commander designated for this conflict")
    : null;

  const declaresInstead: ChainHandoff = {
    what: "Declare an offensive at this front",
    who: tc
      ? `${tc}, the Theater Commander designated for this conflict.`
      : "The defense secretary, while no Theater Commander is designated here.",
    href: hasTheaterCommander ? GENERALS_HREF : COMMANDS_HREF,
    linkLabel: hasTheaterCommander ? "Who is posted here" : "Your commands",
  };

  // A resolved war takes no orders from anyone; that is a fact about the war, not
  // about the seat, so it is said once here rather than in five variants below.
  const resolvedLock = "This war has resolved. Nothing at this front takes orders any more.";

  if (isTheaterCommander) {
    return {
      role: "theaterCommander",
      roleLabel: "Theater Commander",
      standing: "You command this theater. Battles fought here earn you experience.",
      can: resolved
        ? []
        : [
            "Declare and withdraw offensives at this front.",
            "Direct the generals posted here — you earn a share of what every battle in this theater pays, whether or not you lead units yourself.",
          ],
      handoffs: [UNITS_FOLLOW],
      locked: resolved ? resolvedLock : null,
    };
  }

  if (isPostedGeneral) {
    return {
      role: "postedGeneral",
      roleLabel: "Posted General",
      standing:
        "You are posted to this conflict. The units assigned to you are at this front, and earn you experience when they fight.",
      can: [],
      handoffs: [
        declaresInstead,
        {
          what: "Post yourself somewhere else",
          who: "Your Command's Commanding General decides where its generals serve.",
          href: GENERALS_HREF,
          linkLabel: "Your profile",
        },
      ],
      locked:
        "Nothing at this front is yours to order — not the offensive, not who else stands here, not whether you stay. You hold ground, you take casualties, and you earn experience when your divisions fight. " +
        (tc
          ? `${tc} decides when they attack; your Commanding General decides where you serve.`
          : "No Theater Commander is designated, so the defense secretary decides when they attack; your Commanding General decides where you serve."),
    };
  }

  if (isDefenseHolder) {
    return {
      role: "defenseHolder",
      roleLabel: "Defense Secretary",
      standing: tc
        ? `You own your nation's force structure — its commands, its units, and who leads them. But ${tc} holds this theater, so what happens at this front is their call, not yours.`
        : "You own your nation's force structure — its commands, its units, and who leads them. No Theater Commander is designated here, so the front answers to you directly.",
      can: [
        "Create commands, assign units to them, and appoint each command's Commanding General.",
        ...(canDeclare && !resolved
          ? ["Declare offensives at this front, while no Theater Commander is designated."]
          : []),
      ],
      handoffs: [
        UNITS_FOLLOW,
        ...(canDeclare ? [] : [declaresInstead]),
        {
          what: "Post generals to this conflict",
          who: "Each Command's Commanding General posts the generals under them.",
          href: COMMANDS_HREF,
          linkLabel: "Your commands",
        },
      ],
      locked: canDeclare
        ? null
        : resolved
          ? resolvedLock
          : `${tc} holds this theater, so the declare button is theirs until they are stood down. Force structure is still yours — the units under them, and the command that put them there, remain in your gift.`,
    };
  }

  if (isCommandingGeneral) {
    return {
      role: "commandingGeneral",
      roleLabel: "Commanding General",
      standing:
        "You employ your Command: you decide which of its generals serve at which conflict.",
      can: [
        "Post the generals under your command to this conflict, and designate one as Theater Commander.",
      ],
      handoffs: [
        declaresInstead,
        {
          what: "Assign more units to your command",
          who: "The defense secretary owns force structure and assigns units to commands.",
        },
      ],
      // A Commanding General never declares — but they appoint whoever does, so
      // the note is about the lever they DO hold.
      locked: resolved
        ? resolvedLock
        : tc
          ? `${tc} is Theater Commander here, so offensives are theirs to declare. Your lever is which generals stand at this front — and who among them holds the theater.`
          : "No Theater Commander is designated, so the declare button has fallen back to the defense secretary. Designate one of your posted generals and it moves to them.",
    };
  }

  return {
    role: "belligerent",
    roleLabel: "Citizen",
    standing:
      "Your nation is fighting this war. You hold no seat in its command structure, so you cannot move this line — and you see it the way the newspapers do.",
    can: [],
    handoffs: [
      declaresInstead,
      {
        what: "Take a seat in the command structure",
        who: "Appointment by the head of government, or election.",
      },
    ],
    locked:
      "Nothing here is yours to order, and the force numbers are not yours to see. Territory, engagements, the dead and " +
      (tc ? `who holds the theater (${tc})` : "the vacancy at Theater Command") +
      " are public; who is standing where is not.",
  };
}
