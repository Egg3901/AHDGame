/**
 * Global PREE seed definitions, part 1 (pree.lotteryWin through the last
 * definition before pree.boardroomUltimatum).
 *
 * Extracted from seedDefinitions.ts (pure code motion, no value changes) to
 * keep that module under the architecture-audit size cap. seedDefinitions.ts
 * spreads this array first, so the combined GLOBAL_SEED_DEFINITIONS order is
 * unchanged.
 */
import type { EventDefinition } from "@/lib/db/types/events";

export const GLOBAL_SEED_DEFINITIONS_PART1: Omit<
  EventDefinition,
  "_id" | "createdAt" | "updatedAt"
>[] = [
  {
    kind: "pree.lotteryWin",
    image:
      "https://images.unsplash.com/photo-1599946347371-68eb71b16afc?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Lottery Win",
    headline: "Your numbers came up in the state lottery.",
    body: "A winning ticket linked to you has surfaced. Reporters are already calling.",
    eligibility: ["all"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "lumpSum",
        label: "Take the lump sum",
        description: "Collect the jackpot now, minus taxes.",
      },
      {
        id: "annuity",
        label: "Take the annuity",
        description: "Steady influence payments over several turns.",
      },
      { id: "donate", label: "Donate to charity", description: "Announce a charitable gift." },
      { id: "ignore", label: "Let the ticket expire", description: "Do nothing.", isDefault: true },
    ],
  },
  {
    kind: "pree.stafferScandal",
    image:
      "https://images.unsplash.com/photo-1520525003249-2b9cdda513bc?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Staffer Scandal",
    headline: "A member of your campaign staff is embroiled in controversy.",
    body: "Opposition researchers are circulating the story. How do you respond?",
    eligibility: ["inElection"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "apologize",
        label: "Go public and apologize",
        description: "Hold a press conference.",
      },
      { id: "contain", label: "Contain the press", description: "Limit media access." },
      { id: "fire", label: "Fire the staffer and pivot", description: "Cut ties immediately." },
      { id: "ignore", label: "Ignore it", description: "Hope it fades.", isDefault: true },
    ],
  },
  // era: clip "spreading online" via "social media" — social media era ~2005.
  {
    kind: "pree.campaignViral",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1595798896730-9fdf2e709649?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Campaign Goes Viral",
    headline: "A clip of you is spreading online.",
    body: "Social media is amplifying the moment, and nobody can tell yet if it helps.",
    eligibility: ["inElection"],
    baseWeight: 25,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "nothing",
    options: [
      { id: "leanIn", label: "Lean in and post more", description: "Keep posting while it's hot." },
      { id: "disciplined", label: "Stay disciplined", description: "Stick to the message." },
      { id: "delete", label: "Delete and move on", description: "Scrub the post." },
      { id: "nothing", label: "Do nothing", description: "Let it play out.", isDefault: true },
    ],
  },
  {
    kind: "pree.corruptDonor",
    image:
      "https://images.unsplash.com/photo-1566404791232-af9fe0ae8f8b?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Corrupt Donor Revealed",
    headline: "A major donor tied to you is facing corruption allegations.",
    body: "Journalists want to know whether you will return the money.",
    eligibility: ["politician"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "noComment",
    options: [
      {
        id: "return",
        label: "Return the money and cooperate",
        description: "Give it back publicly.",
      },
      { id: "distance", label: "Distance yourself publicly", description: "Deny knowledge." },
      { id: "attack", label: "Attack the source", description: "Go on offense." },
      { id: "noComment", label: "No comment", description: "Refuse to engage.", isDefault: true },
    ],
  },
  {
    kind: "pree.ceoWhistleblower",
    image:
      "https://images.unsplash.com/photo-1602743297108-4c9061884285?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Whistleblower Memo",
    headline: "An internal memo alleging misconduct lands on your desk.",
    body: "Legal and PR are waiting for your call.",
    eligibility: ["ceo"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "review", label: "Launch an internal review", description: "Commission an audit." },
      { id: "settle", label: "Quietly settle", description: "Pay to make it go away." },
      {
        id: "cooperate",
        label: "Go public and cooperate",
        description: "Disclose and invite oversight.",
      },
      { id: "ignore", label: "Ignore the memo", description: "File it away.", isDefault: true },
    ],
  },
  {
    kind: "pree.taxAudit",
    image:
      "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Tax Audit",
    headline: "The revenue service has flagged your latest return.",
    body: "An auditor has requested documentation going back five years.",
    eligibility: ["all"],
    baseWeight: 15,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "cooperate", label: "Cooperate fully", description: "Open the books." },
      {
        id: "lawyers",
        label: "Hire elite tax attorneys",
        description: "Fight every line item.",
      },
      { id: "stonewall", label: "Stonewall the auditors", description: "Concede nothing." },
      {
        id: "ignore",
        label: "Ignore the notice",
        description: "Toss the letter in a drawer.",
        isDefault: true,
      },
    ],
  },
  // era: a friend pitching a "startup" with a "deck" — dot-com startup
  // culture, consumer-internet era ~1995.
  {
    kind: "pree.oldFriendVenture",
    minYear: 1995,
    image:
      "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Old Friend's Venture",
    headline: "A college friend is pitching you their startup.",
    body: "The deck looks ambitious. The friendship is real. The numbers are unaudited.",
    eligibility: ["all"],
    baseWeight: 15,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "investBig", label: "Invest $250K", description: "Back the venture seriously." },
      {
        id: "smallStake",
        label: "Take a small stake ($50K)",
        description: "Support without betting the house.",
      },
      { id: "decline", label: "Decline politely", description: "Keep your money." },
      {
        id: "ignore",
        label: "Leave them on read",
        description: "Don't reply.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.memoirOffer",
    image:
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Memoir Offer",
    headline: "A publisher wants the rights to your story.",
    body: "The advance is real money. The question is whose words end up on the page.",
    eligibility: ["politician"],
    baseWeight: 15,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "writeIt", label: "Write it yourself", description: "Every word is yours." },
      {
        id: "ghostwriter",
        label: "Hire a ghostwriter",
        description: "Bigger advance, faster book.",
      },
      { id: "decline", label: "Decline the deal", description: "The story isn't finished." },
      {
        id: "ignore",
        label: "Let the offer lapse",
        description: "Don't return the calls.",
        isDefault: true,
      },
    ],
  },
  // era: "Phones are up all over the room" capturing "the clip" — smartphone
  // video era ~2008.
  {
    kind: "pree.townHallAmbush",
    minYear: 2008,
    image:
      "https://images.unsplash.com/photo-1520452112805-c6692c840af0?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Town Hall Ambush",
    headline: "An activist ambushes you on camera at a town hall.",
    body: "Phones are up all over the room. Whatever you do next will be the clip.",
    eligibility: ["politician"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "walkAway",
    options: [
      { id: "engage", label: "Engage honestly", description: "Take it head-on." },
      {
        id: "deflect",
        label: "Deflect with talking points",
        description: "Pivot to the message.",
      },
      { id: "mock", label: "Mock the questioner", description: "Play to the room." },
      {
        id: "walkAway",
        label: "Walk away",
        description: "End the event early.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.endorsementDilemma",
    image:
      "https://images.unsplash.com/photo-1594581979864-36977b15d0dc?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Polarizing Endorsement",
    headline: "A polarizing celebrity just endorsed your campaign.",
    body: "Their fans are energized. Everyone else is watching how you respond.",
    eligibility: ["inElection"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "noComment",
    options: [
      { id: "embrace", label: "Embrace the endorsement", description: "Share the stage." },
      { id: "quietAccept", label: "Accept quietly", description: "Skip the photo op." },
      { id: "reject", label: "Publicly reject it", description: "Distance on principle." },
      {
        id: "noComment",
        label: "Say nothing",
        description: "Let the news cycle decide.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.debateGaffe",
    image:
      "https://images.unsplash.com/photo-1764874299006-bf4266427ec9?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Hot Mic",
    headline: "A hot mic caught you before the debate.",
    body: "The audio is already circulating. Your team needs a decision in the next hour.",
    eligibility: ["inElection"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "sayNothing",
    options: [
      { id: "ownIt", label: "Own it with humor", description: "Make the joke first." },
      { id: "apologize", label: "Issue a formal apology", description: "A sober statement." },
      { id: "deny", label: "Deny everything", description: "Claim it was doctored." },
      {
        id: "sayNothing",
        label: "Say nothing",
        description: "Refuse to dignify it.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.productRecall",
    image:
      "https://images.unsplash.com/photo-1497015289639-54688650d173?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Product Defect",
    headline: "Quality control flagged a defect in your flagship product.",
    body: "Engineering says it's rare. Legal says it's a liability. The line is still running.",
    eligibility: ["ceo"],
    baseWeight: 20,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "recall",
        label: "Issue a voluntary recall",
        description: "Pull it before regulators do.",
      },
      { id: "silentFix", label: "Fix it quietly", description: "Patch the line, say nothing." },
      {
        id: "blameSuppliers",
        label: "Blame the suppliers",
        description: "Point at the vendors.",
      },
      {
        id: "ignore",
        label: "Ship it anyway",
        description: "Within tolerance. Probably.",
        isDefault: true,
      },
    ],
  },
  // era: leak arrives as an "email ... sitting in your inbox" — mainstream
  // email ~1995.
  {
    kind: "pree.insiderTip",
    minYear: 1995,
    image:
      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Insider Tip",
    headline: "A rival's executive leaked market-moving information to you.",
    body: "The email is sitting in your inbox. Nobody else has seen it. Yet.",
    eligibility: ["ceo"],
    baseWeight: 15,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "delete",
    options: [
      {
        id: "report",
        label: "Report it to regulators",
        description: "Forward it to the commission.",
      },
      { id: "trade", label: "Trade on it", description: "Move before the news breaks." },
      { id: "warnRival", label: "Warn the rival CEO", description: "Tell them they leak." },
      {
        id: "delete",
        label: "Delete the email",
        description: "You never saw it.",
        isDefault: true,
      },
    ],
  },
  // --- Everyday "normal" events: higher base weights so the mundane surfaces
  // more often than the dramatic events above when a character's slot opens.
  {
    kind: "pree.charityGala",
    image:
      "https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Charity Gala Invitation",
    headline: "A foundation wants you at their black-tie gala.",
    body: "There's a donation card on every seat and a photographer at the door.",
    eligibility: ["all"],
    baseWeight: 40,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "buyTable",
        label: "Buy a table",
        description: "Sponsor a full table and put your name on it.",
      },
      {
        id: "attendDonate",
        label: "Attend and donate modestly",
        description: "Show up, write a reasonable check.",
      },
      {
        id: "sendRegrets",
        label: "Send regrets with a note",
        description: "Decline gracefully and wish them well.",
      },
      {
        id: "ignore",
        label: "Ignore the invite",
        description: "Let it sit in the pile.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.localInterview",
    image:
      "https://images.unsplash.com/photo-1496247749665-49cf5b1022e9?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Local Interview Request",
    headline: "A neighborhood outlet wants fifteen minutes.",
    body: "Friendly questions, a small audience, a quick turnaround.",
    eligibility: ["all"],
    baseWeight: 45,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "fullInterview",
        label: "Sit for the full interview",
        description: "Give them your time on camera.",
      },
      {
        id: "statement",
        label: "Send a written statement",
        description: "Send a few quotable lines instead.",
      },
      { id: "decline", label: "Decline politely", description: "Thank them but pass." },
      {
        id: "ignore",
        label: "Don't reply",
        description: "Let the request go cold.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.speakingFee",
    image:
      "https://images.unsplash.com/photo-1774025395295-6d5f23f272bd?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Speaking Engagement",
    headline: "A trade conference offers a fee for a keynote.",
    body: "Easy money, a few hours of your weekend.",
    eligibility: ["all"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      { id: "takeGig", label: "Take the gig", description: "Pocket the fee for a keynote." },
      {
        id: "proBono",
        label: "Do it pro bono",
        description: "Waive the fee and bank the goodwill.",
      },
      { id: "decline", label: "Decline", description: "Pass on the invitation." },
      {
        id: "ignore",
        label: "Let it lapse",
        description: "Never get back to them.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.juryDuty",
    image:
      "https://images.unsplash.com/photo-1518688248740-7c31f1a945c4?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Jury Summons",
    headline: "A jury summons arrives in the mail.",
    body: "The clerk's office is not interested in your schedule.",
    eligibility: ["all"],
    // Sitting officeholders and active candidates are excused from ordinary
    // jury duty in practice, so the summons only reaches private citizens and
    // business leaders. Excludes "politician" (holdsOffice || inElection).
    excludeEligibility: ["politician"],
    baseWeight: 30,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "ignore",
    options: [
      {
        id: "serve",
        label: "Serve like everyone else",
        description: "Report for duty and sit the trial.",
      },
      {
        id: "deferral",
        label: "Request a hardship deferral",
        description: "Ask the clerk to push it back.",
      },
      {
        id: "getExcused",
        label: "Have a lawyer get you excused",
        description: "Make it quietly go away.",
      },
      {
        id: "ignore",
        label: "Toss the letter",
        description: "Pretend it never arrived.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.ribbonCutting",
    image:
      "https://images.unsplash.com/photo-1505373877841-8d25f7d46678?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Ribbon Cutting",
    headline: "A new community center wants you holding the scissors.",
    body: "It opens in your district this weekend.",
    eligibility: ["politician"],
    baseWeight: 45,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "skip",
    options: [
      {
        id: "attend",
        label: "Show up and work the crowd",
        description: "Hold the oversized scissors yourself.",
      },
      { id: "sendDeputy", label: "Send a deputy", description: "Let a staffer stand in for you." },
      { id: "statement", label: "Send a statement", description: "Mark the occasion in writing." },
      { id: "skip", label: "Skip it", description: "Stay off the calendar.", isDefault: true },
    ],
  },
  {
    kind: "pree.constituentLetters",
    image:
      "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Constituent Mailbag",
    headline: "A letter campaign is filling your office inbox.",
    body: "It's a coordinated push on a local issue.",
    eligibility: ["politician"],
    baseWeight: 40,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "staffHandle",
    options: [
      {
        id: "personalReply",
        label: "Personally respond",
        description: "Write back to constituents yourself.",
      },
      {
        id: "formLetter",
        label: "Send a form-letter reply",
        description: "Acknowledge everyone with a template.",
      },
      {
        id: "listeningSession",
        label: "Hold a listening session",
        description: "Invite them in to be heard in person.",
      },
      {
        id: "staffHandle",
        label: "Let staff handle it",
        description: "Route it to the district office.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.partyFundraiser",
    image:
      "https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Routine Fundraiser",
    headline: "The party penciled you in for a rubber-chicken dinner.",
    body: "Reliable donors, predictable speeches.",
    eligibility: ["politician"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "noShow",
    options: [
      {
        id: "headline",
        label: "Headline the dinner",
        description: "Be the main draw of the evening.",
      },
      { id: "dropBy", label: "Drop by briefly", description: "Shake hands and slip out." },
      {
        id: "videoMessage",
        label: "Send a video message",
        description: "Tape some warm remarks instead.",
      },
      { id: "noShow", label: "No-show", description: "Skip it entirely.", isDefault: true },
    ],
  },
  {
    kind: "pree.earningsCall",
    image:
      "https://images.unsplash.com/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Quarterly Earnings Call",
    headline: "Analysts are dialing in for the quarterly call.",
    body: "The numbers are fine. The question is the framing.",
    eligibility: ["ceo"],
    baseWeight: 45,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "cfoRuns",
    options: [
      {
        id: "projectConfidence",
        label: "Project confidence",
        description: "Talk up the quarter and the outlook.",
      },
      {
        id: "cautiousGuidance",
        label: "Set cautious guidance",
        description: "Under-promise so you can over-deliver.",
      },
      {
        id: "stickScript",
        label: "Stick to the script",
        description: "Read the prepared remarks, nothing more.",
      },
      {
        id: "cfoRuns",
        label: "Let the CFO run it",
        description: "Hand the call to your finance chief.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.employeeMorale",
    image:
      "https://images.unsplash.com/photo-1557804506-e969d7b32a4b?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Morale Survey",
    headline: "The annual employee survey came back a point lower.",
    body: "Engagement slipped. HR wants a response.",
    eligibility: ["ceo"],
    baseWeight: 40,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "fileAway",
    options: [
      {
        id: "townHall",
        label: "Town hall and visible changes",
        description: "Address the staff and act on the feedback.",
      },
      { id: "perks", label: "Targeted perks", description: "Spend a little to keep people happy." },
      { id: "memo", label: "Memo from the top", description: "Send an all-hands message." },
      {
        id: "fileAway",
        label: "File it away",
        description: "Note the numbers and move on.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.vendorRenewal",
    image:
      "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Vendor Renewal",
    headline: "A key supplier contract is up for renewal.",
    body: "They want a raise; procurement wants a cut.",
    eligibility: ["ceo"],
    baseWeight: 35,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "autoRenew",
    options: [
      {
        id: "squeeze",
        label: "Squeeze them hard",
        description: "Demand a steep discount to renew.",
      },
      {
        id: "fairTerms",
        label: "Renew at fair terms",
        description: "Split the difference and move on.",
      },
      {
        id: "shopAround",
        label: "Shop for alternatives",
        description: "Put the contract out to bid.",
      },
      {
        id: "autoRenew",
        label: "Auto-renew",
        description: "Let the contract roll over as-is.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.canvassWeekend",
    image:
      "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Canvassing Weekend",
    headline: "Your field team has a free Saturday and a stack of walk lists.",
    body: "Where do you point them?",
    eligibility: ["inElection"],
    baseWeight: 45,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "dayOff",
    options: [
      {
        id: "knockYourself",
        label: "Knock doors yourself",
        description: "Hit the pavement with the walk lists.",
      },
      {
        id: "sendVolunteers",
        label: "Send volunteers to swing precincts",
        description: "Point the field team where it counts.",
      },
      { id: "phoneBank", label: "Phone bank instead", description: "Work the call lists from HQ." },
      {
        id: "dayOff",
        label: "Take the day off",
        description: "Rest the team and yourself.",
        isDefault: true,
      },
    ],
  },
  // era: the "digitalOnly" option pushes the campaign "online instead" —
  // consumer internet ~1995.
  {
    kind: "pree.yardSignDrive",
    minYear: 1995,
    image:
      "https://images.unsplash.com/photo-1570941144223-7e4f5d0624ee?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Yard Sign Drive",
    headline: "Supporters want lawn signs faster than you can print them.",
    body: "Demand is real. So is the printing bill.",
    eligibility: ["inElection"],
    baseWeight: 40,
    cooldownTurnsMin: 0,
    cooldownTurnsMax: 0,
    defaultOptionId: "letCool",
    options: [
      {
        id: "bigBatch",
        label: "Order a big batch",
        description: "Spend campaign funds to flood the district.",
      },
      {
        id: "conservativePrint",
        label: "Print conservatively",
        description: "Order a measured run of signs.",
      },
      {
        id: "digitalOnly",
        label: "Go digital-only",
        description: "Skip the signs, push online instead.",
      },
      {
        id: "letCool",
        label: "Let demand cool",
        description: "Tell supporters to sit tight.",
        isDefault: true,
      },
    ],
  },
  // ─── Minority shareholder pressure events (CEO concentration >65% / >80%) ──
  {
    kind: "pree.minorityStrategyPressure",
    image:
      "https://images.unsplash.com/photo-1607778417094-1fef13315e6e?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Shareholder Strategy Demand",
    headline: "Minority investors demand a pivot in your {sectorLabel} sector",
    body: "A coordinated minority bloc has written to the board calling for an immediate shift from {currentStrategyName} to {demandedStrategyName}, citing long-term returns and competitive positioning.",
    eligibility: ["ceoConcentrated"],
    baseWeight: 8,
    cooldownTurnsMin: 18,
    cooldownTurnsMax: 30,
    defaultOptionId: "ignore",
    options: [
      {
        id: "engage",
        label: "Engage the proposal",
        description: "Bring the shareholders to the table and negotiate the pivot.",
      },
      {
        id: "negotiate",
        label: "Negotiate a timeline",
        description: "Acknowledge their concerns and offer a phased review.",
      },
      {
        id: "ignore",
        label: "Dismiss the demand",
        description: "File the letter and say nothing.",
        isDefault: true,
      },
    ],
  },
  {
    kind: "pree.minorityExpansionDemand",
    image:
      "https://images.unsplash.com/photo-1536181783029-1097aaf179de?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Expansion Demand",
    headline: "{shareholderName} calls for a presence in {stateName}",
    body: "A minority shareholder has contacted the board demanding the company establish operations in {stateName}, where they hold significant local interests. They argue the market is underserved.",
    eligibility: ["ceoConcentrated"],
    baseWeight: 6,
    cooldownTurnsMin: 20,
    cooldownTurnsMax: 36,
    defaultOptionId: "decline",
    options: [
      {
        id: "agree",
        label: "Agree to explore it",
        description: "Commission a market assessment for the state.",
      },
      {
        id: "stall",
        label: "Promise a feasibility study",
        description: "Buy time with a vague commitment.",
      },
      {
        id: "decline",
        label: "Decline outright",
        description: "Inform them the expansion isn't viable.",
        isDefault: true,
      },
    ],
  },
  // era: an "ESG bloc" with "ESG mandates" — ESG as an investment frame
  // dates to ~2004-05 (UN Global Compact).
  {
    kind: "pree.minorityExtractionObjection",
    minYear: 2005,
    image:
      "https://images.unsplash.com/photo-1554007460-791a7b8945d8?auto=format&fit=crop&w=1200&q=70",
    status: "draft",
    version: 1,
    title: "Extraction Strategy Objection",
    headline: "ESG bloc demands shift from {currentExtractionName} to {demandedExtractionName}",
    body: "Minority shareholders with ESG mandates have formally objected to your current {currentExtractionName} strategy, insisting the board pivot to {demandedExtractionName} or face a public divestment campaign.",
    eligibility: ["ceoConcentrated"],
    baseWeight: 7,
    cooldownTurnsMin: 16,
    cooldownTurnsMax: 28,
    defaultOptionId: "doubleDown",
    options: [
      {
        id: "pivot",
        label: "Commit to the pivot",
        description: "Announce the strategy shift and begin retooling.",
      },
      {
        id: "study",
        label: "Commission an independent study",
        description: "Hire consultants and buy time.",
      },
      {
        id: "doubleDown",
        label: "Double down on current strategy",
        description: "Defend the strategy to the board and press.",
        isDefault: true,
      },
    ],
  },
];
