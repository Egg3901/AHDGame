import type { LeadershipRole } from "@/lib/db/types";

export interface LeadershipFlavor {
  role: LeadershipRole;
  blurb: string;
  responsibilities: string[];
}

export const LEADERSHIP_FLAVOR: Record<LeadershipRole, LeadershipFlavor> = {
  speaker_of_the_house: {
    role: "speaker_of_the_house",
    blurb:
      "The Speaker of the House presides over the lower chamber, sets the legislative agenda, and is second in line for the presidency. Historically one of the most powerful positions in American politics, the Speaker controls which bills reach the floor and shapes the national conversation.",
    responsibilities: [
      "Presides over House sessions and maintains order",
      "Controls the legislative calendar and committee assignments",
      "Represents the House to the President and Senate",
      "Second in presidential succession after the Vice President",
    ],
  },
  majority_leader_house: {
    role: "majority_leader_house",
    blurb:
      "The House Majority Leader is the second-ranking member of the majority party, responsible for marshaling votes and coordinating the party's legislative strategy. They work closely with the Speaker to move the majority's agenda through the chamber.",
    responsibilities: [
      "Schedules legislation for floor consideration",
      "Whips votes and counts support for key bills",
      "Coordinates with committee chairs on priorities",
      "Leads the majority caucus in strategy sessions",
    ],
  },
  minority_leader_house: {
    role: "minority_leader_house",
    blurb:
      "The House Minority Leader leads the opposition party, developing alternative proposals and rallying the minority caucus. When the majority stumbles, the Minority Leader is positioned to challenge their narrative and offer a competing vision.",
    responsibilities: [
      "Leads the minority party caucus",
      "Develops and promotes alternative legislation",
      "Coordinates opposition strategy on key votes",
      "Represents minority views in negotiations",
    ],
  },
  majority_whip_house: {
    role: "majority_whip_house",
    blurb:
      "The Majority Whip is the vote-counter and arm-twister of the majority party. They ensure members show up for crucial votes and know exactly where the caucus stands—no bill passes without the Whip's head count.",
    responsibilities: [
      "Counts and secures votes for majority legislation",
      "Communicates leadership positions to rank-and-file",
      "Tracks member positions on upcoming votes",
      "Resolves last-minute defections before key roll calls",
    ],
  },
  minority_whip_house: {
    role: "minority_whip_house",
    blurb:
      "The Minority Whip keeps the opposition united and informed. When the majority brings a bill to the floor, the Minority Whip ensures every dissenting voice is heard—or strategically withheld—to maximize the minority's leverage.",
    responsibilities: [
      "Counts minority votes and tracks positions",
      "Coordinates with Minority Leader on strategy",
      "Mobilizes opposition when the majority overreaches",
      "Maintains caucus discipline on party-line votes",
    ],
  },
  president_pro_tempore: {
    role: "president_pro_tempore",
    blurb:
      "The President Pro Tempore presides over the Senate in the Vice President's absence and is third in line for the presidency. Traditionally given to the longest-serving majority-party senator, the role carries both ceremonial weight and procedural power.",
    responsibilities: [
      "Presides over the Senate when the VP is absent",
      "Third in presidential succession",
      "Appoints senators to select committees",
      "Signs enrolled bills and resolutions",
    ],
  },
  majority_leader_senate: {
    role: "majority_leader_senate",
    blurb:
      "The Senate Majority Leader is often called the most powerful person in Congress. With no Speaker-like figure, the Majority Leader controls the floor schedule, negotiates unanimous consent agreements, and can single-handedly block or advance legislation.",
    responsibilities: [
      "Controls the Senate floor and legislative calendar",
      "Negotiates unanimous consent and cloture agreements",
      "Schedules votes and manages debate time",
      "Represents the majority in negotiations with the minority",
    ],
  },
  minority_leader_senate: {
    role: "minority_leader_senate",
    blurb:
      "The Senate Minority Leader wields outsized influence thanks to the filibuster and the chamber's tradition of consensus. A skilled Minority Leader can extract concessions, delay unwanted legislation, or force the majority to negotiate.",
    responsibilities: [
      "Leads the minority caucus in the Senate",
      "Uses procedural tools to shape or block legislation",
      "Negotiates with Majority Leader on scheduling",
      "Represents minority interests in bipartisan deals",
    ],
  },
  majority_whip_senate: {
    role: "majority_whip_senate",
    blurb:
      "The Senate Majority Whip rounds up votes in a chamber where every member matters. With narrow margins, a single defection can sink a bill—making the Whip's job of knowing where each senator stands absolutely critical.",
    responsibilities: [
      "Counts votes and gauges support for majority bills",
      "Communicates leadership priorities to senators",
      "Works to resolve holdouts before key votes",
      "Coordinates with House leadership on bicameral bills",
    ],
  },
  minority_whip_senate: {
    role: "minority_whip_senate",
    blurb:
      "The Senate Minority Whip keeps the opposition coordinated. In a body built on relationships and personal persuasion, the Whip ensures the minority speaks with one voice when it matters—and knows when to let members vote their conscience.",
    responsibilities: [
      "Tracks minority senator positions on legislation",
      "Coordinates with Minority Leader on strategy",
      "Mobilizes opposition for cloture and key votes",
      "Maintains caucus cohesion on party priorities",
    ],
  },
  speaker_of_the_bundestag: {
    role: "speaker_of_the_bundestag",
    blurb:
      "The Bundestagspräsident presides over the Bundestag, sets its agenda, and ranks second in the German order of constitutional precedence after the Federal President. By convention the position is held by a member of the largest Bundestag faction; mechanically the role mirrors the US Speaker of the House — top-vote-getter wins an open ballot among MdBs.",
    responsibilities: [
      "Presides over Bundestag sessions and maintains order",
      "Sets the legislative calendar and recognizes speakers",
      "Represents the Bundestag externally and to the Federal President",
      "Second in the constitutional order of precedence after the Bundespräsident",
    ],
  },
  chair_npcsc: {
    role: "chair_npcsc",
    blurb:
      "The Chairman of the NPC Standing Committee presides over the National People's Congress and its permanent body, steering the year-round legislative and state-oversight work that continues between full NPC sessions. Ranking among the state's highest offices, the role mirrors a presiding-officer mechanic — the top-vote-getter wins an open ballot among seated NPC delegates.",
    responsibilities: [
      "Presides over the National People's Congress and its Standing Committee",
      "Sets the legislative calendar and convenes Standing Committee sessions",
      "Directs state-oversight and law-interpretation work between full NPC sessions",
      "Represents the legislature in the order of state precedence",
    ],
  },
  chair_cppcc: {
    role: "chair_cppcc",
    blurb:
      "The Chairman of the Chinese People's Political Consultative Conference heads the united-front advisory body, coordinating consultation among parties and social constituencies and channeling their proposals to the state. Mechanically the role mirrors a party-internal leadership election — the largest NPC party (the CCP) selects the Chairman by plurality of its delegates.",
    responsibilities: [
      "Heads the CPPCC and convenes its consultative sessions",
      "Coordinates united-front consultation across parties and constituencies",
      "Channels advisory proposals to the state and legislature",
      "Represents the advisory body in the order of state precedence",
    ],
  },
  speaker_ng_reps: {
    role: "speaker_ng_reps",
    blurb:
      "The Speaker of the House of Representatives presides over the lower chamber of Nigeria's National Assembly, sets the order of business, and represents the House in dealings with the Senate and the Presidency. Members of the House elect the Speaker from among their own number.",
    responsibilities: [
      "Presides over sittings of the House of Representatives and keeps order",
      "Sets the order of business and refers bills to committees",
      "Represents the House to the Senate and the Presidency",
      "Ranks high in the order of national precedence",
    ],
  },
  president_ng_senate: {
    role: "president_ng_senate",
    blurb:
      "The President of the Senate presides over the upper chamber of Nigeria's National Assembly and, with the Speaker, co-chairs joint sittings of the National Assembly. Senators elect the Senate President from among their own number.",
    responsibilities: [
      "Presides over sittings of the Senate and keeps order",
      "Sets the order of business and refers bills to committees",
      "Co-chairs joint sittings of the National Assembly",
      "Ranks high in the order of national precedence",
    ],
  },
};
