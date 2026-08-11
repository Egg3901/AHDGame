import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { EventDefinition } from "@/lib/db/types/events";
import { getEventDefinitionsCollection } from "@/lib/db/collections/eventDefinitions";
import { COUNTRY_SEED_DEFINITIONS } from "./countryDefinitions";
import { GLOBAL_SEED_DEFINITIONS_PART1 } from "./globalSeedDefinitions1";
import { WORLD_EVENT_SEED_DEFINITIONS } from "@/lib/events/worldEvents/definitions";
import { ERA_COUNTERPART_DEFINITIONS } from "./eraCounterpartDefinitions";
import { DECADE_SEED_DEFINITIONS } from "./decadeDefinitions";
import { ERA_COUNTRY_SEED_DEFINITIONS } from "./eraCountryDefinitions";
import { BROADCAST_SEED_DEFINITIONS } from "./broadcastDefinitions";

const GLOBAL_SEED_DEFINITIONS: Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">[] = [
  ...GLOBAL_SEED_DEFINITIONS_PART1,
  {
    kind: "pree.boardroomUltimatum",
    image:
      "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Boardroom Ultimatum",
    headline: "Minority shareholders threaten a proxy campaign",
    body: "A coordinated bloc of minority investors has issued an ultimatum: reduce insider concentration below 70% or they will mount a public proxy campaign targeting your position as CEO.",
    eligibility: ["ceoVeryConcentrated"],
    baseWeight: 5,
    cooldownTurnsMin: 24,
    cooldownTurnsMax: 40,
    defaultOptionId: "ignore",
    options: [
      {
        id: "sell",
        label: "Offer to sell shares",
        description: "Signal willingness to dilute your position voluntarily.",
      },
      {
        id: "bluff",
        label: "Call their bluff",
        description: "Dare them to follow through on the proxy threat.",
      },
      {
        id: "ignore",
        label: "Ignore the ultimatum",
        description: "Say nothing and wait for them to act.",
        isDefault: true,
      },
    ],
  },
  // ─── 20 new everyday events (no em-dashes, grounded flavor) ───────────────
  {
    kind: "pree.lostWallet",
    image:
      "https://images.unsplash.com/photo-1587330979470-3595ac045ab0?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Lost Wallet",
    headline: "A stuffed wallet is sitting on the sidewalk in front of you.",
    body: "Cards, a wad of cash, and a name you don't recognize. The street is quiet.",
    eligibility: ["all"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "leaveIt",
    options: [
      {
        id: "turnIn",
        label: "Track down the owner and return it",
        description: "Find the name on the cards and hand it back.",
      },
      {
        id: "takeCash",
        label: "Keep the cash, ditch the wallet",
        description: "Pocket the bills and drop the rest in a bin.",
      },
      {
        id: "dropAtStation",
        label: "Drop it at the police station",
        description: "Hand it in and let them sort it out.",
      },
      {
        id: "leaveIt",
        label: "Leave it where it is",
        description: "Not your problem.",
        isDefault: true,
      },
    ],
  },
  // era: the reunion is organized via "a Facebook group" — social media ~2005.
  {
    kind: "pree.highSchoolReunion",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1527525443983-6e60c75fff46?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "High School Reunion",
    headline: "Your class reunion is coming up and the organizer tracked you down.",
    body: "An RSVP card and a Facebook group full of people you haven't seen in years.",
    eligibility: ["all"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "rsvpYes", label: "RSVP and go", description: "Book the trip and show your face." },
      {
        id: "sendRegrets",
        label: "Send polite regrets",
        description: "A warm note saying you can't make it.",
      },
      {
        id: "sendProxy",
        label: "Send a video message",
        description: "Record a greeting for the organizers to play.",
      },
      {
        id: "ignore",
        label: "Toss the invite",
        description: "Don't reply at all.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.fenceDispute",
    image:
      "https://images.unsplash.com/photo-1533929736458-ca588d08c8be?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Fence Dispute",
    headline: "Your neighbor says your new fence is on their property line.",
    body: "They've sent a measured drawing and a pointed note. The fence went in last month.",
    eligibility: ["all"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "surveyIt",
        label: "Hire a surveyor",
        description: "Settle the property line with a real map.",
      },
      {
        id: "negotiate",
        label: "Talk it out over the fence",
        description: "Work it out neighbor to neighbor.",
      },
      {
        id: "tearDown",
        label: "Just pull your fence down",
        description: "Cave and remove the section in dispute.",
      },
      {
        id: "ignore",
        label: "Ignore the complaint",
        description: "Leave the fence and hope it drops.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.volunteerFirefighter",
    image:
      "https://images.unsplash.com/photo-1579772330569-945775ca97ca?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Volunteer Fire Department Drive",
    headline: "The local volunteer fire department left a recruitment flyer at your door.",
    body: "They're short staffed and asking for new members. A donation envelope is paper clipped to it.",
    eligibility: ["all"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "join",
        label: "Sign up to volunteer",
        description: "Put in for the next training cohort.",
      },
      {
        id: "donate",
        label: "Donate to the department instead",
        description: "Send money rather than time.",
      },
      {
        id: "spreadWord",
        label: "Share their flyer",
        description: "Pass the recruitment notice along.",
      },
      {
        id: "ignore",
        label: "Recycle the flyer",
        description: "Not your calling.",
        isDefault: true,
      },
    ],
  },
  // era: podcast guest invite — podcasting emerged ~2004, mainstream ~2005.
  {
    kind: "pree.podcastInvite",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1610891015188-5369212db097?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Podcast Invite",
    headline: "A small podcast wants you on for a long interview.",
    body: "A few thousand listeners, a friendly host, and a guest list of local figures.",
    eligibility: ["all"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "pass",
    options: [
      {
        id: "longForm",
        label: "Sit for the long interview",
        description: "A real conversation, an hour plus.",
      },
      {
        id: "shortSegment",
        label: "Do a short clip",
        description: "Ten minutes, highlights only.",
      },
      {
        id: "referFriend",
        label: "Send a friend instead",
        description: "Recommend someone better suited.",
      },
      { id: "pass", label: "Pass on it", description: "Too small to bother.", isDefault: true },
    ],
  },
  // era: body references an "online portal link" and one option is a
  // telehealth "video appointment from your desk" — consumer video
  // telehealth ~2010.
  {
    kind: "pree.annualCheckup",
    minYear: 2010,
    image:
      "https://images.unsplash.com/photo-1531431199010-1f9985f83baa?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Annual Checkup Reminder",
    headline: "Your doctor's office sent the annual physical reminder.",
    body: "The card says it has been over a year. The online portal link is at the bottom.",
    eligibility: ["all"],
    baseWeight: 40,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "skip",
    options: [
      { id: "goIn", label: "Book the physical", description: "Go in person and get it done." },
      {
        id: "telehealth",
        label: "Do a telehealth visit",
        description: "A video appointment from your desk.",
      },
      {
        id: "reschedule",
        label: "Push it to next month",
        description: "Reschedule for a less busy week.",
      },
      { id: "skip", label: "Skip it this year", description: "You feel fine.", isDefault: true },
    ],
  },
  {
    kind: "pree.almaMaterCall",
    image:
      "https://images.unsplash.com/photo-1653410772359-0ef817e04207?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Alma Mater Fundraising Call",
    headline: "The university fundraising office is on the line.",
    body: "A development officer wants to talk about your class gift and a naming opportunity.",
    eligibility: ["all"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "hangUp",
    options: [
      { id: "majorGift", label: "Make a major gift", description: "A naming-level donation." },
      {
        id: "modestGift",
        label: "Give a modest amount",
        description: "A reasonable annual gift.",
      },
      {
        id: "pledgeLater",
        label: "Say you'll think about it",
        description: "Pledge to decide later.",
      },
      {
        id: "hangUp",
        label: "Politely decline",
        description: "End the call quickly.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.repairMixup",
    image:
      "https://images.unsplash.com/photo-1561491431-71b89da6056a?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Repair Shop Mix-Up",
    headline: "The repair shop handed you someone else's item.",
    body: "It's nicer than what you brought in. The tag has a different name on it.",
    eligibility: ["all"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "returnIt",
        label: "Return it to the shop",
        description: "Hand back the item that isn't yours.",
      },
      {
        id: "keepIt",
        label: "Keep the nicer item",
        description: "It's better than what you brought in.",
      },
      { id: "swapBack", label: "Swap it back", description: "Exchange it for your own item." },
      {
        id: "ignore",
        label: "Keep it and say nothing",
        description: "Let the mistake stand.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.communityGarden",
    image:
      "https://images.unsplash.com/photo-1609051589207-264fb1f91000?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Community Garden Plot",
    headline: "The community garden has one open plot left this season.",
    body: "A small fee, a shared water spigot, and a waiting list behind you.",
    eligibility: ["all"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "pass",
    options: [
      { id: "takePlot", label: "Claim the plot", description: "Sign up for the last open bed." },
      {
        id: "sharePlot",
        label: "Split it with a neighbor",
        description: "Co-tend the plot together.",
      },
      {
        id: "donateFee",
        label: "Pay the fee and give the plot away",
        description: "Cover the cost for someone else to take it.",
      },
      {
        id: "pass",
        label: "Pass on it",
        description: "Let someone else take the bed.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.propertyReassessment",
    image:
      "https://images.unsplash.com/photo-1506501139174-099022df5260?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Property Tax Reassessment",
    headline: "The county reassessed your home value and the new bill is higher.",
    body: "A formal notice says your assessment jumped. The appeal deadline is printed at the bottom.",
    eligibility: ["all"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "appeal",
        label: "Appeal the assessment",
        description: "Challenge the new valuation.",
      },
      {
        id: "payUp",
        label: "Pay the new tax bill",
        description: "Accept the reassessment.",
      },
      {
        id: "negotiate",
        label: "Ask to phase it in",
        description: "Request a staged increase.",
      },
      {
        id: "ignore",
        label: "Set it aside",
        description: "Deal with it later.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.parkingTicket",
    image:
      "https://images.unsplash.com/photo-1520986606214-8b456906c813?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Parking Ticket",
    headline: "A parking ticket is flapped under your wiper.",
    body: "You were only in the shop for five minutes. The citation says otherwise.",
    eligibility: ["all"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "contestIt", label: "Contest the ticket", description: "Fight it at the hearing." },
      { id: "payIt", label: "Just pay it", description: "Write the check and move on." },
      {
        id: "volunteerTime",
        label: "Do community service to clear it",
        description: "Work it off instead of paying.",
      },
      {
        id: "ignore",
        label: "Stuff it in the glovebox",
        description: "Ignore it and hope.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.lostDogReward",
    image:
      "https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Lost Dog Reward",
    headline: "A neighbor's dog is missing and there's a reward poster on the pole.",
    body: "The tag on the dog you found matches the flyer. A reward number is printed at the bottom.",
    eligibility: ["all"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "leaveIt",
    options: [
      {
        id: "searchAndReturn",
        label: "Find the owner and return it",
        description: "Call the number on the tag.",
      },
      {
        id: "returnToShelter",
        label: "Drop it at the shelter",
        description: "Let the shelter handle the reunion.",
      },
      { id: "keepIt", label: "Keep the dog", description: "Take it home instead." },
      {
        id: "leaveIt",
        label: "Leave it wandering",
        description: "Not your problem.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.civicAwardNomination",
    image:
      "https://images.unsplash.com/photo-1711895834951-fc4020e20b05?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Civic Award Nomination",
    headline: "A local civic group has nominated you for a community award.",
    body: "A short ceremony next month and a plaque with your name on it. The RSVP card is enclosed.",
    eligibility: ["politician"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "accept",
        label: "Accept graciously",
        description: "Say yes and give a short speech.",
      },
      {
        id: "attendQuietly",
        label: "Attend without a speech",
        description: "Show up, accept, say little.",
      },
      {
        id: "declineHumbly",
        label: "Decline humbly",
        description: "Step aside for someone else.",
      },
      {
        id: "ignore",
        label: "Don't respond",
        description: "Leave the organizers hanging.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.paradeMarshal",
    image:
      "https://images.unsplash.com/photo-1515150144380-bca9f1650ed9?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Parade Grand Marshal Invite",
    headline: "The town parade committee wants you as grand marshal.",
    body: "A convertible, a slow route down Main Street, and a crowd waving from the sidewalks.",
    eligibility: ["politician"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "skip",
    options: [
      { id: "lead", label: "Be grand marshal", description: "Lead the parade in person." },
      {
        id: "rideAlong",
        label: "Ride in a car in the parade",
        description: "Wave from a vehicle instead of walking.",
      },
      { id: "sendStaffer", label: "Send a staffer", description: "Have an aide represent you." },
      { id: "skip", label: "Skip the parade", description: "Stay off the route.", isDefault: true },
    ],
  },
  {
    kind: "pree.candidateForum",
    image:
      "https://images.unsplash.com/photo-1773828991534-58c40247255c?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Candidate Forum Invite",
    headline: "A civic league is hosting a candidate forum and you're invited.",
    body: "A moderator, timed answers, and your opponent already confirmed.",
    eligibility: ["inElection"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "skip",
    options: [
      {
        id: "showUp",
        label: "Show up and take questions",
        description: "Attend the forum in person.",
      },
      {
        id: "sendStatement",
        label: "Send a written statement",
        description: "Submit your positions instead of attending.",
      },
      {
        id: "surrogate",
        label: "Send a surrogate",
        description: "Have a supporter speak for you.",
      },
      { id: "skip", label: "Skip the forum", description: "Don't participate.", isDefault: true },
    ],
  },
  {
    kind: "pree.opEdOffer",
    image:
      "https://images.unsplash.com/photo-1547895749-888a559fc2a7?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Op-Ed Offer",
    headline: "A newspaper wants an op-ed from you on a local issue in the news.",
    body: "A short column, your byline, and a deadline at the end of the week.",
    eligibility: ["politician"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "writeIt",
        label: "Write it yourself",
        description: "Pen the piece in your own words.",
      },
      {
        id: "ghostwrite",
        label: "Have staff write it",
        description: "Sign your name to a drafted piece.",
      },
      { id: "decline", label: "Decline the offer", description: "Pass on the column." },
      { id: "ignore", label: "Don't reply", description: "Let the offer lapse.", isDefault: true },
    ],
  },
  {
    kind: "pree.minorLeagueSponsor",
    image:
      "https://images.unsplash.com/photo-1490187763999-9f273a5b7516?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Minor League Sponsorship Offer",
    headline: "A minor league ballclub wants your firm to sponsor the field.",
    body: "A sign on the outfield wall, a suite, and a season of community goodwill.",
    eligibility: ["ceo"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "pass",
    options: [
      {
        id: "signDeal",
        label: "Sign the sponsorship",
        description: "Put your name on the stadium wall.",
      },
      {
        id: "smallAd",
        label: "Buy a small ad package",
        description: "A modest program ad and a banner.",
      },
      {
        id: "inKind",
        label: "Donate goods instead of cash",
        description: "Supply the team in kind.",
      },
      {
        id: "pass",
        label: "Pass on the deal",
        description: "Skip the sponsorship.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.tradeAssociationBoard",
    image:
      "https://images.unsplash.com/photo-1607037183811-2a54d746cd35?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Trade Association Board Seat",
    headline: "A trade association has offered you a board seat.",
    body: "Quarterly meetings, industry access, and your name on the letterhead.",
    eligibility: ["ceo"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "acceptSeat",
        label: "Accept the board seat",
        description: "Take the role and attend regularly.",
      },
      {
        id: "attendOccasionally",
        label: "Attend occasionally",
        description: "Take the seat but show up rarely.",
      },
      { id: "decline", label: "Decline the seat", description: "Pass on the offer." },
      {
        id: "ignore",
        label: "Don't respond",
        description: "Let the invitation lapse.",
        isDefault: true,
      },
    ],
  },
  // era: customer review "blowing up online" with climbing "shares" —
  // social media / online review era ~2005.
  {
    kind: "pree.viralReview",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1647427060118-4911c9821b82?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Viral Customer Review",
    headline: "A customer review of your product is blowing up online.",
    body: "Shares are climbing and the comments are not kind. Your phone is buzzing.",
    eligibility: ["ceo"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignoreReview",
    options: [
      {
        id: "engagePublicly",
        label: "Respond publicly",
        description: "Reply in the open, fast.",
      },
      {
        id: "refundReplace",
        label: "Quietly make it right",
        description: "Refund and replace without a fuss.",
      },
      {
        id: "ignoreReview",
        label: "Ignore it",
        description: "Let the review sit.",
        isDefault: true,
      },
      {
        id: "lawyerUp",
        label: "Threaten legal action",
        description: "Send a cease and desist to the reviewer.",
      },
    ],
  },
  {
    kind: "pree.officeLeaseRenewal",
    image:
      "https://images.unsplash.com/photo-1559523161-0fc0d8b38a7a?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Office Lease Renewal",
    headline: "Your office lease is up and the landlord wants a rent hike.",
    body: "A renewal offer at a higher rate, a moving truck quote, and a deadline.",
    eligibility: ["ceo"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "monthToMonth",
    options: [
      {
        id: "renew",
        label: "Renew at the asking rent",
        description: "Sign a long lease at the new rate.",
      },
      {
        id: "renegotiate",
        label: "Push back on the hike",
        description: "Negotiate the rent down.",
      },
      {
        id: "relocate",
        label: "Move to cheaper space",
        description: "Relocate the office entirely.",
      },
      {
        id: "monthToMonth",
        label: "Go month to month",
        description: "Roll forward without a new lease.",
        isDefault: true,
      },
    ],
  },
  // ─── 4 easter egg events (rare, low weight, a little strange) ─────────────
  // era: the "laughItOff" option is to "post a joke" about the double —
  // social media ~2005.
  {
    kind: "pree.doppelganger",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1762158007969-eb58e74ee3d3?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Your Doppelganger",
    headline: "Someone who looks exactly like you is causing minor mischief around town.",
    body: "Reports keep coming in from places you have not been. A restaurant, a parking lot, a wedding.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "trackDown",
        label: "Track your lookalike down",
        description: "Find the person borrowing your face.",
      },
      {
        id: "laughItOff",
        label: "Laugh it off in public",
        description: "Post a joke about your double.",
      },
      {
        id: "lawyerUp",
        label: "Send a cease and desist",
        description: "Have a lawyer tell them to knock it off.",
      },
      {
        id: "ignore",
        label: "Ignore the whole thing",
        description: "Let the rumors run their course.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.greatAuntBequest",
    image:
      "https://images.unsplash.com/photo-1454793147212-9e7e57e89a4f?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Great-Aunt's Bequest",
    headline: "A great-aunt you barely remember left you something in her will.",
    body: "A lawyer's letter, a probate number, and an estate that might be worth the paperwork.",
    eligibility: ["all"],
    baseWeight: 6,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "claimEstate",
        label: "Claim the bequest",
        description: "Sign the papers and take what's there.",
      },
      {
        id: "donateIt",
        label: "Give it to charity",
        description: "Sign the estate over to a cause.",
      },
      {
        id: "refuse",
        label: "Disclaim the inheritance",
        description: "Decline to take it.",
      },
      {
        id: "ignore",
        label: "Let it sit",
        description: "Do nothing and see what happens.",
        isDefault: true,
      },
    ],
  },
  // era: the "watchOnline" option is to "watch the stream ... online" —
  // consumer livestreaming ~2005.
  {
    kind: "pree.childhoodTimeCapsule",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1553242072-345b34e7b55b?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Childhood Time Capsule",
    headline: "The town is opening the time capsule you helped bury as a kid.",
    body: "A ceremony at the old school, a rusty tube in the ground, and your name on the list of attendees.",
    eligibility: ["all"],
    baseWeight: 5,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "attend",
        label: "Go to the opening",
        description: "Show up for the dig up in person.",
      },
      {
        id: "sendLetter",
        label: "Send a note to include",
        description: "Mail a letter for the next capsule.",
      },
      {
        id: "watchOnline",
        label: "Watch the stream",
        description: "Tune in online instead of going.",
      },
      {
        id: "ignore",
        label: "Skip it",
        description: "Let the town open it without you.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.meteorite",
    image:
      "https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Meteorite in the Living Room",
    headline: "A small meteorite punched through your roof and landed on the carpet.",
    body: "A hole in the shingles, a scorch mark on the floor, and a warm black rock the size of a fist.",
    eligibility: ["all"],
    baseWeight: 4,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "keepIt",
    options: [
      {
        id: "sellIt",
        label: "Sell it to a collector",
        description: "Find a buyer for the space rock.",
      },
      {
        id: "donateToMuseum",
        label: "Donate it to a museum",
        description: "Give it to the local natural history museum.",
      },
      {
        id: "keepIt",
        label: "Keep it on the mantel",
        description: "A conversation piece at home.",
        isDefault: true,
      },
      {
        id: "insuranceClaim",
        label: "File an insurance claim",
        description: "Claim for the roof and call it a day.",
      },
    ],
  },
];

export const PREE_SEED_DEFINITIONS: Omit<EventDefinition, "_id" | "createdAt" | "updatedAt">[] = [
  ...GLOBAL_SEED_DEFINITIONS,
  ...COUNTRY_SEED_DEFINITIONS,
  ...WORLD_EVENT_SEED_DEFINITIONS,
  ...ERA_COUNTERPART_DEFINITIONS,
  ...DECADE_SEED_DEFINITIONS,
  ...ERA_COUNTRY_SEED_DEFINITIONS,
  ...BROADCAST_SEED_DEFINITIONS,
];

export async function seedPreeEventDefinitions(db: Db): Promise<{ upserted: number }> {
  const coll = getEventDefinitionsCollection(db);
  const now = new Date();
  let upserted = 0;

  for (const def of PREE_SEED_DEFINITIONS) {
    // Never $set `status`/`version` on existing rows; re-seeding must not
    // demote approved templates back to draft (that silently stops all offers).
    const { status, version, ...copyFields } = def;
    const result = await coll.updateOne(
      { kind: def.kind },
      {
        $set: { ...copyFields, updatedAt: now },
        $setOnInsert: { _id: new ObjectId(), status, version, createdAt: now },
      },
      { upsert: true }
    );
    if (result.upsertedCount > 0) {
      upserted++;
    }
  }

  return { upserted };
}
