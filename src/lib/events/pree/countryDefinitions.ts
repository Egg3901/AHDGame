import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Country-scoped PREE seed definitions (flagship 4: US/UK/JP/DE).
 *
 * Each event is gated to a single country via `requiresCountryIds` and is only
 * offered to characters in that country (see weighting.ts). Option ids, labels,
 * descriptions, and `defaultOptionId` MUST stay in lockstep with the matching
 * code handler under `handlers/{us,uk,jp,de}Events.ts`. The approve route
 * rejects any drift.
 *
 * Outcome tables (positive/negative ranges per option) live in the handlers,
 * not here; this file supplies the player-facing copy and scope only.
 */
type CountryDef = Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">;

const draft = <T extends Partial<CountryDef>>(d: T) =>
  ({
    status: "draft",
    version: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    ...d,
  }) as CountryDef;

export const COUNTRY_SEED_DEFINITIONS: CountryDef[] = [
  // ───────────────────────────── United States ─────────────────────────────
  draft({
    kind: "pree.us.classAction",
    image:
      "https://images.unsplash.com/photo-1715520928476-cd350276d96e?auto=format&fit=crop&w=1200&q=70",
    title: "Class-Action Check",
    headline: "You're a member of a class-action settlement.",
    body: "A notice says you're owed a share of a settlement against a bank's overdraft fees.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["US"],
    defaultOptionId: "ignore",
    options: [
      { id: "cashIt", label: "Cash the check", description: "Collect the settlement now." },
      {
        id: "donate",
        label: "Donate it to a local cause",
        description: "Sign the check over to charity.",
      },
      {
        id: "optOut",
        label: "Opt out to sue individually",
        description: "Roll the dice on your own suit.",
      },
      { id: "ignore", label: "Ignore the notice", description: "Do nothing.", isDefault: true },
    ],
  }),
  // era: a GoFundMe-style crowdfunding campaign "spreading fast" online —
  // crowdfunding ~2010 (GoFundMe founded 2010).
  draft({
    kind: "pree.us.goFundMe",
    minYear: 2010,
    image:
      "https://images.unsplash.com/photo-1597932552386-ad91621e4c8a?auto=format&fit=crop&w=1200&q=70",
    title: "A GoFundMe in Your Name",
    headline: "A viral fundraiser was started on your behalf.",
    body: "Strangers are donating to a campaign citing your hardship. It's spreading fast.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["US"],
    defaultOptionId: "stayQuiet",
    options: [
      {
        id: "accept",
        label: "Accept and thank donors publicly",
        description: "Embrace the fundraiser.",
      },
      {
        id: "charity",
        label: "Redirect the funds to charity",
        description: "Send every dollar onward.",
      },
      {
        id: "shutDown",
        label: "Shut it down as misinformation",
        description: "Disavow the fundraiser.",
      },
      {
        id: "stayQuiet",
        label: "Stay quiet",
        description: "Let it run its course.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.secComment",
    image:
      "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=1200&q=70",
    title: "SEC Comment Letter",
    headline: "The SEC is questioning your latest filing.",
    body: "A comment letter challenges revenue recognition in your last 10-Q.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["US"],
    defaultOptionId: "ignore",
    options: [
      { id: "refile", label: "Refile and cooperate", description: "Open the books to the SEC." },
      {
        id: "contest",
        label: "Lawyer up and contest",
        description: "Fight every line of the letter.",
      },
      {
        id: "restate",
        label: "Quietly restate earnings",
        description: "Issue a correction and move on.",
      },
      { id: "ignore", label: "Ignore the letter", description: "File it away.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.us.plantClosure",
    image:
      "https://images.unsplash.com/photo-1497015455546-1da71faf8d06?auto=format&fit=crop&w=1200&q=70",
    title: "Rust Belt Plant Vote",
    headline: "Investors want you to offshore a Midwest plant.",
    body: "Activist shareholders are pushing to move the plant overseas. The union and a local senator are both watching.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["US"],
    defaultOptionId: "defer",
    options: [
      {
        id: "keepOpen",
        label: "Keep it open, invest locally",
        description: "Bet on the Midwest plant.",
      },
      { id: "offshore", label: "Offshore for margins", description: "Move the jobs overseas." },
      {
        id: "negotiate",
        label: "Negotiate concessions with the union",
        description: "Find a middle path.",
      },
      {
        id: "defer",
        label: "Defer the decision",
        description: "Kick it down the road.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.filibuster",
    image:
      "https://images.unsplash.com/photo-1611010638643-051de75362ff?auto=format&fit=crop&w=1200&q=70",
    title: "Filibuster Showdown",
    headline: "A bill you back is being filibustered.",
    body: "Leadership wants you to force an all-night floor session to break it.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["US"],
    defaultOptionId: "noStance",
    options: [
      { id: "lead", label: "Lead the floor fight", description: "Hold the floor all night." },
      { id: "compromise", label: "Cut a quiet compromise", description: "Deal behind the scenes." },
      { id: "sitOut", label: "Sit it out", description: "Stay off the floor." },
      {
        id: "noStance",
        label: "Take no public stance",
        description: "Say nothing.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.primetimeTownHall",
    image:
      "https://images.unsplash.com/photo-1770097320291-08fc5ba9f7d7?auto=format&fit=crop&w=1200&q=70",
    title: "Primetime Cable Town Hall",
    headline: "A network offers you a live primetime town hall.",
    body: "National audience, live questions, in your district. High risk, high reward.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["US"],
    defaultOptionId: "decline",
    options: [
      {
        id: "live",
        label: "Do it live, unscripted",
        description: "Take questions on national TV.",
      },
      { id: "scripted", label: "Tightly scripted appearance", description: "Stay on message." },
      { id: "surrogate", label: "Send a surrogate", description: "Let a deputy take it." },
      { id: "decline", label: "Decline", description: "Pass on the invite.", isDefault: true },
    ],
  }),

  // ───────────────────────────── United Kingdom ────────────────────────────
  // era: ULEZ-style clean-air zone expansion — London ULEZ introduced 2019.
  draft({
    kind: "pree.uk.ulez",
    minYear: 2019,
    image:
      "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=70",
    title: "Clean-Air Zone Expansion",
    headline: "An emissions zone just expanded to your street.",
    body: "Your older car now incurs a daily charge to drive in your own neighbourhood.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    defaultOptionId: "ignore",
    options: [
      {
        id: "scrapEv",
        label: "Scrap it and go electric",
        description: "Trade up to a compliant car.",
      },
      {
        id: "payCharge",
        label: "Pay the daily charge",
        description: "Keep the old car, eat the cost.",
      },
      { id: "protest", label: "Join the local protest", description: "Rally against the zone." },
      {
        id: "ignore",
        label: "Ignore the fines",
        description: "Let the penalty notices pile up.",
        isDefault: true,
      },
    ],
  }),
  // era: registering the pub as an "Asset of Community Value" — mechanism
  // created by the Localism Act 2011, in force 2012.
  draft({
    kind: "pree.uk.pubBuyout",
    minYear: 2012,
    image:
      "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?auto=format&fit=crop&w=1200&q=70",
    title: "Save the Local",
    headline: "The last pub in your area is closing.",
    body: "Locals want to register it as an Asset of Community Value and buy it out.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    defaultOptionId: "stayOut",
    options: [
      {
        id: "leadBuyout",
        label: "Lead the community buyout",
        description: "Register it and rally the village.",
      },
      { id: "chipIn", label: "Chip in quietly", description: "Add a modest stake." },
      { id: "letGo", label: "Let the developers have it", description: "Back the redevelopment." },
      { id: "stayOut", label: "Stay out of it", description: "Not your fight.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.uk.cmaProbe",
    image:
      "https://images.unsplash.com/photo-1526129318478-62ed807ebdf9?auto=format&fit=crop&w=1200&q=70",
    title: "CMA Market Inquiry",
    headline: "The Competition and Markets Authority is investigating your sector.",
    body: "The CMA has opened an inquiry into pricing across your market.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["UK"],
    defaultOptionId: "stonewall",
    options: [
      {
        id: "cooperate",
        label: "Cooperate and offer remedies",
        description: "Give the CMA what it wants.",
      },
      { id: "fight", label: "Fight it through the courts", description: "Challenge the inquiry." },
      {
        id: "cutPrices",
        label: "Pre-emptively cut prices",
        description: "Disarm the probe with lower prices.",
      },
      {
        id: "stonewall",
        label: "Stonewall the regulator",
        description: "Concede nothing.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.selectCommittee",
    image:
      "https://images.unsplash.com/photo-1607778102165-6a418ee9adf2?auto=format&fit=crop&w=1200&q=70",
    title: "Select Committee Grilling",
    headline: "A Commons select committee has summoned you.",
    body: "You'll answer for your firm's prices and profits on live television.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["UK"],
    defaultOptionId: "deputy",
    options: [
      {
        id: "contrition",
        label: "Show contrition, offer a price freeze",
        description: "Take the humble route on camera.",
      },
      { id: "defend", label: "Defend profits robustly", description: "No apology, all numbers." },
      {
        id: "blame",
        label: "Blame energy and supply costs",
        description: "Point at the wider market.",
      },
      {
        id: "deputy",
        label: "Send your deputy instead",
        description: "Skip the hearing.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.pmqs",
    image:
      "https://images.unsplash.com/photo-1607778413290-6bc9b4cf30f1?auto=format&fit=crop&w=1200&q=70",
    title: "PMQs Moment",
    headline: "You have a slot at Prime Minister's Questions.",
    body: "The chamber is packed and the cameras are live. Whatever you do will be the clip.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["UK"],
    defaultOptionId: "silent",
    options: [
      {
        id: "soundbite",
        label: "Go for the killer soundbite",
        description: "Swing for the dispatch box.",
      },
      {
        id: "sober",
        label: "Sober, policy-heavy question",
        description: "Gravitas over theatrics.",
      },
      {
        id: "yield",
        label: "Yield your slot to a colleague",
        description: "Bank some party goodwill.",
      },
      {
        id: "silent",
        label: "Stay silent on the benches",
        description: "Sit it out.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.threeLineWhip",
    image:
      "https://images.unsplash.com/photo-1610026378085-15d0e8f685db?auto=format&fit=crop&w=1200&q=70",
    title: "Three-Line Whip",
    headline: "The whips demand you vote the party line.",
    body: "The bill is one your constituents hate, and the whips are watching.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["UK"],
    defaultOptionId: "miss",
    options: [
      { id: "rebel", label: "Rebel and vote your conscience", description: "Defy the whips." },
      { id: "toeLine", label: "Toe the line", description: "Vote with the party." },
      { id: "abstain", label: "Abstain and duck the vote", description: "Sit on the fence." },
      {
        id: "miss",
        label: 'Miss the vote "by accident"',
        description: "Be conveniently absent.",
        isDefault: true,
      },
    ],
  }),

  draft({
    kind: "pree.uk.nhsWaitingList",
    image:
      "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=1200&q=70",
    title: "NHS Waiting List",
    headline: "Your local trust's waiting list is in the papers.",
    body: "Elective care delays are biting. Constituents want someone to own it.",
    eligibility: ["all"],
    baseWeight: 36,
    requiresCountryIds: ["UK"],
    defaultOptionId: "grumble",
    options: [
      {
        id: "campaign",
        label: "Campaign for the local trust",
        description: "Push for more theatre slots and staff.",
      },
      {
        id: "goPrivate",
        label: "Go private yourself",
        description: "Skip the queue with a private clinic.",
      },
      {
        id: "grumble",
        label: "Grumble and wait",
        description: "Join the queue like everyone else.",
        isDefault: true,
      },
      {
        id: "blameGov",
        label: "Blame the government loudly",
        description: "Make it a political story.",
      },
    ],
  }),
  draft({
    kind: "pree.uk.councilTaxBill",
    image:
      "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=70",
    title: "Council Tax Band Hike",
    headline: "Your council tax bill just jumped a band.",
    body: "The annual demand lands heavier than expected. Neighbours are furious.",
    eligibility: ["all"],
    baseWeight: 36,
    requiresCountryIds: ["UK"],
    defaultOptionId: "pay",
    options: [
      {
        id: "pay",
        label: "Pay in full",
        description: "Settle the band hike and move on.",
        isDefault: true,
      },
      {
        id: "challenge",
        label: "Challenge the banding",
        description: "Appeal to the valuation tribunal.",
      },
      {
        id: "rally",
        label: "Join the freeze campaign",
        description: "Back a local anti-hike petition.",
      },
      { id: "ignore", label: "Ignore the reminders", description: "Hope it goes away." },
    ],
  }),
  draft({
    kind: "pree.uk.railStrike",
    image:
      "https://images.unsplash.com/photo-1474487548417-781cb71495f3?auto=format&fit=crop&w=1200&q=70",
    title: "Rail Strike Week",
    headline: "National rail industrial action is disrupting your commute.",
    body: "Replacement buses, cancelled meetings, and a very public row about pay.",
    eligibility: ["all"],
    baseWeight: 32,
    requiresCountryIds: ["UK"],
    defaultOptionId: "endure",
    options: [
      {
        id: "supportStrike",
        label: "Support the strikers",
        description: "Stand with the unions publicly.",
      },
      {
        id: "condemn",
        label: "Condemn the disruption",
        description: "Side with frustrated passengers.",
      },
      {
        id: "workRemote",
        label: "Work around it",
        description: "Remote days and alternative routes.",
      },
      {
        id: "endure",
        label: "Grin and bear the chaos",
        description: "Queue for replacement buses.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.bbcInterview",
    image:
      "https://images.unsplash.com/photo-1585829365295-ab7cd400c167?auto=format&fit=crop&w=1200&q=70",
    title: "BBC Sofa Booking",
    headline: "The BBC wants you on Today or Newsnight.",
    body: "A live grilling is on offer. Decline and they'll empty-chair you.",
    eligibility: ["politician", "ceo"],
    baseWeight: 26,
    requiresCountryIds: ["UK"],
    defaultOptionId: "decline",
    options: [
      {
        id: "live",
        label: "Do it live on Today / Newsnight",
        description: "Take the hard questions.",
      },
      {
        id: "preRecord",
        label: "Insist on a pre-record",
        description: "Control the cut.",
      },
      { id: "surrogate", label: "Send a surrogate", description: "Let a deputy take it." },
      {
        id: "decline",
        label: "Decline the booking",
        description: "Stay off the sofa.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.partyConference",
    image:
      "https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=1200&q=70",
    title: "Party Conference",
    headline: "Conference season has arrived.",
    body: "Fringe speeches, loyalty tests, and the chance to make or break your standing.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["UK"],
    defaultOptionId: "skip",
    options: [
      {
        id: "fringeSpeech",
        label: "Give a barnstorming fringe speech",
        description: "Make your own weather.",
      },
      {
        id: "loyal",
        label: "Clap the leader on cue",
        description: "Be a loyal foot-soldier.",
      },
      {
        id: "rebelFringe",
        label: "Host a rebel fringe",
        description: "Challenge the leadership line.",
      },
      {
        id: "skip",
        label: "Skip conference",
        description: "Stay in the constituency.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.borderForce",
    image:
      "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=70",
    title: "Border Force Row",
    headline: "Channel crossings are dominating the news.",
    body: "Everyone wants a line, deterrence, safer routes, or business visas.",
    eligibility: ["politician", "ceo"],
    baseWeight: 26,
    requiresCountryIds: ["UK"],
    defaultOptionId: "quiet",
    options: [
      {
        id: "harden",
        label: "Call for a harder line",
        description: "Push deterrence and returns.",
      },
      {
        id: "humane",
        label: "Call for safer routes",
        description: "Stress legal pathways and rescue.",
      },
      {
        id: "businessVisas",
        label: "Focus on business visas",
        description: "Keep talent flowing for firms.",
      },
      {
        id: "quiet",
        label: "Stay quiet",
        description: "Let the Home Office take the heat.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.assetOfCommunityValue",
    image:
      "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1200&q=70",
    title: "Asset of Community Value",
    headline: "The local library or post office is under threat.",
    body: "Residents want it listed and bought out before developers move in.",
    eligibility: ["all"],
    baseWeight: 34,
    requiresCountryIds: ["UK"],
    defaultOptionId: "stayOut",
    options: [
      {
        id: "lead",
        label: "Lead the community bid",
        description: "Save the library or post office.",
      },
      { id: "donate", label: "Donate quietly", description: "Chip in without the megaphone." },
      {
        id: "redevelop",
        label: "Back redevelopment",
        description: "Side with the commercial plan.",
      },
      { id: "stayOut", label: "Stay out of it", description: "Not your fight.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.uk.lordsReception",
    image:
      "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=70",
    title: "Lords Reception",
    headline: "You're invited to a House of Lords reception.",
    body: "Soft patronage, crossbench chats, and photo opportunities in ermine-adjacent company.",
    eligibility: ["politician"],
    baseWeight: 22,
    requiresCountryIds: ["UK"],
    defaultOptionId: "skip",
    options: [
      {
        id: "workRoom",
        label: "Work the room",
        description: "Collect soft patronage and introductions.",
      },
      {
        id: "policyChat",
        label: "Corner a crossbencher on policy",
        description: "Talk substance, not gossip.",
      },
      {
        id: "photoOp",
        label: "Chase the photo op",
        description: "Be seen with the right ermine.",
      },
      {
        id: "skip",
        label: "Skip the reception",
        description: "Stay in the Commons tearoom.",
        isDefault: true,
      },
    ],
  }),

  // ──────────────────────────────── Japan ──────────────────────────────────
  // era: furusato nōzei (hometown tax) scheme introduced 2008.
  draft({
    kind: "pree.jp.furusatoNozei",
    minYear: 2008,
    image:
      "https://images.unsplash.com/photo-1513407030348-c983a97b98d8?auto=format&fit=crop&w=1200&q=70",
    title: "Furusato Nōzei Decision",
    headline: "It's hometown-tax season.",
    body: "You can redirect part of your tax to a region of your choice and receive local gifts in return.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["JP"],
    defaultOptionId: "skip",
    options: [
      {
        id: "hometown",
        label: "Donate to your struggling hometown",
        description: "Send your hometown-tax there.",
      },
      {
        id: "gifts",
        label: "Chase the best gift returns",
        description: "Optimise for the regional gifts.",
      },
      {
        id: "disaster",
        label: "Give to a disaster-hit prefecture",
        description: "Direct it where it's needed most.",
      },
      { id: "skip", label: "Skip it this year", description: "Do nothing.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.jp.bosaiDrill",
    image:
      "https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=70",
    title: "Disaster Drill",
    headline: "A real tremor hits during your neighborhood's earthquake drill.",
    body: "The annual preparedness drill is interrupted by a genuine quake.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["JP"],
    defaultOptionId: "skip",
    options: [
      {
        id: "takeCharge",
        label: "Take charge and help neighbors",
        description: "Lead when the tremor hits.",
      },
      {
        id: "follow",
        label: "Quietly follow instructions",
        description: "Do your part without fuss.",
      },
      { id: "slipAway", label: "Slip away early", description: "Duck out of the drill." },
      {
        id: "skip",
        label: "Skip the drill entirely",
        description: "Don't show up.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.jp.keiretsu",
    image:
      "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=1200&q=70",
    title: "Keiretsu Bailout Request",
    headline: "An affiliated firm expects you to step in.",
    body: "A failing member of your keiretsu wants a rescue via cross-shareholding.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["JP"],
    defaultOptionId: "mainBank",
    options: [
      {
        id: "bailout",
        label: "Bail them out for group harmony",
        description: "Step in via cross-shareholding.",
      },
      { id: "cutTies", label: "Refuse and cut ties", description: "Let the affiliate fail." },
      {
        id: "restructure",
        label: "Restructure them under your terms",
        description: "Absorb the affiliate on your terms.",
      },
      {
        id: "mainBank",
        label: "Defer to the main bank",
        description: "Let the lead bank decide.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.jp.sokaiya",
    image:
      "https://images.unsplash.com/photo-1604928141064-207cea6f571f?auto=format&fit=crop&w=1200&q=70",
    title: "Sōkaiya at the AGM",
    headline: "Corporate racketeers threaten your shareholders' meeting.",
    body: "Sōkaiya are demanding a payoff to keep the AGM quiet.",
    eligibility: ["ceo"],
    baseWeight: 20,
    requiresCountryIds: ["JP"],
    defaultOptionId: "hope",
    options: [
      { id: "police", label: "Refuse and call the police", description: "Report the racketeers." },
      { id: "payoff", label: "Quietly pay them off", description: "Make the problem disappear." },
      {
        id: "handlers",
        label: "Hire professional meeting-handlers",
        description: "Bring in specialists for the AGM.",
      },
      {
        id: "hope",
        label: "Hope they don't show",
        description: "Do nothing and pray.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.jp.koenkai",
    image:
      "https://images.unsplash.com/photo-1526481280693-3bfa7568e0f3?auto=format&fit=crop&w=1200&q=70",
    title: "Kōenkai Banquet",
    headline: "Your support association is throwing a banquet.",
    body: "Your personal kōenkai expects you to deliver for the faithful.",
    eligibility: ["politician"],
    baseWeight: 35,
    requiresCountryIds: ["JP"],
    defaultOptionId: "skip",
    options: [
      {
        id: "headline",
        label: "Headline it generously",
        description: "Be the main draw and spend.",
      },
      { id: "attend", label: "Attend modestly", description: "Show your face, keep it lean." },
      {
        id: "video",
        label: "Send a video and a gift",
        description: "Skip in person, send warmth.",
      },
      { id: "skip", label: "Skip it", description: "Don't attend.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.jp.nhkDebate",
    image:
      "https://images.unsplash.com/photo-1480796927426-f609979314bd?auto=format&fit=crop&w=1200&q=70",
    title: "NHK Sunday Debate",
    headline: "NHK invites you to its Sunday political debate.",
    body: "The public broadcaster's panel reaches the whole country.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["JP"],
    defaultOptionId: "decline",
    options: [
      {
        id: "bold",
        label: "Take a bold policy stance",
        description: "Stake out clear ground on air.",
      },
      {
        id: "safe",
        label: "Play it safe and statesmanlike",
        description: "Calm, broad, reassuring.",
      },
      {
        id: "talkingPoints",
        label: "Send talking points, skip the seat",
        description: "Provide a statement, don't appear.",
      },
      { id: "decline", label: "Decline", description: "Pass on the invitation.", isDefault: true },
    ],
  }),

  // ─────────────────────────────── Germany ─────────────────────────────────
  // era: the "film" option is to "film it and post it ... pull out the
  // phone" — smartphone filming/posting ~2008.
  draft({
    kind: "pree.de.autobahnAccident",
    minYear: 2008,
    image:
      "https://images.unsplash.com/photo-1593115057322-e94b77572f20?auto=format&fit=crop&w=1200&q=70",
    title: "Autobahn Pile-Up",
    headline: "You're first on the scene of a serious crash.",
    body: "On a derestricted stretch of Autobahn, a bad accident unfolds in front of you.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["DE"],
    defaultOptionId: "drive",
    options: [
      { id: "renderAid", label: "Stop and render aid", description: "First on scene, you help." },
      {
        id: "callIn",
        label: "Call it in and drive on",
        description: "Alert the authorities, keep moving.",
      },
      { id: "film", label: "Film it and post it", description: "Pull out the phone." },
      { id: "drive", label: "Keep driving", description: "Don't get involved.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.de.schrebergarten",
    image:
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=1200&q=70",
    title: "Allotment Dispute",
    headline: "Your allotment association is feuding over your garden.",
    body: "The Schrebergarten committee says your plot is 'non-conforming'.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["DE"],
    defaultOptionId: "ignore",
    options: [
      { id: "comply", label: "Comply with the rules", description: "Bring the plot into line." },
      {
        id: "fight",
        label: "Fight it at the members' meeting",
        description: "Make your case to the association.",
      },
      { id: "giveUp", label: "Give up the plot", description: "Walk away from it." },
      {
        id: "ignore",
        label: "Ignore the letters",
        description: "Let the dispute fester.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.de.kartellamt",
    image:
      "https://images.unsplash.com/photo-1636652966850-5ac4d02370e9?auto=format&fit=crop&w=1200&q=70",
    title: "Bundeskartellamt Probe",
    headline: "The Federal Cartel Office is investigating your firm.",
    body: "The Bundeskartellamt suspects abuse of market dominance.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["DE"],
    defaultOptionId: "stonewall",
    options: [
      {
        id: "settle",
        label: "Settle with binding commitments",
        description: "Give the Cartel Office certainty.",
      },
      { id: "litigate", label: "Litigate to the end", description: "Fight the dominance case." },
      {
        id: "spinOff",
        label: "Spin off the contested unit",
        description: "Divest to defuse the probe.",
      },
      {
        id: "stonewall",
        label: "Stonewall",
        description: "Give the regulator nothing.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.de.factoryRestructure",
    image:
      "https://images.unsplash.com/photo-1649709253652-5aa6623ca4cc?auto=format&fit=crop&w=1200&q=70",
    title: "Factory Restructuring Vote",
    headline: "Your works council opposes a planned restructuring.",
    body: "The works council and the union are resisting cuts under co-determination rules.",
    eligibility: ["ceo"],
    baseWeight: 22,
    requiresCountryIds: ["DE"],
    defaultOptionId: "stall",
    options: [
      {
        id: "socialPlan",
        label: "Negotiate a social plan",
        description: "Cut a deal with the works council.",
      },
      {
        id: "pushThrough",
        label: "Push restructuring through regardless",
        description: "Override the works council.",
      },
      {
        id: "profitShare",
        label: "Offer profit-sharing instead of cuts",
        description: "Trade cuts for a stake in the upside.",
      },
      { id: "stall", label: "Stall negotiations", description: "Play for time.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.de.bundestagSpeech",
    image:
      "https://images.unsplash.com/photo-1603644448048-28a7e5122f0a?auto=format&fit=crop&w=1200&q=70",
    title: "Bundestag Debate Speech",
    headline: "You have a marquee speaking slot in the Bundestag.",
    body: "A heated debate, a full chamber, and the cameras rolling.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["DE"],
    defaultOptionId: "yield",
    options: [
      {
        id: "fiery",
        label: "Deliver a fiery, partisan speech",
        description: "Rally your side, hammer theirs.",
      },
      {
        id: "reachAcross",
        label: "Reach across the aisle",
        description: "Strike a consensual, grand-coalition tone.",
      },
      {
        id: "partyLine",
        label: "Read a cautious party-line text",
        description: "Safe, scripted, on-message.",
      },
      { id: "yield", label: "Yield your time", description: "Give up the slot.", isDefault: true },
    ],
  }),
  draft({
    kind: "pree.de.talkshow",
    image:
      "https://images.unsplash.com/photo-1717386255773-1e3037c81788?auto=format&fit=crop&w=1200&q=70",
    title: "Primetime Talk Show",
    headline: "A Sunday-night talk show invites you onto the panel.",
    body: "An ARD/ZDF primetime panel, broadcast to the nation.",
    eligibility: ["politician"],
    baseWeight: 28,
    requiresCountryIds: ["DE"],
    defaultOptionId: "decline",
    options: [
      {
        id: "combative",
        label: "Engage combatively with rivals",
        description: "Take the fight to the panel.",
      },
      {
        id: "reasonable",
        label: "Be the reasonable voice",
        description: "Calm, credible, above the fray.",
      },
      {
        id: "onMessage",
        label: "Stay narrowly on-message",
        description: "Repeat the lines, take no risks.",
      },
      {
        id: "decline",
        label: "Decline the invitation",
        description: "Skip the panel.",
        isDefault: true,
      },
    ],
  }),
];
