/**
 * Seed China-specific wiki/guide pages.
 *
 * Creates in-game documentation so players understand how CN differs
 * from normal parliamentary systems.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { WikiPage } from "@/lib/db/types";

const CN_WIKI_PAGES: Array<
  Pick<WikiPage, "slug" | "title" | "description" | "content" | "tags" | "category">
> = [
  {
    slug: "china-overview",
    title: "China Overview",
    description: "How China works in A House Divided.",
    category: "Country Guide",
    tags: ["china", "country", "overview", "npc", "cpc"],
    content: `## China in A House Divided

China is a **one-party dominant system** led by the Communist Party of China (CPC). Unlike parliamentary democracies where coalitions form and governments can fall, the CPC governs continuously. The CPC always rules; the game is about how well.

### Key differences

- **No coalitions.** The CPC does not form coalitions with other parties. United Front parties (CDL, CNDCA) have token NPC seats but cannot join government or trigger no-confidence votes.
- **NPC Delegates instead of MPs.** The lower chamber is the National People's Congress (NPC). Seats are allocated by region, not constituency. All 2980 delegates are NPC members.
- **Premier, not Prime Minister.** The head of government is the Premier of the State Council. Appointed by the NPC Standing Committee on CPC recommendation.
- **CPC Confidence.** The CPC leader has a **confidence score** (0-100) that measures party discipline and leadership strength. High confidence = strong mandate. Low confidence = internal challenge risk.
- **Government does not collapse.** Unlike UK/JP/DE, losing a majority does not collapse the Chinese government. The CPC always governs. Crises work through the confidence system, not government formation.

### Regions

China is divided into 7 macro-regions, each with NPC seats proportional to population and economic weight:

| Region | NPC Seats | Character |
|--------|-----------|-----------|
| Northeast | 400 | Heavy industry, state enterprise heritage |
| North | 500 | Beijing-Tianjin corridor, capital adjacency |
| East | 600 | Shanghai, manufacturing, export economy |
| Central | 500 | Wuhan, logistics, rising middle class |
| South | 400 | Shenzhen, tech, private sector strength |
| Southwest | 340 | Chengdu, infrastructure, ethnic diversity |
| Northwest | 240 | Xinjiang corridor, resources, border security |

### Parties

- **CPC (中国共产党)**: Governing party. ~95% of NPC seats. Leader confidence is the central political mechanic.
- **CDL (中国民主同盟)**: United Front token party. ~2.5% of NPC seats. Advisory role only.
- **CNDCA (中国民主建国会)**: United Front token party. ~2.5% of NPC seats. Advisory role only.
- **Independents**: Rare. May appear in some regions.

### How to play China

1. Join the CPC. Only CPC members can hold executive office.
2. Build regional party organization. Higher org = stronger whip control and more NPC seats in the next cycle.
3. Watch CPC Confidence. Enact policies aligned with CPC priority axes (Growth, Stability, Anti-Corruption, National Security, etc.) to maintain confidence.
4. Avoid purges. Purges reduce confidence. Severe purges can trigger internal crises.
5. Advance through the party ranks. Provincial leadership → NPC Standing Committee → Premier.

### NPC mechanics

- NPC "elections" are better understood as **allocation cycles**. Seats are distributed by region based on party organization strength and demographic weight.
- The NPC does not dissolve or call snap elections. Cycles happen on a fixed schedule.
- NPC delegates vote on legislation, but the CPC whip controls the outcome when confidence is high.
`,
  },
  {
    slug: "china-cpc-confidence",
    title: "CPC Confidence System",
    description: "How CPC leader confidence works and why it matters.",
    category: "Mechanics",
    tags: ["china", "cpc", "confidence", "mechanics", "priorities", "purges"],
    content: `## CPC Confidence

The CPC leader has a **confidence score** from 0 to 100. This is the central political mechanic for China.

### What confidence represents

- **Party discipline**: Can the leader command the Central Committee?
- **Mandate strength**: Does the Politburo back the leader's agenda?
- **Internal challenge risk**: How likely is a leadership challenge or factional split?

Confidence is **not** popularity. It is coercive and institutional power within the party.

### Confidence bands

| Band | Range | Meaning |
|------|-------|---------|
| Iron Grip | 85-100 | Near-total control. Purges possible with minimal backlash. |
| Strong | 70-84 | Solid mandate. Normal governance. |
| Moderate | 55-69 | Some dissent. Watch policy alignment. |
| Weak | 40-54 | Factional resistance. Challenge risk rising. |
| Critical | 20-39 | Crisis territory. Leadership survival at risk. |
| Collapse | 0-19 | Systemic breakdown. Forced transition likely. |

### What affects confidence

**Positive:**
- Policy alignment with CPC priority axes (Growth, Stability, Anti-Corruption, Social Welfare, National Security, Environment, Technology, Unity)
- Successful turn completion without major incidents
- Renewing the leader's mandate on schedule

**Negative:**
- Policy drift (enacting policies that contradict priority axes)
- Purges (severity matters: minor -2, regional -4, senior -7, faction -10, extreme -15)
- Unprocessed purge backlog (each unprocessed purge adds cumulative -2 per turn)
- Missing a mandate renewal deadline

### Purges

Purges are internal CPC disciplinary actions. They remove disloyal officials but cost confidence:

| Severity | Confidence Cost |
|----------|----------------|
| Minor (individual) | -2 |
| Regional (purge a province leadership) | -4 |
| Senior ( Politburo-level) | -7 |
| Faction (purge an entire faction) | -10 |
| Extreme (widespread, visible) | -15 |

Unprocessed purges accumulate. Each turn, every unprocessed purge adds an additional -2.

### Turn processing

At the start of each turn:
1. Compute policy drift from enacted policies vs. priority axes.
2. Apply unprocessed purge penalties.
3. Update confidence score.
4. Check consequence thresholds.
5. Log the delta and reason.

### Consequences

If confidence drops below key thresholds:

- **< 50**: Party discipline weakens. Whip effectiveness reduced.
- **< 35**: Challenge risk. Rival factions may openly oppose the leader.
- **< 25**: Appointment resistance. New Premier/State Council appointments face procedural delays.
- **< 15**: Forced crisis. Special NPC session may be called. Transition mechanics activate.

### Strategy tips

- Stack policy alignment early. A strong first mandate makes everything easier.
- Time purges carefully. Never purge when confidence is already below 60.
- Process purges quickly. The -2/turn backlog compounds fast.
- Prioritize Stability and Growth if you want a safe, boring, high-confidence run.
- Prioritize Anti-Corruption and National Security if you want to play aggressively, but be ready for the confidence cost.
`,
  },
  {
    slug: "china-state-council",
    title: "State Council & Cabinet",
    description: "How China's executive works in the game.",
    category: "Mechanics",
    tags: ["china", "state-council", "cabinet", "premier", "executive"],
    content: `## State Council

China's executive is the **State Council** (国务院), headed by the **Premier** (国务院总理).

### How the Premier is appointed

1. The CPC Central Committee recommends a candidate.
2. The NPC Standing Committee appoints the Premier.
3. The Premier then nominates Vice Premiers and State Councilors.
4. The NPC Standing Committee confirms the nominees.

In game terms, this is handled through the standard confidence-of-the-legislature executive formation process, but with one-party constraints:
- Only the CPC chair can nominate a Premier.
- United Front parties cannot form government or trigger no-confidence votes.
- The government never "collapses" due to seat loss. Crises work through CPC confidence instead.

### Cabinet roles

| Role | English | Chinese |
|------|---------|---------|
| Premier | Premier of the State Council | 国务院总理 |
| Vice Premier | Vice Premier | 国务院副总理 |
| State Councilor | State Councilor | 国务委员 |
| Minister | Minister of [portfolio] | [portfolio]部长 |

### Differences from parliamentary cabinets

- **No coalition partners.** All cabinet members are CPC.
- **No confidence votes.** The NPC does not vote no-confidence in the State Council. Confidence is tracked internally via the CPC confidence system.
- **Fixed terms.** The State Council serves a 5-year term aligned with the NPC cycle, not a turn-by-turn confidence cycle.
- **Party first, state second.** Cabinet appointments reflect CPC Politburo Standing Committee priorities, not parliamentary arithmetic.

### Gameplay

- As a CPC member, you can be appointed to cabinet positions based on seniority, region, and faction alignment.
- Cabinet members get policy influence bonuses.
- The Premier's confidence is especially important: a weak Premier weakens the entire State Council.
`,
  },
];

export async function seedCNWiki(db: Db) {
  const coll = db.collection<WikiPage>("wikiPages");
  const now = new Date();

  for (const page of CN_WIKI_PAGES) {
    await coll.updateOne(
      { slug: page.slug },
      {
        $set: {
          ...page,
          status: "published",
          featured: false,
          isAutoGenerated: false,
          viewCount: 0,
          createdAt: now,
          updatedAt: now,
        },
        $setOnInsert: {
          _id: new ObjectId(),
        },
      },
      { upsert: true }
    );
  }

  return { inserted: CN_WIKI_PAGES.length };
}
