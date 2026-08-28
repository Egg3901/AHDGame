/**
 * The record page's derived English: the verdict over a front, how its momentum
 * reads, and the shape of the pending strip.
 *
 * Pure and separate from the component so the wording can be tested without a
 * DOM — these sentences are the page's actual product. Every one of them is a
 * function of state the server already has; none is stored.
 */

export interface VerdictInput {
  /** Side B's share of the host, 0–100. */
  control: number;
  /** Side B's share when the war opened. */
  controlStart: number;
  sideALabel: string;
  sideBLabel: string;
  hostCountry: string;
  /** Battles fought at this front, ever. */
  engagements: number;
  /** Offensives that met nothing, ever. */
  unopposedAdvances: number;
  casualties: number;
  /** Year the war opened, for the opening line. */
  startYear: number;
}

/**
 * One headline sentence about who is winning, and one about how it got there.
 *
 * The detail states MOVEMENT only. Engagement and casualty totals used to be
 * appended here as well, which put both numbers a second time within an inch of
 * the stat tiles that already carry them, and the reader learned nothing from the
 * repeat. The one thing the tiles cannot say is that no engagement has happened
 * yet, so that clause stays.
 */
export function verdictOf(v: VerdictInput): { headline: string; detail: string } {
  const pctB = Math.round(v.control);
  const pctA = 100 - pctB;
  const [lead, share] = pctB >= pctA ? [v.sideBLabel, pctB] : [v.sideALabel, pctA];

  const headline =
    share >= 90
      ? `${lead} has all but taken ${v.hostCountry}.`
      : share >= 75
        ? `${lead} holds three quarters of ${v.hostCountry}.`
        : share >= 60
          ? `${lead} is well ahead in ${v.hostCountry}.`
          : share > 55
            ? `${lead} is ahead in ${v.hostCountry}.`
            : `${v.hostCountry} is split down the middle.`;

  // Movement is stated from the LEADER's side, so the sentence agrees with the
  // headline above it rather than contradicting it with a signed number.
  const movedB = Math.round((v.control - v.controlStart) * 10) / 10;
  const movedForLeader = pctB >= pctA ? movedB : -movedB;
  const movement =
    Math.abs(movedForLeader) < 0.5
      ? `The line has not moved from where it opened in ${v.startYear}.`
      : movedForLeader > 0
        ? `The line has moved ${Math.abs(movedForLeader)} points ${lead === v.sideBLabel ? "toward" : "away from"} ${v.sideBLabel} since ${v.startYear}.`
        : `${lead} has given back ${Math.abs(movedForLeader)} points since ${v.startYear}.`;

  // Only what the stat tiles cannot state. A contested front's engagement count
  // and dead are already up there, so a fought war adds nothing here.
  const cost =
    v.engagements === 0
      ? v.unopposedAdvances > 0
        ? ` ${v.unopposedAdvances} ${plural(v.unopposedAdvances, "offensive")}, none of them contested.`
        : " No shot has been fired at this front."
      : "";

  return { headline, detail: movement + cost };
}

/** The opening line, stated under the control track. */
export function openingLine(v: {
  controlStart: number;
  sideALabel: string;
  sideBLabel: string;
  hostCountry: string;
  hostIsBelligerent: boolean;
  startYear: number;
}): string {
  const b = Math.round(v.controlStart);
  const opened = `opened at ${100 - b} / ${b} in ${v.startYear}`;
  return v.hostIsBelligerent ? opened : `${opened} — ${v.hostCountry} fights on neither side`;
}

/**
 * How the front is moving right now, as a tag and a line.
 *
 * The note states the WINDOW and nothing else. It used to lead with the war's
 * engagement and casualty totals, which the stat tiles and the verdict already
 * carry. Because its ground figure is windowed while the verdict's is
 * measured from the opening, the two sat inches apart quoting different numbers
 * for what read as the same fact. Naming the span is what tells them apart.
 */
export function momentumOf(v: {
  sideALabel: string;
  sideBLabel: string;
  /** Points the front has moved in the momentum window, from side A's side. */
  recentGainA: number;
  /** How many turns the window spans, so the figure is never read as a total. */
  windowTurns: number;
  unopposedAdvances: number;
  /** Turn a side first posted forces here against an unopposed advance, if known. */
  contested: boolean;
}): { tag: string; tagColor: "a" | "b" | "neutral"; note: string } {
  const gain = Math.round(v.recentGainA * 10) / 10;
  const tag =
    Math.abs(gain) < 0.5
      ? "THE LINE HOLDS"
      : gain > 0
        ? `${v.sideALabel.toUpperCase()} ADVANCING`
        : `${v.sideBLabel.toUpperCase()} ADVANCING`;
  const tagColor = Math.abs(gain) < 0.5 ? "neutral" : gain > 0 ? "a" : "b";

  const span = `the last ${v.windowTurns} ${plural(v.windowTurns, "turn")}`;
  const note = !v.contested
    ? `${v.unopposedAdvances} ${plural(v.unopposedAdvances, "offensive")} and no engagement — nothing has stood against this front.`
    : Math.abs(gain) < 0.5
      ? `The line has not moved in ${span}.`
      : `${Math.abs(gain)} points of ground in ${span}.`;

  return { tag, tagColor, note };
}

export function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}
