import type { EventDefinition } from "@/lib/db/types/events";

/**
 * Era-scoped country PREE seed definitions for the 1953–2000 run.
 *
 * Pilot countries: US, UK, RU (USSR), DD (East Germany). Each event is gated
 * to a single country via `requiresCountryIds` and to a historical window via
 * `minYear`/`maxYear` (inclusive, enforced by the engine). Option ids, labels,
 * descriptions, and `defaultOptionId` MUST stay in lockstep with the matching
 * code handlers under `handlers/{us,uk,ru,dd}EraEvents.ts` — the approve
 * route rejects any drift.
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

export const ERA_COUNTRY_SEED_DEFINITIONS: CountryDef[] = [
  // ───────────────────────────── United States ─────────────────────────────
  draft({
    kind: "pree.us.era.suburbiaMortgage",
    image:
      "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=70",
    title: "A House in the Suburbs",
    headline: "A GI-Bill-backed mortgage could put you in a brand-new suburb.",
    body: "The developer's brochure promises a quarter-acre lot, a washing machine, and a monthly payment a working family can carry. The lots on the new street are going fast.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["US"],
    minYear: 1945,
    maxYear: 1970,
    defaultOptionId: "keepRenting",
    options: [
      {
        id: "buyNew",
        label: "Take the mortgage and buy",
        description: "Sign for the new house on the new street.",
      },
      {
        id: "buySmaller",
        label: "Buy a smaller place further out",
        description: "Get on the ladder without stretching.",
      },
      {
        id: "keepRenting",
        label: "Keep renting for now",
        description: "Stay put and watch the market.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.era.loyaltyOath",
    image:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=70",
    title: "The Loyalty Oath",
    headline: "Your employer now requires a signed loyalty oath.",
    body: "A form lands on your desk affirming you have never belonged to subversive organizations. Sign it, or explain yourself to the board.",
    eligibility: ["all"],
    baseWeight: 38,
    requiresCountryIds: ["US"],
    minYear: 1947,
    maxYear: 1960,
    defaultOptionId: "signQuietly",
    options: [
      {
        id: "signQuietly",
        label: "Sign it quietly",
        description: "Sign, file it, and get back to work.",
        isDefault: true,
      },
      {
        id: "signPublicly",
        label: "Sign and affirm it publicly",
        description: "Make a show of your loyalty.",
      },
      {
        id: "refuse",
        label: "Refuse on principle",
        description: "Decline to sign and take the consequences.",
      },
    ],
  }),
  draft({
    kind: "pree.us.era.tailfinCaddy",
    image:
      "https://images.unsplash.com/photo-1552519507-da3b142c6e3d?auto=format&fit=crop&w=1200&q=70",
    title: "Tailfin Temptation",
    headline: "The Cadillac dealer has a new model with tailfins like a jet.",
    body: "Chrome, fins, and a V8 that drinks like a senator. Everyone on the block would see you pull in.",
    eligibility: ["all"],
    baseWeight: 35,
    requiresCountryIds: ["US"],
    minYear: 1950,
    maxYear: 1965,
    defaultOptionId: "keepOldCar",
    options: [
      {
        id: "splurge",
        label: "Splurge on the Cadillac",
        description: "Buy the fins, buy the chrome, buy the stares.",
      },
      {
        id: "buyPractical",
        label: "Buy something practical",
        description: "A sensible sedan at a sensible price.",
      },
      {
        id: "keepOldCar",
        label: "Keep the old car",
        description: "It still runs fine.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.era.sitInCounter",
    image:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=70",
    title: "Sit-In at the Counter",
    headline: "Young people are sitting in at the lunch counter near you.",
    body: "They sit quietly, politely, and refuse to leave until they are served like anyone else. A crowd is gathering outside, and everyone is watching what you do.",
    eligibility: ["all"],
    baseWeight: 30,
    requiresCountryIds: ["US"],
    minYear: 1955,
    maxYear: 1965,
    defaultOptionId: "closeEarly",
    options: [
      {
        id: "serveThem",
        label: "Serve them like anyone else",
        description: "Take their order and their money.",
      },
      {
        id: "joinSitIn",
        label: "Join the sit-in",
        description: "Take a seat beside them.",
      },
      {
        id: "refuseService",
        label: "Refuse service and call for order",
        description: "Stand on the old rules.",
      },
      {
        id: "closeEarly",
        label: "Close early and stay out of it",
        description: "Flip the sign and wait for it to pass.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.era.moonWatchParty",
    image:
      "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?auto=format&fit=crop&w=1200&q=70",
    title: "Moon Landing Night",
    headline: "Tonight, men walk on the Moon, live on television.",
    body: "The whole country will be watching. The neighbors are already asking whose set is biggest and who has the best antenna.",
    eligibility: ["all"],
    baseWeight: 45,
    requiresCountryIds: ["US"],
    minYear: 1969,
    maxYear: 1969,
    defaultOptionId: "watchAlone",
    options: [
      {
        id: "hostTheBlock",
        label: "Host a watch party for the whole block",
        description: "Roll the set into the yard and feed everyone.",
      },
      {
        id: "hostFamily",
        label: "Host a small family gathering",
        description: "Just your own, around the television.",
      },
      {
        id: "watchAlone",
        label: "Watch quietly at home",
        description: "Take it in by yourself.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.us.era.draftLetter",
    image:
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=70",
    title: "Greetings from the President",
    headline: "A draft letter has arrived for your household.",
    body: "The envelope from the Selective Service is thin and official. It orders you, or your son, to report for induction into the armed forces.",
    eligibility: ["all"],
    baseWeight: 35,
    requiresCountryIds: ["US"],
    minYear: 1964,
    maxYear: 1973,
    defaultOptionId: "seekDeferment",
    options: [
      {
        id: "reportForService",
        label: "Report for service",
        description: "Answer the call and go.",
      },
      {
        id: "seekDeferment",
        label: "Seek a deferment",
        description: "Use every lawful channel to delay.",
        isDefault: true,
      },
      {
        id: "speakAgainst",
        label: "Speak out against the war",
        description: "Make your opposition public.",
      },
      {
        id: "burnTheLetter",
        label: "Burn the letter",
        description: "Destroy it and dare them to come.",
      },
    ],
  }),

  // ───────────────────────────── United Kingdom ────────────────────────────
  draft({
    kind: "pree.uk.era.coronationStreetParty",
    image:
      "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1200&q=70",
    title: "Coronation Day",
    headline: "The young Queen is crowned, and the street wants a party.",
    body: "Bunting is going up on every terrace. Someone needs to organize the tables, the sandwiches, and the one television on the street.",
    eligibility: ["all"],
    baseWeight: 45,
    requiresCountryIds: ["UK"],
    minYear: 1953,
    maxYear: 1953,
    defaultOptionId: "watchOnTelly",
    options: [
      {
        id: "organizeIt",
        label: "Organize the street party",
        description: "Clipboards, bunting, and a mountain of sandwiches.",
      },
      {
        id: "chipIn",
        label: "Chip in and lend a hand",
        description: "Bring a table and a trifle.",
      },
      {
        id: "watchOnTelly",
        label: "Watch it quietly on the telly",
        description: "Enjoy the day from your own chair.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.era.rationingEnds",
    image:
      "https://images.unsplash.com/photo-1481391319762-47dff72954d9?auto=format&fit=crop&w=1200&q=70",
    title: "Off the Ration at Last",
    headline: "Sweets and meat are finally coming off ration.",
    body: "After fourteen years, the ration books are closing. The shop around the corner has actual sugar in the window.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    minYear: 1953,
    maxYear: 1954,
    defaultOptionId: "shrugItOff",
    options: [
      {
        id: "celebrateProperly",
        label: "Celebrate properly",
        description: "A joint of meat and sweets for the children.",
      },
      {
        id: "stockUp",
        label: "Stock up while you can",
        description: "Fill the pantry before it all runs out.",
      },
      {
        id: "shrugItOff",
        label: "Shrug it off",
        description: "You've managed this long without.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.era.beatlesTickets",
    image:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=1200&q=70",
    title: "Tickets for the Fab Four",
    headline: "The Beatles are playing a show within reach of you.",
    body: "The whole country has gone mad for them. Tickets are scarce, the queue is around the block, and the touts are circling.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    minYear: 1962,
    maxYear: 1966,
    defaultOptionId: "listenOnWireless",
    options: [
      {
        id: "queueOvernight",
        label: "Queue overnight for tickets",
        description: "Sleep on the pavement like the rest of them.",
      },
      {
        id: "payATout",
        label: "Pay a tout over the odds",
        description: "Money talks, even at a Beatlemania markup.",
      },
      {
        id: "listenOnWireless",
        label: "Listen on the wireless instead",
        description: "Perfectly good from the comfort of home.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.era.minersPicket",
    image:
      "https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=1200&q=70",
    title: "The Picket Line",
    headline: "A miners' picket line has formed at your gates.",
    body: "Men in donkey jackets stand shoulder to shoulder with placards, asking no one to cross. Management wants everyone in as normal. The whole country is arguing about it.",
    eligibility: ["all"],
    baseWeight: 35,
    requiresCountryIds: ["UK"],
    minYear: 1972,
    maxYear: 1985,
    defaultOptionId: "stayHome",
    options: [
      {
        id: "joinPicket",
        label: "Join the picket line",
        description: "Stand with the men at the gate.",
      },
      {
        id: "crossQuietly",
        label: "Cross the line quietly",
        description: "Keep your head down and go to work.",
      },
      {
        id: "supportFromAfar",
        label: "Support the strike fund from afar",
        description: "Send money, keep your distance.",
      },
      {
        id: "stayHome",
        label: "Stay home until it blows over",
        description: "Cross no lines, take no sides.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.uk.era.winterOfDiscontent",
    image:
      "https://images.unsplash.com/photo-1483664852095-d6cc6870702d?auto=format&fit=crop&w=1200&q=70",
    title: "Winter of Discontent",
    headline: "Rubbish piles in the streets and the power keeps cutting.",
    body: "The strikes have bitten hard. Bags of rubbish lean against frozen lampposts, the candles are out on the table, and everyone has an opinion about whose fault it is.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    minYear: 1978,
    maxYear: 1979,
    defaultOptionId: "grumbleQuietly",
    options: [
      {
        id: "muckIn",
        label: "Muck in and help the neighbors",
        description: "Clear the street, check on the old folks.",
      },
      {
        id: "grumbleQuietly",
        label: "Grumble quietly and carry on",
        description: "Light a candle and wait for spring.",
        isDefault: true,
      },
      {
        id: "makeHay",
        label: "Make political hay of the chaos",
        description: "Point loudly at who's to blame.",
      },
    ],
  }),
  draft({
    kind: "pree.uk.era.pollTaxProtest",
    image:
      "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=70",
    title: "The Community Charge Bill",
    headline: "The poll tax demand has landed on your doormat.",
    body: "The community charge bill is the same for the duke and the dustman, and half the country is furious about it. Marches are being organized in every town.",
    eligibility: ["all"],
    baseWeight: 40,
    requiresCountryIds: ["UK"],
    minYear: 1989,
    maxYear: 1990,
    defaultOptionId: "payAndGrumble",
    options: [
      {
        id: "payAndGrumble",
        label: "Pay up and grumble",
        description: "Write the cheque, complain at the pub.",
        isDefault: true,
      },
      {
        id: "joinMarch",
        label: "Join the protest march",
        description: "Take to the streets against the charge.",
      },
      {
        id: "refuseToPay",
        label: "Refuse to pay",
        description: "Can't pay, won't pay.",
      },
    ],
  }),
];

// ───────────────────────────────── USSR ──────────────────────────────────
ERA_COUNTRY_SEED_DEFINITIONS.push(
  draft({
    kind: "pree.ru.era.partyPlenum",
    image:
      "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=70",
    title: "Address to the Plenum",
    headline: "You are invited to address a Party plenum.",
    body: "The hall will be full of obkom secretaries and Moscow eyes. Every word will be weighed, transcribed, and remembered. The cautious survive plenums; occasionally, the bold rise from them.",
    eligibility: ["politician"],
    baseWeight: 35,
    requiresCountryIds: ["RU"],
    minYear: 1953,
    maxYear: 1985,
    defaultOptionId: "declinePolitely",
    options: [
      {
        id: "carefulSpeech",
        label: "Give a careful, orthodox speech",
        description: "Praise the line, name no names, sit down.",
      },
      {
        id: "boldSpeech",
        label: "Give a bold speech",
        description: "Say something that will be talked about.",
      },
      {
        id: "declinePolitely",
        label: "Decline politely",
        description: "Regretfully plead other duties.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.ru.era.dachaAllocation",
    image:
      "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?auto=format&fit=crop&w=1200&q=70",
    title: "A Dacha from the Obkom",
    headline:
      "The obkom, the regional party committee, offers you a dacha from the allocation list.",
    body: "A small wooden house among the birches, a plot for cucumbers, a stove that draws badly. It is a privilege, and privileges are noticed, by those above and those below.",
    eligibility: ["all"],
    baseWeight: 35,
    requiresCountryIds: ["RU"],
    minYear: 1953,
    maxYear: 1985,
    defaultOptionId: "decline",
    options: [
      {
        id: "acceptGratefully",
        label: "Accept gratefully",
        description: "Take the keys and thank the committee.",
      },
      {
        id: "requestBetter",
        label: "Request a better allocation",
        description: "Hint that your service merits more.",
      },
      {
        id: "decline",
        label: "Decline the dacha",
        description: "Say you have no need of it.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.ru.era.sausageQueue",
    image:
      "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=70",
    title: "Word Is the Shop Has Sausage",
    headline: "A neighbor whispers: the shop on the corner has sausage.",
    body: "By the time you hear it, the queue is already around the block and growing. Nobody knows how much there is. Somebody's aunt swears it's real doktorskaya sausage.",
    eligibility: ["all"],
    baseWeight: 42,
    requiresCountryIds: ["RU"],
    minYear: 1953,
    maxYear: 1990,
    defaultOptionId: "skipIt",
    options: [
      {
        id: "queueForHours",
        label: "Join the queue for hours",
        description: "Take your place and hold it.",
      },
      {
        id: "askNeighbor",
        label: "Ask a neighbor to grab you some",
        description: "Owe a small favor.",
      },
      {
        id: "skipIt",
        label: "Skip it",
        description: "There will be other rumors.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.ru.era.samizdatManuscript",
    image:
      "https://images.unsplash.com/photo-1457369804613-52c61a468e7d?auto=format&fit=crop&w=1200&q=70",
    title: "The Typed Manuscript",
    headline: "Someone presses a dog-eared typescript into your hands.",
    body: "Carbon copies, third or fourth generation, the letters barely legible. It is forbidden literature. Merely holding it is a risk; passing it on is a crime; reporting it is a choice you will have to live with.",
    eligibility: ["all"],
    baseWeight: 30,
    requiresCountryIds: ["RU"],
    minYear: 1955,
    maxYear: 1985,
    defaultOptionId: "handItBack",
    options: [
      {
        id: "readAndReturn",
        label: "Read it and return it quietly",
        description: "Satisfy your conscience, keep your silence.",
      },
      {
        id: "passItOn",
        label: "Pass it on to another reader",
        description: "The chain must not break with you.",
      },
      {
        id: "reportIt",
        label: "Report it to the authorities",
        description: "Hand it over and name where it came from.",
      },
      {
        id: "handItBack",
        label: "Hand it back unread",
        description: "You never saw it. It was never here.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.ru.era.cosmonautParade",
    image:
      "https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&w=1200&q=70",
    title: "The Cosmonaut Parade",
    headline: "You are invited onto the podium at the cosmonaut parade.",
    body: "The cosmonauts will wave from the open cars, the crowds will roar, and the cameras will linger on the podium. To be seen there is to matter.",
    eligibility: ["all"],
    baseWeight: 38,
    requiresCountryIds: ["RU"],
    minYear: 1958,
    maxYear: 1970,
    defaultOptionId: "sendRegrets",
    options: [
      {
        id: "attendProudly",
        label: "Attend and be seen proudly",
        description: "Stand tall where the cameras can find you.",
      },
      {
        id: "attendBriefly",
        label: "Attend briefly, keep to the edge",
        description: "Be present without being prominent.",
      },
      {
        id: "sendRegrets",
        label: "Send your regrets",
        description: "Watch it on television like everyone else.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.ru.era.informerApproach",
    image:
      "https://images.unsplash.com/photo-1507925921958-8a62f3d1a50d?auto=format&fit=crop&w=1200&q=70",
    title: "A Quiet Man, A Quiet Request",
    headline:
      "A quiet man from the organs, the secret police, asks you to report on your colleagues.",
    body: "He knows your name, your work, your family. He suggests, gently, that patriotic citizens share what they hear, and that refusal will be remembered just as well as compliance.",
    eligibility: ["all"],
    baseWeight: 30,
    requiresCountryIds: ["RU"],
    minYear: 1953,
    maxYear: 1985,
    defaultOptionId: "giveHarmlessTrivia",
    options: [
      {
        id: "agreeToReport",
        label: "Agree to inform",
        description: "Sign nothing, say yes, start listening.",
      },
      {
        id: "refuseFirmly",
        label: "Refuse firmly",
        description: "Say no, and hope that is the end of it.",
      },
      {
        id: "reportTheApproach",
        label: "Report the approach itself",
        description: "Tell your superiors someone tested you.",
      },
      {
        id: "giveHarmlessTrivia",
        label: "Give harmless trivia only",
        description: "Feed him nothing of consequence, slowly.",
        isDefault: true,
      },
    ],
  }),

  // ───────────────────────────── East Germany ──────────────────────────────
  draft({
    kind: "pree.dd.era.trabantDelivered",
    image:
      "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?auto=format&fit=crop&w=1200&q=70",
    title: "Your Trabant Has Arrived",
    headline: "After years on the waiting list, your Trabant is finally here.",
    body: "The letter came, and now the little two-stroke sits outside in duroplast glory. Half the street is at the window. You could drive it, show it off, or sell it on at a handsome premium.",
    eligibility: ["all"],
    baseWeight: 42,
    requiresCountryIds: ["DD"],
    minYear: 1957,
    maxYear: 1990,
    defaultOptionId: "justDriveIt",
    options: [
      {
        id: "celebrateWithStreet",
        label: "Celebrate with the whole street",
        description: "Give everyone a ride around the block.",
      },
      {
        id: "justDriveIt",
        label: "Just drive it, no fuss",
        description: "It is a car. Cars are for driving.",
        isDefault: true,
      },
      {
        id: "sellItQuietly",
        label: "Sell it quietly at a markup",
        description: "Someone will pay well to skip the queue.",
      },
    ],
  }),
  draft({
    kind: "pree.dd.era.westpaket",
    image:
      "https://images.unsplash.com/photo-1512568400610-62da28bc8a13?auto=format&fit=crop&w=1200&q=70",
    title: "A Package from the West",
    headline: "A Westpaket has arrived from relatives across the border.",
    body: "Real coffee, chocolate, perhaps a pair of jeans, things the Intershop sells for western money you don't have. The neighbors can smell the coffee through the parcel paper.",
    eligibility: ["all"],
    baseWeight: 42,
    requiresCountryIds: ["DD"],
    minYear: 1953,
    maxYear: 1990,
    defaultOptionId: "keepItQuiet",
    options: [
      {
        id: "shareItRound",
        label: "Share it around the building",
        description: "Coffee for everyone, goodwill for you.",
      },
      {
        id: "keepItQuiet",
        label: "Keep it quietly for the family",
        description: "A small taste of the West, behind your own door.",
        isDefault: true,
      },
      {
        id: "sellTheCoffee",
        label: "Sell the coffee and chocolate on",
        description: "West goods fetch good money.",
      },
    ],
  }),
  draft({
    kind: "pree.dd.era.fdjRally",
    image:
      "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=70",
    title: "The FDJ Rally",
    headline: "Your attendance at the FDJ rally is 'expected'.",
    body: "Blue shirts, banners, choreographed enthusiasm for the Free German Youth. Nobody is compelled to go, exactly, but absences are counted, and so are faces.",
    eligibility: ["all"],
    baseWeight: 38,
    requiresCountryIds: ["DD"],
    minYear: 1953,
    maxYear: 1989,
    defaultOptionId: "attendQuietly",
    options: [
      {
        id: "attendEnthusiastically",
        label: "Attend enthusiastically",
        description: "Sing loudly, clap first, be noticed.",
      },
      {
        id: "attendQuietly",
        label: "Attend quietly",
        description: "Be present, be counted, be unremarkable.",
        isDefault: true,
      },
      {
        id: "makeExcuses",
        label: "Make excuses and stay away",
        description: "A sudden headache, a family matter.",
      },
    ],
  }),
  draft({
    kind: "pree.dd.era.borderPermit",
    image:
      "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1200&q=70",
    title: "A Permit to Visit the West",
    headline: "You are considering applying for a rare border-crossing permit.",
    body: "A family occasion in the West might justify a Reiseantrag, a travel permit. Most applications are refused. Some applicants are simply refused, others find the refusal noted, filed, and remembered.",
    eligibility: ["all"],
    baseWeight: 30,
    requiresCountryIds: ["DD"],
    minYear: 1953,
    maxYear: 1989,
    defaultOptionId: "decideAgainst",
    options: [
      {
        id: "applyProperly",
        label: "Apply through proper channels",
        description: "File the paperwork and wait.",
      },
      {
        id: "applyWithConnections",
        label: "Apply using your connections",
        description: "A word in the right ear may help, or be remembered.",
      },
      {
        id: "decideAgainst",
        label: "Decide against applying",
        description: "Some doors are safer left unknocked.",
        isDefault: true,
      },
    ],
  }),
  draft({
    kind: "pree.dd.era.stasiQuestion",
    image:
      "https://images.unsplash.com/photo-1453945619913-79ec89a82c51?auto=format&fit=crop&w=1200&q=70",
    title: "Questions About a Colleague",
    headline: "A Stasi officer is asking questions about a colleague of yours.",
    body: "He is polite. He takes notes. He asks about habits, acquaintances, things said after work. What you tell him will go into a file, and so, one way or another, will what you don't.",
    eligibility: ["all"],
    baseWeight: 30,
    requiresCountryIds: ["DD"],
    minYear: 1953,
    maxYear: 1989,
    defaultOptionId: "deflect",
    options: [
      {
        id: "cooperate",
        label: "Cooperate fully",
        description: "Tell him what he wants to know.",
      },
      {
        id: "deflect",
        label: "Deflect politely",
        description: "Know nothing, remember less.",
        isDefault: true,
      },
      {
        id: "warnColleague",
        label: "Warn the colleague",
        description: "Let them know a file is being opened.",
      },
    ],
  }),
  draft({
    kind: "pree.dd.era.fkkBeach",
    image:
      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=70",
    title: "An Invitation to the FKK Beach",
    headline: "Colleagues invite you along to the FKK bathing beach.",
    body: "Freikörperkultur is practically a national institution, the most ordinary thing in the Republic, and somehow still awkward the first time. The whole office will be there, in a manner of speaking.",
    eligibility: ["all"],
    baseWeight: 38,
    requiresCountryIds: ["DD"],
    minYear: 1953,
    maxYear: 1990,
    defaultOptionId: "declinePolitely",
    options: [
      {
        id: "goAuNaturel",
        label: "Go, and go au naturel",
        description: "When on the FKK beach, do as the FKK beach does.",
      },
      {
        id: "keepKitOn",
        label: "Go, but keep your kit on",
        description: "Sit on the sand fully clothed and own it.",
      },
      {
        id: "declinePolitely",
        label: "Decline politely",
        description: "Perhaps another weekend.",
        isDefault: true,
      },
    ],
  })
);
