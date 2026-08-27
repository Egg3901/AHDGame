import type { EventDefinition } from "@/lib/db/types/events";
import type { CountryId } from "@/lib/constants/countries";

/**
 * World Events v1 Phase 0 seed catalog — proof-of-spine only. Spread into
 * `PREE_SEED_DEFINITIONS` so the existing `POST /api/admin/events/pree/seed`
 * route and `approve-all` flow cover it without a new endpoint.
 */
export const WORLD_EVENT_SEED_DEFINITIONS: Omit<
  EventDefinition,
  "_id" | "createdAt" | "updatedAt"
>[] = [
  {
    kind: "worldEvents.sportsVictory",
    status: "draft",
    version: 1,
    title: "National Sports Victory",
    headline: "The national team has won a major international title.",
    body: "Celebrations are breaking out nationwide. No decision is required — this is a wire-only morale event.",
    eligibility: ["all"],
    baseWeight: 10,
    cooldownTurnsMin: 6,
    cooldownTurnsMax: 16,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "National celebration",
        description: "The nation celebrates the win.",
        isDefault: true,
      },
    ],
    // World Events v1 Phase 1: given a schedule too, so the sports-victory
    // proof event also exercises the window scheduler in addition to
    // remaining admin-triggerable (schedule presence doesn't disable the
    // Phase 0 trigger-country route).
    schedule: { kind: "window", minGapTurns: 6, maxGapTurns: 16 },
  },
  {
    kind: "worldEvents.papalVisit",
    status: "draft",
    version: 1,
    title: "Papal Visit",
    headline: "A papal visit has been announced.",
    body: "The visit is being arranged as a state occasion. No decision is required — this is a wire-only morale event.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 20,
    cooldownTurnsMax: 40,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "State reception",
        description: "The nation hosts the visit.",
        isDefault: true,
      },
    ],
    // Plan calls for gating to high-Catholic-share countries "if demographic
    // data supports it, else all countries" — no religious-demographic field
    // exists (verified by grep), so this ships ungated per the fallback.
    schedule: { kind: "window", minGapTurns: 20, maxGapTurns: 40 },
  },
  {
    kind: "worldEvents.royalEvent",
    status: "draft",
    version: 1,
    title: "Royal Event",
    headline: "A royal occasion is drawing national attention.",
    body: "The nation is marking a jubilee, wedding, or funeral. No decision is required — this is a wire-only morale event with a small tourism-sector demand bump.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 24,
    cooldownTurnsMax: 48,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "National celebration",
        description: "The nation marks the occasion.",
        isDefault: true,
      },
    ],
    // UK-gated per plan §4.
    requiresCountryIds: ["UK"] as CountryId[],
    schedule: { kind: "window", minGapTurns: 24, maxGapTurns: 48 },
  },
  {
    kind: "worldEvents.ukBudgetDay",
    status: "draft",
    version: 1,
    title: "Budget Day",
    headline: "The Chancellor is about to deliver the Budget.",
    body: "Red boxes, OBR forecasts, and a packed chamber. How the government plays Budget Day shapes the week's narrative.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 20,
    cooldownTurnsMax: 36,
    deciderRole: "executive",
    defaultOptionId: "steady",
    options: [
      {
        id: "steady",
        label: "Deliver a steady Budget",
        description: "Stick to the fiscal orthodoxy and take the applause politely.",
        isDefault: true,
      },
      {
        id: "giveaway",
        label: "Splash the cash",
        description: "Announce popular giveaways and hope the gilt market forgives you.",
      },
      {
        id: "austerity",
        label: "Tighten the purse strings",
        description: "Lean into cuts and fiscal hairshirt politics.",
      },
      {
        id: "uturn",
        label: "U-turn after the OBR leak",
        description: "Walk back a measure mid-afternoon and wear the credibility hit.",
      },
    ],
    requiresCountryIds: ["UK"] as CountryId[],
    schedule: { kind: "window", minGapTurns: 20, maxGapTurns: 36 },
  },
  {
    kind: "worldEvents.ukNhsWinter",
    status: "draft",
    version: 1,
    title: "NHS Winter Pressure",
    headline: "Winter has arrived and the NHS is under strain.",
    body: "Ambulance queues, corridor care, and cancelled electives dominate the bulletins.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 16,
    cooldownTurnsMax: 32,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "Acknowledge the winter crisis",
        description: "Promise surge capacity and thank staff.",
        isDefault: true,
      },
      {
        id: "surge",
        label: "Announce an emergency surge package",
        description: "Throw money and beds at the problem.",
      },
      {
        id: "shrug",
        label: "Call it seasonal and move on",
        description: "Downplay the crisis.",
      },
    ],
    requiresCountryIds: ["UK"] as CountryId[],
    schedule: { kind: "window", minGapTurns: 16, maxGapTurns: 32 },
  },
  {
    kind: "worldEvents.ukBbcCharter",
    status: "draft",
    version: 1,
    title: "BBC Charter Skirmish",
    headline: "Another row over the BBC charter and licence fee.",
    body: "Culture-war clips meet funding arithmetic. The government must pick a line.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 24,
    cooldownTurnsMax: 48,
    deciderRole: "executive",
    defaultOptionId: "steady",
    options: [
      {
        id: "steady",
        label: "Defend the charter settlement",
        description: "Keep the licence fee and editorial independence line.",
        isDefault: true,
      },
      {
        id: "reform",
        label: "Open a reform review",
        description: "Threaten funding changes and governance tweaks.",
      },
      {
        id: "clash",
        label: "Pick a public fight with the Director-General",
        description: "Escalate into a culture-war clip fight.",
      },
    ],
    requiresCountryIds: ["UK"] as CountryId[],
    schedule: { kind: "window", minGapTurns: 24, maxGapTurns: 48 },
  },
  // World Events v1 Phase 2: executive decision events. Unlike the Phase 0/1
  // flavor events above, these carry real multi-option decisions — no
  // primaryStat roll (plan §2.2, country events skip that branch entirely),
  // outcomes are option-deterministic. Every `defaultOptionId` here is the
  // safe/neutral option (plan §7 — vacant-executive timeout must never be
  // treasury-negative).
  {
    kind: "worldEvents.stateVisit",
    status: "draft",
    version: 1,
    title: "State Visit",
    headline: "A foreign head of state has requested a state visit.",
    body: "The executive must decide how to host the visiting delegation.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 8,
    cooldownTurnsMax: 20,
    deciderRole: "executive",
    defaultOptionId: "standard",
    options: [
      { id: "lavish", label: "Host lavishly", description: "A full state occasion." },
      {
        id: "standard",
        label: "Host standard reception",
        description: "A normal diplomatic reception.",
        isDefault: true,
      },
      { id: "decline", label: "Decline the visit", description: "Politely decline to host." },
    ],
    schedule: { kind: "window", minGapTurns: 8, maxGapTurns: 20 },
  },
  {
    kind: "worldEvents.intlSummit",
    status: "draft",
    version: 1,
    title: "International Summit",
    headline: "An international summit is convening.",
    body: "The executive must decide what stance to take at the summit.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 10,
    cooldownTurnsMax: 24,
    deciderRole: "executive",
    defaultOptionId: "moderate",
    options: [
      {
        id: "assertive",
        label: "Take an assertive stance",
        description: "Push hard for national interests.",
      },
      {
        id: "moderate",
        label: "Take a moderate stance",
        description: "Seek consensus without rocking the boat.",
        isDefault: true,
      },
      {
        id: "conciliatory",
        label: "Take a conciliatory stance",
        description: "Prioritize cooperation and trade goodwill.",
      },
    ],
    schedule: { kind: "window", minGapTurns: 10, maxGapTurns: 24 },
  },
  {
    kind: "worldEvents.scientificBreakthrough",
    status: "draft",
    version: 1,
    title: "Scientific Breakthrough",
    headline: "Researchers have announced a major scientific breakthrough.",
    body: "The executive must decide whether to fund commercialization.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 12,
    cooldownTurnsMax: 30,
    deciderRole: "executive",
    defaultOptionId: "decline",
    options: [
      {
        id: "fund",
        label: "Fund commercialization",
        description: "Commit federal funds to commercialize the breakthrough.",
      },
      {
        id: "decline",
        label: "Decline to fund",
        description: "Let the private sector pursue commercialization on its own.",
        isDefault: true,
      },
    ],
    schedule: { kind: "window", minGapTurns: 12, maxGapTurns: 30 },
  },
  // World Events v1 Phase 3: Olympics/worlds-fair, rewritten to the same
  // simple no-decision flavor-event pattern as sports-victory/papal-visit/
  // royal-event above (per user feedback — Olympics is just one example of
  // an admin-triggerable/scheduled flavor event, not a player-facing
  // bidding simulator). Deliberately NO `schedule` field here: host
  // selection (which single country hosts a given cycle) is a global,
  // turn-keyed decision, not a per-country one, so it can't be expressed by
  // the generic per-country Phase 1 scheduler
  // (`worldEvents/driver.ts`'s `offerScheduledEventForCountry`, which only
  // considers `schedule: { $exists: true }` definitions and would otherwise
  // offer the same "host" event to every active country independently).
  // Cadence + deterministic host selection is instead driven directly by
  // `worldEvents/driver.ts`'s `offerGlobalHostCountryEvent` helper, which
  // then offers this definition to the one selected host country exactly
  // like any other country-scope event — no escrow, no bidding, no cycle
  // document, no award-stage turn phase.
  {
    kind: "worldEvents.olympics",
    status: "draft",
    version: 1,
    title: "Olympics",
    headline: "The Olympic Games are coming to a host nation.",
    body: "The nation prepares to host the Olympic Games. No decision is required — this is a wire-only flavor event with a temporary construction/tourism demand bump.",
    eligibility: ["all"],
    baseWeight: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "Host the Games",
        description: "The nation hosts the Olympic Games.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "worldEvents.worldsFair",
    status: "draft",
    version: 1,
    title: "World's Fair",
    headline: "The World's Fair is coming to a host nation.",
    body: "The nation prepares to host the World's Fair. No decision is required — this is a wire-only flavor event with a small temporary demand bump.",
    eligibility: ["all"],
    baseWeight: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    deciderRole: "executive",
    defaultOptionId: "acknowledge",
    options: [
      {
        id: "acknowledge",
        label: "Host the Fair",
        description: "The nation hosts the World's Fair.",
        isDefault: true,
      },
    ],
  },
  // Era-gated Cold War world events. Same executive-decision pattern as the
  // Phase 2 events above, plus `minYear`/`maxYear` era bounds (enforced by
  // the world-events scheduler) and superpower/bloc `requiresCountryIds`
  // gating. Schedule windows are tuned so each fires roughly 1-3 times
  // within its era window (48 turns = 1 year). Every `defaultOptionId` is
  // the safe/neutral option (plan §7 — vacant-executive timeout must never
  // be treasury-negative).
  {
    kind: "worldEvents.sputnikMoment",
    status: "draft",
    version: 1,
    title: "Sputnik Moment",
    headline: "A satellite triumph stuns the world.",
    body: "The successful satellite launch has captured global attention. The executive must decide how to frame the achievement.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 96,
    cooldownTurnsMax: 200,
    deciderRole: "executive",
    defaultOptionId: "downplay",
    options: [
      {
        id: "propaganda",
        label: "Maximum propaganda",
        description: "Trumpet the launch as proof of the system's superiority.",
      },
      {
        id: "scientific",
        label: "Sober scientific framing",
        description: "Present the launch as a measured scientific achievement.",
      },
      {
        id: "downplay",
        label: "Downplay militarily",
        description: "Stress the peaceful nature of the program and move on.",
        isDefault: true,
      },
    ],
    requiresCountryIds: ["RU"] as CountryId[],
    minYear: 1955,
    maxYear: 1962,
    schedule: { kind: "window", minGapTurns: 96, maxGapTurns: 200 },
  },
  {
    kind: "worldEvents.berlinCrisis",
    status: "draft",
    version: 1,
    title: "Berlin Crisis",
    headline: "The refugee exodus through the open sector border is becoming unbearable.",
    body: "Thousands are crossing to the West through Berlin each month. The executive must decide how to stop the bleed.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 150,
    cooldownTurnsMax: 300,
    deciderRole: "executive",
    defaultOptionId: "moscow",
    options: [
      {
        id: "seal",
        label: "Seal the border",
        description: "Close the sector border and end the exodus by force.",
      },
      {
        id: "conciliate",
        label: "Conciliate and seek talks",
        description: "Ease conditions at home and propose negotiations over the city's status.",
      },
      {
        id: "moscow",
        label: "Request Moscow's guidance",
        description: "Defer to Moscow for direction on handling the crisis.",
        isDefault: true,
      },
    ],
    requiresCountryIds: ["DD"] as CountryId[],
    minYear: 1958,
    maxYear: 1962,
    schedule: { kind: "window", minGapTurns: 150, maxGapTurns: 300 },
  },
  {
    kind: "worldEvents.spaceRaceMilestone",
    status: "draft",
    version: 1,
    title: "Space Race Milestone",
    headline: "A chance to beat the rival superpower to the next space milestone.",
    body: "The next great space milestone is within reach. The executive must decide how hard to push the program.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 150,
    cooldownTurnsMax: 300,
    deciderRole: "executive",
    defaultOptionId: "cede",
    options: [
      {
        id: "crash",
        label: "Fund the crash program",
        description: "Pour resources into an all-out effort to seize the milestone first.",
      },
      {
        id: "steady",
        label: "Steady funding",
        description: "Continue the program at a measured, sustainable pace.",
      },
      {
        id: "cede",
        label: "Cede the milestone",
        description: "Let the rival take this one and conserve resources.",
        isDefault: true,
      },
    ],
    requiresCountryIds: ["US", "RU"] as CountryId[],
    minYear: 1957,
    maxYear: 1975,
    schedule: { kind: "window", minGapTurns: 150, maxGapTurns: 300 },
  },
  {
    kind: "worldEvents.oilEmbargoShock",
    status: "draft",
    version: 1,
    title: "Oil Embargo Shock",
    headline: "An oil embargo has sent prices spiking and queues forming.",
    body: "Fuel prices are soaring and lines at filling stations stretch for blocks. The executive must decide how to respond.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 150,
    cooldownTurnsMax: 288,
    deciderRole: "executive",
    defaultOptionId: "ride",
    options: [
      {
        id: "controls",
        label: "Impose price controls",
        description: "Cap fuel prices by decree to shield consumers from the spike.",
      },
      {
        id: "reserve",
        label: "Release the strategic reserve",
        description: "Spend down strategic stockpiles to ease the shortage.",
      },
      {
        id: "ride",
        label: "Ride it out",
        description: "Let the market absorb the shock without intervention.",
        isDefault: true,
      },
    ],
    minYear: 1973,
    maxYear: 1979,
    schedule: { kind: "window", minGapTurns: 150, maxGapTurns: 288 },
  },
  {
    kind: "worldEvents.detenteOverture",
    status: "draft",
    version: 1,
    title: "Détente Overture",
    headline: "A back-channel summit offer has arrived from the rival superpower.",
    body: "Through quiet intermediaries, the rival superpower has proposed a leadership summit. The executive must decide how to respond.",
    eligibility: ["all"],
    baseWeight: 8,
    cooldownTurnsMin: 200,
    cooldownTurnsMax: 350,
    deciderRole: "executive",
    defaultOptionId: "decline",
    options: [
      {
        id: "summit",
        label: "Pursue the summit",
        description: "Accept the overture and prepare for a leadership summit.",
      },
      {
        id: "concessions",
        label: "Demand concessions first",
        description: "Publicly insist on concrete concessions before any summit.",
      },
      {
        id: "decline",
        label: "Decline quietly",
        description: "Politely let the overture lapse without public comment.",
        isDefault: true,
      },
    ],
    requiresCountryIds: ["US", "RU"] as CountryId[],
    minYear: 1969,
    maxYear: 1979,
    schedule: { kind: "window", minGapTurns: 200, maxGapTurns: 350 },
  },
];
