import type { GovernanceStyleScore } from "./score";

export interface GovernanceStyleFlavor {
  headline: string;
  institutionalNarrative: string;
  politicalHeadline: string;
  politicalNarrative: string;
  institutionalSigns: readonly [string, string, string];
  competitionNarrative: string | null;
}

const HEALTH_FLAVOR = [
  {
    max: 20,
    headline: "Institutions in Name Only",
    narrative:
      "The constitution still hangs on the wall, but power increasingly travels around it. Courts wait for signals, watchdogs lose their teeth, and public offices become rewards for loyalty. Elections may continue, yet fewer people believe that losing office will actually loosen anyone's grip on the state.",
    signs: [
      "Independent offices are absorbed into the governing machine.",
      "Rules are enforced selectively and appeals rarely constrain power.",
      "Public services retreat as informal networks replace the state.",
    ] as const,
  },
  {
    max: 40,
    headline: "The Hollowing Republic",
    narrative:
      "Democratic forms remain recognizable while their habits fade. Oversight becomes negotiation, appointments become tests of loyalty, and each exceptional shortcut makes the next one easier. Opposition can still win, but it must push against institutions that increasingly lean toward those already in command.",
    signs: [
      "Legislative scrutiny weakens and emergency procedure becomes routine.",
      "Civil servants learn to anticipate political wishes before rules are spoken.",
      "Voters can remove leaders, but no longer trust the field to be level.",
    ] as const,
  },
  {
    max: 60,
    headline: "Democracy Under Strain",
    narrative:
      "The system still corrects itself, but only after friction. Courts rule, elections matter, and administrations change hands, yet scandals linger and reforms arrive unevenly. Every crisis tests whether temporary expedients will be surrendered once the danger passes.",
    signs: [
      "Institutional checks work, though slowly and inconsistently.",
      "Public trust depends heavily on performance and recent scandals.",
      "Peaceful alternation is credible but no longer taken for granted.",
    ] as const,
  },
  {
    max: 80,
    headline: "Living Institutions",
    narrative:
      "Government is constrained by institutions that still possess a life of their own. Officials expect scrutiny, courts can embarrass the powerful, and electoral defeat carries a real transfer of authority. The system bends under pressure without teaching every actor that rules are optional.",
    signs: [
      "Professional administration survives changes of government.",
      "Opposition parties retain practical routes back into power.",
      "Scandals damage incumbents without discrediting the whole state.",
    ] as const,
  },
  {
    max: 101,
    headline: "Democratic Renewal",
    narrative:
      "Institutions reproduce trust through ordinary use. Governments expect to lose someday, opposition leaders expect to govern someday, and both behave accordingly. Courts, elections, legislatures, and the civil service reinforce one another instead of depending on a single virtuous leader.",
    signs: [
      "Transfers of power are routine rather than existential contests.",
      "Independent institutions can resist both popular and elite pressure.",
      "Reform strengthens the rules future opponents will inherit.",
    ] as const,
  },
] as const;

const DIRECTION_FLAVOR = [
  {
    max: 20,
    headline: "Transformative Left",
    narrative:
      "The state is being used to redistribute power, protect labor, and make social provision a public guarantee. Its promise is broad security and equal standing; its danger is that urgency can turn independent institutions into instruments of a permanent governing project.",
  },
  {
    max: 47,
    headline: "Social Consensus",
    narrative:
      "Public provision, organized labor, and managed markets set the political center of gravity. Change is usually pursued through durable institutions, with the central argument focused on how much solidarity the state can sustain without becoming rigid.",
  },
  {
    max: 53.01,
    headline: "Civic Balance",
    narrative:
      "Neither side has captured the national settlement. Governments bargain across inherited institutions, combining public guarantees with market discipline and accepting that durable reform usually requires a coalition broader than the cabinet itself.",
  },
  {
    max: 80,
    headline: "Conservative Consensus",
    narrative:
      "Property, market coordination, social continuity, and executive competence shape the governing mood. Its promise is stability and institutional restraint; its danger is that established interests can become indistinguishable from the institutions meant to regulate them.",
  },
  {
    max: 101,
    headline: "Restorative Right",
    narrative:
      "The government seeks a decisive restoration of hierarchy, market authority, and traditional order. It can clear institutional paralysis, but prolonged success risks defining dissent as obstruction and treating neutral offices as obstacles to the popular mandate.",
  },
] as const;

export function governanceStyleFlavor(score: GovernanceStyleScore): GovernanceStyleFlavor {
  const health = HEALTH_FLAVOR.find((entry) => score.democraticHealth.value < entry.max)!;
  const direction = DIRECTION_FLAVOR.find((entry) => score.leftRight.value < entry.max)!;
  const competition = score.competition;
  let competitionNarrative: string | null = null;
  if (competition && competition.dominantSeatShare > 0) {
    const chamberScope =
      competition.chambersMeasured === 1
        ? "in the elected chamber"
        : `across ${competition.chambersMeasured} elected chambers`;
    const executiveStatus =
      competition.executiveAlignedWithLegislature === true
        ? ` The same party also holds the presidency through ${competition.consecutiveExecutiveTerms} consecutive ${competition.consecutiveExecutiveTerms === 1 ? "term" : "terms"}, joining legislative dominance to continuity in government.`
        : competition.executiveAlignedWithLegislature === false
          ? " The presidency is held by a rival party, so divided government interrupts the continuity of the legislative bloc."
          : competition.uninterruptedControlTurns > 0
            ? ` Its uninterrupted legislative lead has lasted ${competition.uninterruptedControlTurns} turns.`
            : "";
    competitionNarrative =
      competition.penalty > 0
        ? `One party averages ${competition.dominantSeatShare.toFixed(1)}% control ${chamberScope}.${executiveStatus} As the same governing settlement endures, oversight, appointments, and administrative habits begin to assume that power will not change hands. Chamber margins subtract ${competition.seatMarginPenalty.toFixed(1)} points, legislative continuity subtracts ${competition.legislativeContinuityPenalty.toFixed(1)}, and executive continuity subtracts ${competition.executiveContinuityPenalty.toFixed(1)}, for a total democratic-health penalty of ${competition.penalty.toFixed(1)}.`
        : `The largest party averages ${competition.dominantSeatShare.toFixed(1)}% control ${chamberScope}.${executiveStatus} Power remains electorally contestable. Opposition offices retain a credible path back into government, appointments are made under the expectation of future scrutiny, and competitive balance applies no health penalty.`;
  }
  return {
    headline: health.headline,
    institutionalNarrative: health.narrative,
    politicalHeadline: direction.headline,
    politicalNarrative: direction.narrative,
    institutionalSigns: health.signs,
    competitionNarrative,
  };
}
