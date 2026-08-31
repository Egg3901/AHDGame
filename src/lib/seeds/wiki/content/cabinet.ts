export const cabinetContent = `# Cabinet

The US Cabinet is a council of principal officers who lead the major executive departments. Each position is nominated by the President, confirmed by the Senate, and carries specific executive responsibilities. This page covers what each cabinet position is, how nominations work, and what cabinet members do in the game.

## Cabinet positions

Positions are ordered by presidential line of succession (after the Vice President). The live roster is **year-gated**: later departments (HUD, Transportation, Energy, Veterans Affairs, Homeland Security) unlock by year, and Education is carved out of HEW only when the Department of Education Act passes. The table is the full succession list; not every seat exists in every era.

| # | Position | Department focus |
| --- | --- | --- |
| 1 | Secretary of State | Foreign policy and diplomacy |
| 2 | Secretary of the Treasury | Federal finances, tax collection, economic policy |
| 3 | Secretary of Defense | Armed forces and military operations |
| 4 | Attorney General | Law enforcement, Department of Justice |
| 5 | Secretary of the Interior | Federal lands, natural resources, Native American affairs |
| 6 | Secretary of Agriculture | Farming, forestry, food safety, SNAP |
| 7 | Secretary of Commerce | Economic growth, trade, patents, NOAA |
| 8 | Secretary of Labor | Workers' rights, OSHA, unemployment |
| 9 | Secretary of Health, Education, and Welfare | Public health, education, and welfare (HEW). Becomes HHS only after the Department of Education Act splits Education off |
| 10 | Secretary of Housing and Urban Development | Affordable housing, fair housing enforcement |
| 11 | Secretary of Transportation | Highways, FAA, railroads, mass transit |
| 12 | Secretary of Energy | Energy policy, nuclear security, national labs |
| 13 | Secretary of Education | Federal education funding, student loans |
| 14 | Secretary of Veterans Affairs | Veterans healthcare, benefits, GI Bill |
| 15 | Secretary of Homeland Security | Border security, FEMA, cybersecurity |

## How nominations work

The nomination process has three stages:

### 1. Presidential nomination

Only the character currently holding the **President** office can nominate candidates for cabinet positions. The President selects a character (player or NPP) and submits the nomination from the executive dashboard.

- A nomination creates a pending **cabinet nomination** record for the position.
- Only one nomination per position can be pending at a time.
- The President can withdraw a nomination before the Senate vote closes.

### 2. Senate confirmation

Once nominated, the candidate enters the Senate confirmation process. See [Confirmation Process](/wiki/confirmation-process) for the full mechanics of the confirmation vote.

### 3. Taking office

When the Senate confirms a nomination, the character is installed as the cabinet member. Their current office is updated, and the position appears as filled on the executive dashboard.

## Parliamentary equivalent (UK / JP / DE / IE)

In parliamentary countries (UK, JP, DE, IE), the Cabinet is formed differently. The Prime Minister, Chancellor, or Taoiseach appoints cabinet members directly after government formation, because those countries lack the US-style Senate confirmation step. Instead, cabinet composition is tracked through the government formation record.

Japan additionally has a **Cabinet Bills** mechanic: cabinet members can propose bills via a cabinet review step before they enter the Diet. The UK and Germany do not model this; their cabinet members propose bills through the standard chamber flow like any other member.

## What cabinet members do

Cabinet members have both structural roles and active executive mechanics:

**Structural:**
- Occupy a named executive office, contributing to their character's profile and political career arc
- Receive notifications relevant to their department (e.g., budget-related events for Treasury)
- Appear in the executive branch listing visible to all players

**Active mechanics (live):**
- **Ministerial orders**: Each cabinet position can issue department-specific orders that apply metric modifiers nationally or to target regions. Orders cost **1 cabinet action** and last a fixed number of turns.
- **Tier settings**: Positions with tiered policy levers can set a national policy tier that applies passive metric modifiers every turn without consuming actions.
- **Regional targets**: Positions can designate a target region for focused policy effects, with optional non-target penalties to create zero-sum trade-offs.
- **Projects & buildings**: Most seats can build persistent assets: portfolio facilities like schools, hospitals, and embassies (estates), power plants (the energy seat), or multi-turn infrastructure projects (the transport seat). Each asset nudges its region's metrics every turn, and total upkeep is weighed against your ministry's budget envelope. See [Cabinet Projects & Buildings](/wiki/cabinet-projects) for the full guide.

**Action economy:**
- Cabinet members receive **cabinet actions** (or ministerial actions in parliamentary systems), capped at **4**.
- Actions refill daily at midnight Eastern, not 1 every 24 turns.
- Orders and other active mechanics consume 1 action each.

**Future / partially implemented:**
- Department-specific influence actions and confirmed-cabinet NPI generation are planned.

## Cabinet vacancies

A cabinet position becomes vacant when:

- The Secretary resigns or is removed by the President
- The President is vacated (upon a new President taking office, all cabinet positions reset)
- An election cycle changes the White House party (standard practice: all secretaries submit resignation letters)

When vacant, the position is open for a new presidential nomination. The turn processor never auto-fills cabinet positions; the President must actively nominate, or bridge the gap with an acting appointment.

## Acting secretaries

A President can seat an **acting secretary** in a vacant cabinet seat directly from the cabinet page, without a Senate vote. The appointment exists to stop a department going dark while confirmation is pending, and it is deliberately a caretaker post:

- **One acting appointment per office per term.** When it lapses the seat falls vacant again and the charge is not given back, so that office can only be filled by Senate confirmation for the rest of the term.
- **It lasts 24 turns.** The cabinet page shows an Acting badge with the turns remaining.
- **It needs a vacant seat.** An acting appointment cannot remove a sitting confirmed secretary, cannot install a nominee the Senate has already rejected, and cannot fill a department that does not exist in the current era.
- **Confirmation always wins.** An acting appointment does not cancel a pending nomination, and when the Senate confirms someone they replace the acting secretary at once.
- **It runs the department, it does not commit it.** An acting secretary can issue ministerial orders, move and assign units, declare offensives, recruit, set funding levels and split an appropriated budget. They cannot change the department's stance, commission or dismiss commanders, adopt doctrine, move the nuclear programme, award or cancel defence contracts, run debt operations, or open, close and expand estates, plants and infrastructure projects. A locked control says so where it sits.
- **It costs approval.** Each acting secretary on the books costs half a point of national approval, shown as its own line on the rating. An empty cabinet costs far more. See [Government Approval](/wiki/government-approval).

## Strategic considerations

### For the President

- **Fill critical positions first.** Secretary of State and Secretary of Defense affect foreign policy events. Treasury and HHS matter for economic and healthcare metric events.
- **Nominate allies.** Cabinet members are among the most visible appointed officials. Placing political allies in these roles strengthens your faction and denies the seats to rivals.
- **Watch for Senate blocking.** If the opposing party holds the Senate, confirmation votes become the battlefield. See [Confirmation Process](/wiki/confirmation-process).

### For senators

- **Cabinet confirmation votes** are a major source of legislative leverage. Blocking a cabinet nominee is one of the most effective tools of opposition politics.
- **Vote trading**: agreeing to confirm a nominee in exchange for Presidential support on a bill is a classic bargain.

### For cabinet nominees

- **Confirmation is not guaranteed.** Your favorability, policy positions, and political connections all matter. Build Senate relationships before the President nominates you.

## Related pages

- [Cabinet Guide](/wiki/cabinet-guide): every country's cabinet posts, the metrics each influences, and every action each can take
- [Confirmation Process](/wiki/confirmation-process): How the Senate confirmation vote works
- [Bills & Legislation](/wiki/bills-legislation): Cabinet bills in Japan (parliamentary systems may include this; UK and DE do not)
- [Congress Leadership](/wiki/congress-leadership): The Senate Majority Leader's role in scheduling confirmation votes
- [Government Formation](/wiki/government-formation): How the parliamentary Cabinet (UK/JP/DE/IE) is appointed without a Senate confirmation step
`;
