import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Decade-scoped PREE seed definitions (1950s-1990s, four per decade).
 *
 * Each event is era-gated via `minYear`/`maxYear` (inclusive in-game year
 * bounds, enforced by the PREE weighting filter) so it can only fire inside
 * its own decade, in any preset and any country. Option ids, labels,
 * descriptions, and `defaultOptionId` MUST stay in lockstep with the matching
 * code handler in `handlers/decadeEvents.ts`. The approve route rejects any
 * drift.
 *
 * Outcome tables (positive/negative ranges per option) live in the handlers,
 * not here; this file supplies the player-facing copy and scope only.
 */
type DecadeDef = Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">;

const draft = <T extends Partial<DecadeDef>>(d: T) =>
  ({
    status: "draft",
    version: 1,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    ...d,
  }) as DecadeDef;

export const DECADE_SEED_DEFINITIONS: DecadeDef[] = [
  // ──────────────────────────────── 1950s ─────────────────────────────────
  draft({
    kind: "pree.decade.1950s.duckAndCover",
    image:
      "https://images.unsplash.com/photo-1444653614773-995cb1ef9efa?auto=format&fit=crop&w=1200&q=70",
    title: "Duck and Cover",
    headline: "The civil-defense siren sounds during your workday.",
    body: "A drill, they say, but nobody smiles when they say it. Desks and doorways fill up fast, and someone has to keep the room calm.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1950,
    maxYear: 1959,
    defaultOptionId: "followDrill",
    options: [
      {
        id: "takeCharge",
        label: "Take charge of the room",
        description: "Get everyone under cover and keep order.",
      },
      {
        id: "followDrill",
        label: "Follow the drill quietly",
        description: "Duck, cover, and wait for the all-clear.",
        isDefault: true,
      },
      {
        id: "makeJokes",
        label: "Crack jokes from under the desk",
        description: "Somebody has to lighten the mood.",
      },
      {
        id: "stepOut",
        label: "Step out for a smoke",
        description: "Drills are for the nervous.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1950s.firstTvStation",
    image:
      "https://images.unsplash.com/photo-1593784991095-a205069470b6?auto=format&fit=crop&w=1200&q=70",
    title: "The Town Gets Television",
    headline: "The first TV station in the region just signed on.",
    body: "The appliance store has a console set glowing in the window and a crowd around it every evening. Your neighbors are starting to talk about theirs.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1950,
    maxYear: 1959,
    defaultOptionId: "waitOnIt",
    options: [
      {
        id: "buyConsole",
        label: "Buy the big console set",
        description: "Top of the line, walnut cabinet, rabbit ears included.",
      },
      {
        id: "buyUsed",
        label: "Pick up a secondhand set",
        description: "A smaller table model at half the price.",
      },
      {
        id: "hostNeighbors",
        label: "Buy a set and host the street",
        description: "Your living room becomes the neighborhood theater.",
      },
      {
        id: "waitOnIt",
        label: "Wait for the fad to pass",
        description: "Radio was good enough for the war.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1950s.polioVaccineLine",
    image:
      "https://images.unsplash.com/photo-1576671081837-49000212a370?auto=format&fit=crop&w=1200&q=70",
    title: "The Polio Line",
    headline: "The new polio vaccine has come to town.",
    body: "The line outside the school gym stretches around the block. Parents hold children, volunteers pass out paper cups of water, and everyone remembers last summer's closed swimming pools.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1950,
    maxYear: 1959,
    defaultOptionId: "takeFamily",
    options: [
      {
        id: "lineUpEarly",
        label: "Line up before dawn",
        description: "Be first through the door when the nurses arrive.",
      },
      {
        id: "volunteerHelp",
        label: "Volunteer at the clinic",
        description: "Direct traffic, pass out forms, keep the line moving.",
      },
      {
        id: "takeFamily",
        label: "Take the whole family in line",
        description: "Everyone gets the shot, no fuss.",
        isDefault: true,
      },
      {
        id: "skipIt",
        label: "Skip the line",
        description: "You will get to it eventually. Probably.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1950s.loyaltyHearing",
    image:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=70",
    title: "A Friendly Letter from the Committee",
    headline: "A loyalty committee has summoned you to testify.",
    body: "The letter is polite, mimeographed, and chilling. Names are being named, careers are ending over dinner-party gossip, and the committee wants to know about everyone you have ever stood next to.",
    eligibility: ["politician"],
    baseWeight: 28,
    minYear: 1950,
    maxYear: 1959,
    defaultOptionId: "complyNarrowly",
    options: [
      {
        id: "complyNarrowly",
        label: "Comply, but answer narrowly",
        description: "Give them the minimum and protect your friends.",
        isDefault: true,
      },
      {
        id: "defyCommittee",
        label: "Defy the committee publicly",
        description: "Denounce the whole proceeding as un-American.",
      },
      {
        id: "nameNames",
        label: "Cooperate fully and name names",
        description: "Survive by pointing at others.",
      },
      {
        id: "pleadFifth",
        label: "Invoke your right to silence",
        description: "Take the Fifth and let them make of it what they will.",
      },
    ],
  }),

  // ──────────────────────────────── 1960s ─────────────────────────────────
  draft({
    kind: "pree.decade.1960s.moonshotWatch",
    image:
      "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=1200&q=70",
    title: "Countdown",
    headline: "The whole street is gathering to watch the launch.",
    body: "Someone has rolled a television onto the porch and run an extension cord from the kitchen. In a few minutes a rocket leaves the pad, and for once nobody is talking about anything else.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1960,
    maxYear: 1969,
    defaultOptionId: "watchQuietly",
    options: [
      {
        id: "hostParty",
        label: "Host the watch party",
        description: "Lemonade, folding chairs, the best seat on the block.",
      },
      {
        id: "watchQuietly",
        label: "Watch quietly with everyone",
        description: "Just be there when the engines light.",
        isDefault: true,
      },
      {
        id: "grumbleCost",
        label: "Grumble about the cost of it all",
        description: "All that money, and for what?",
      },
      {
        id: "stayInside",
        label: "Stay inside",
        description: "It will be on the news tonight anyway.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1960s.beatlessTickets",
    image:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=70",
    title: "The Biggest Band in the World",
    headline: "A friend has a line on tickets to the show everyone wants.",
    body: "The band is only in the country for a week, the arena sold out in an afternoon, and scalpers are asking absurd money. Your friend knows a guy.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1960,
    maxYear: 1969,
    defaultOptionId: "listenRadio",
    options: [
      {
        id: "queueOvernight",
        label: "Queue overnight for returns",
        description: "Sleeping bag, thermos, and hope.",
      },
      {
        id: "payScalper",
        label: "Pay the scalper",
        description: "Absurd money for a seat in the rafters.",
      },
      {
        id: "listenRadio",
        label: "Listen to it on the radio",
        description: "The broadcast is free and the kitchen is warm.",
        isDefault: true,
      },
      {
        id: "mockTheFuss",
        label: "Mock the whole fuss",
        description: "Give it a year, nobody will remember them.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1960s.civilRightsMarch",
    image:
      "https://images.unsplash.com/photo-1591628001888-76cc02e0c276?auto=format&fit=crop&w=1200&q=70",
    title: "The March Passes Your Street",
    headline: "A civil-rights march is coming down your road.",
    body: "Singing carries up the block ahead of the banners. Police motorcycles idle at the corner, neighbors come out onto their porches, and the marchers keep a steady, deliberate pace.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1960,
    maxYear: 1969,
    defaultOptionId: "watchFromPorch",
    options: [
      {
        id: "joinMarch",
        label: "Join the march",
        description: "Step off the curb and walk with them.",
      },
      {
        id: "watchFromPorch",
        label: "Watch from the porch",
        description: "Bear witness without choosing a side.",
        isDefault: true,
      },
      {
        id: "offerWater",
        label: "Offer the marchers water",
        description: "Set out a table with a pitcher and paper cups.",
      },
      {
        id: "complainNoise",
        label: "Complain about the disruption",
        description: "Call the precinct about the noise and the traffic.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1960s.falloutShelter",
    image:
      "https://images.unsplash.com/photo-1584467735871-8e4827a4b20d?auto=format&fit=crop&w=1200&q=70",
    title: "Peace of Mind, Underground",
    headline: "A fallout-shelter salesman has your number.",
    body: "He has a glossy brochure, a scale model of a concrete bunker, and a folder of newspaper clippings with very alarming headlines. Two families on the street have already signed.",
    eligibility: ["all"],
    baseWeight: 30,
    minYear: 1960,
    maxYear: 1969,
    defaultOptionId: "politeNo",
    options: [
      {
        id: "buyDeluxe",
        label: "Buy the deluxe model",
        description: "Bunks for six, air filtration, a hand-crank radio.",
      },
      {
        id: "buyBasic",
        label: "Buy the basic unit",
        description: "Concrete, a door, and two weeks of canned goods.",
      },
      {
        id: "takeBrochure",
        label: "Take the brochure and think it over",
        description: "Let him leave the paperwork.",
      },
      {
        id: "politeNo",
        label: "Politely decline",
        description: "You will take your chances with the sky.",
        isDefault: true,
      },
    ],
  }),

  // ──────────────────────────────── 1970s ─────────────────────────────────
  draft({
    kind: "pree.decade.1970s.petrolQueue",
    image:
      "https://images.unsplash.com/photo-1527018601619-a508a2be00cd?auto=format&fit=crop&w=1200&q=70",
    title: "Odd Plates Today",
    headline: "Fuel rationing has you in a three-hour line at the pump.",
    body: "The odd-even rules mean today is your day, along with everyone else whose plates end like yours. The station owner is waving cars forward one at a time and the line is not moving.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1970,
    maxYear: 1979,
    defaultOptionId: "waitItOut",
    options: [
      {
        id: "queueAtDawn",
        label: "Queue before dawn",
        description: "Beat the rush with a thermos and the morning paper.",
      },
      {
        id: "carpoolNeighbor",
        label: "Organize a neighborhood carpool",
        description: "One trip, four passengers, one tank.",
      },
      {
        id: "payPremium",
        label: "Pay a premium at a private pump",
        description: "There is always someone with fuel to sell.",
      },
      {
        id: "waitItOut",
        label: "Wait out the line like everyone else",
        description: "Suffer in good company.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1970s.stagflationShopFloor",
    image:
      "https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?auto=format&fit=crop&w=1200&q=70",
    title: "Prices Up, Wages Flat",
    headline: "The grocery bill keeps climbing and the paycheck does not.",
    body: "At work the talk is all about the cost of everything: meat, gasoline, rent. The foreman says there is no money for raises this year, same as last year.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1970,
    maxYear: 1979,
    defaultOptionId: "tightenBelt",
    options: [
      {
        id: "askRaise",
        label: "Ask for a raise anyway",
        description: "Make the case that your pay buys less every month.",
      },
      {
        id: "tightenBelt",
        label: "Tighten the household belt",
        description: "Meatless Tuesdays and a colder thermostat.",
        isDefault: true,
      },
      {
        id: "sideGig",
        label: "Pick up weekend work",
        description: "A second income to stay ahead of the prices.",
      },
      {
        id: "grumbleLoudly",
        label: "Grumble loudly about the whole mess",
        description: "Everyone is thinking it; say it out loud.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1970s.scandalAcquaintance",
    image:
      "https://images.unsplash.com/photo-1505664194779-8beaceb93744?auto=format&fit=crop&w=1200&q=70",
    title: "A Name in the Transcripts",
    headline: "Someone you know has been dragged into the scandal.",
    body: "The hearings are on television every afternoon, and yesterday a familiar name surfaced in the transcripts. Reporters are asking who else knew, and your phone has started ringing.",
    eligibility: ["politician"],
    baseWeight: 28,
    minYear: 1970,
    maxYear: 1979,
    defaultOptionId: "cooperateInvestigators",
    options: [
      {
        id: "standByThem",
        label: "Stand by them publicly",
        description: "A friend does not run when the subpoenas arrive.",
      },
      {
        id: "distanceYourself",
        label: "Distance yourself carefully",
        description: "A statement about limited contact and full confidence in the process.",
      },
      {
        id: "cooperateInvestigators",
        label: "Cooperate with the investigators",
        description: "Answer their questions and turn over what you have.",
        isDefault: true,
      },
      {
        id: "leakToPress",
        label: "Leak what you know to a reporter",
        description: "Get ahead of the story on your own terms.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1970s.discoNight",
    image:
      "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=70",
    title: "A Night at the Discotheque",
    headline: "Friends drag you to the hottest club in town.",
    body: "Mirror ball, platform shoes, a line around the block. Inside, the bass is a physical force and the dance floor is already crowded past reason.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1970,
    maxYear: 1979,
    defaultOptionId: "leaveEarly",
    options: [
      {
        id: "danceAllNight",
        label: "Dance until the lights come up",
        description: "Commit fully to the floor.",
      },
      {
        id: "buyRound",
        label: "Buy a round for the table",
        description: "Champagne cocktails on you.",
      },
      {
        id: "peopleWatch",
        label: "Hold the table and people-watch",
        description: "Guard the coats and enjoy the show.",
      },
      {
        id: "leaveEarly",
        label: "Slip out before midnight",
        description: "You have an early morning and quiet tastes.",
        isDefault: true,
      },
    ],
  }),

  // ──────────────────────────────── 1980s ─────────────────────────────────
  draft({
    kind: "pree.decade.1980s.homeComputer",
    image:
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=70",
    title: "The Home Computer Question",
    headline: "The electronics shop has home computers on a demo table.",
    body: "A salesman demonstrates a spreadsheet, a word processor, and a game where a frog crosses a road. He swears every home will have one within a decade.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1980,
    maxYear: 1989,
    defaultOptionId: "skipIt",
    options: [
      {
        id: "buyTopLine",
        label: "Buy the top-of-the-line model",
        description: "The full kit: monitor, disk drive, dot-matrix printer.",
      },
      {
        id: "buyBudget",
        label: "Buy the budget model",
        description: "It hooks up to the television and loads from a tape.",
      },
      {
        id: "takeCourse",
        label: "Take an evening computing course first",
        description: "Learn before you spend.",
      },
      {
        id: "skipIt",
        label: "Walk past the demo table",
        description: "A typewriter never needed a disk drive.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1980s.yuppieStockTip",
    image:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=70",
    title: "A Tip at the Wine Bar",
    headline: "A very confident stranger has a very hot stock tip.",
    body: "Braces, a brick-sized mobile phone, and a deal he says is certain: a little firm about to be taken over, and only the wrong people have not bought in yet.",
    eligibility: ["ceo"],
    baseWeight: 25,
    minYear: 1980,
    maxYear: 1989,
    defaultOptionId: "passOnIt",
    options: [
      {
        id: "goAllIn",
        label: "Go all in on the tip",
        description: "Certainty like this does not come twice.",
      },
      {
        id: "smallPosition",
        label: "Take a small position",
        description: "Enough to enjoy it if he is right.",
      },
      {
        id: "reportIt",
        label: "Report the tip to compliance",
        description: "This smells like someone else's information.",
      },
      {
        id: "passOnIt",
        label: "Pass on it",
        description: "Buy your own wine and keep your own counsel.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1980s.benefitConcert",
    image:
      "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=70",
    title: "The Whole World Is Watching",
    headline: "A global benefit concert is on every channel.",
    body: "Stadiums on two continents, a satellite link, and a phone number on the screen all day. Everyone at work will be talking about what they gave on Monday morning.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1980,
    maxYear: 1989,
    defaultOptionId: "justWatch",
    options: [
      {
        id: "donateCampaign",
        label: "Pledge from the campaign account",
        description: "Put the organization's name on a generous pledge.",
      },
      {
        id: "donatePersonal",
        label: "Donate from your own pocket",
        description: "A personal check, no cameras involved.",
      },
      {
        id: "phoneInSmall",
        label: "Phone in a small pledge",
        description: "Join the millions giving what they can.",
      },
      {
        id: "justWatch",
        label: "Just watch the show",
        description: "Enjoy the music; the phones are busy anyway.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1980s.moralCrusade",
    image:
      "https://images.unsplash.com/photo-1485579149621-3123dd979885?auto=format&fit=crop&w=1200&q=70",
    title: "The Crusade Comes to Your Door",
    headline: "A moral-panic campaign wants your public support.",
    body: "A well-organized group with a folding table of alarming exhibits says the nation's children are under siege from video nasties, devilish song lyrics, or both. They want you to sign on to their petition and their hearings.",
    eligibility: ["politician"],
    baseWeight: 28,
    minYear: 1980,
    maxYear: 1989,
    defaultOptionId: "studyIssue",
    options: [
      {
        id: "joinCrusade",
        label: "Join the crusade",
        description: "Sign the petition and headline their hearing.",
      },
      {
        id: "opposeCrusade",
        label: "Oppose it on principle",
        description: "Defend free expression and call it a panic.",
      },
      {
        id: "studyIssue",
        label: "Promise to study the issue",
        description: "Take the exhibits and schedule no hearings.",
        isDefault: true,
      },
      {
        id: "quietDonation",
        label: "Make a quiet donation instead",
        description: "Support the cause without the cameras.",
      },
    ],
  }),

  // ──────────────────────────────── 1990s ─────────────────────────────────
  draft({
    kind: "pree.decade.1990s.dialUpArrives",
    image:
      "https://images.unsplash.com/photo-1531297484001-80022131f5a1?auto=format&fit=crop&w=1200&q=70",
    title: "The Modem Screams",
    headline: "The internet has arrived at your house over the phone line.",
    body: "A setup disc, a modem that screeches like a fax machine in a thunderstorm, and a monthly allotment of hours. Nobody in the house may use the telephone while you are online.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1990,
    maxYear: 1999,
    defaultOptionId: "freeTrial",
    options: [
      {
        id: "signUpNow",
        label: "Sign up for the unlimited plan",
        description: "Go all in on the information superhighway.",
      },
      {
        id: "freeTrial",
        label: "Start with the free trial disc",
        description: "A hundred free hours from the disc in the mail.",
        isDefault: true,
      },
      {
        id: "setUpForKids",
        label: "Set it up mostly for the kids",
        description: "Homework, encyclopedias, and chat rooms you will worry about later.",
      },
      {
        id: "skipIt",
        label: "Leave the disc in the drawer",
        description: "The library has computers if it ever matters.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1990s.superMallOpens",
    image:
      "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=1200&q=70",
    title: "The Mega-Mall Opens",
    headline: "A gigantic mall just opened at the edge of town.",
    body: "Two hundred stores, a food court with its own zip code, and parking for ten thousand cars. Downtown, the hardware store and the dress shop are watching their customers drive past.",
    eligibility: ["all"],
    baseWeight: 40,
    minYear: 1990,
    maxYear: 1999,
    defaultOptionId: "splitDifference",
    options: [
      {
        id: "shopOpeningDay",
        label: "Shop there on opening day",
        description: "Be part of the crowd under the skylights.",
      },
      {
        id: "defendMainStreet",
        label: "Keep shopping on Main Street",
        description: "Spend where the owners know your name.",
      },
      {
        id: "splitDifference",
        label: "Split the difference",
        description: "Mall for the big trips, downtown for the rest.",
        isDefault: true,
      },
      {
        id: "lamentIt",
        label: "Lament the whole thing loudly",
        description: "Tell anyone who will listen what the town is losing.",
      },
    ],
  }),
  draft({
    kind: "pree.decade.1990s.grungeKid",
    image:
      "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=1200&q=70",
    title: "The Kid Goes Grunge",
    headline: "Your kid has discovered flannel and very loud guitar music.",
    body: "The bedroom door now sports a band sticker, the laundry is ninety percent plaid, and something called a mosh pit has been mentioned. The record store clerk apparently knows your kid by name.",
    eligibility: ["all"],
    baseWeight: 35,
    minYear: 1990,
    maxYear: 1999,
    defaultOptionId: "letItRide",
    options: [
      {
        id: "buyGuitar",
        label: "Buy the kid a guitar",
        description: "If there is going to be noise, let it be practiced noise.",
      },
      {
        id: "setCurfew",
        label: "Tighten the rules",
        description: "Earlier curfew, and no more concerts on school nights.",
      },
      {
        id: "listenAlong",
        label: "Ask to hear the albums",
        description: "Sit down and actually listen to the racket.",
      },
      {
        id: "letItRide",
        label: "Let the phase run its course",
        description: "You survived your own haircut at that age.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.decade.1990s.dotComPitch",
    image:
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=70",
    title: "Two Kids and a Pitch Deck",
    headline: "Two twenty-somethings want to pitch you an internet startup.",
    body: "They have matching t-shirts, a name with a missing vowel, and a slide that says the future is not profitable yet but will be enormous. They want your money, or failing that, your blessing.",
    eligibility: ["ceo"],
    baseWeight: 25,
    minYear: 1990,
    maxYear: 1999,
    defaultOptionId: "passPolitely",
    options: [
      {
        id: "investSeed",
        label: "Write the seed check",
        description: "Stake them and take a board seat.",
      },
      {
        id: "acquihire",
        label: "Buy the company for the talent",
        description: "Fold the kids and their servers into your firm.",
      },
      {
        id: "passPolitely",
        label: "Pass, but wish them well",
        description: "Thank them for the pitch and keep your wallet closed.",
        isDefault: true,
      },
      {
        id: "dismissIt",
        label: "Dismiss the whole internet thing",
        description: "Tell the room it is a fad for hobbyists.",
      },
    ],
  }),
];
