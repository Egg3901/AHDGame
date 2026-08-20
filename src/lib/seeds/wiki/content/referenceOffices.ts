export const referenceOfficesContent = `# Reference: Offices

Complete reference for all playable offices across the six active countries (US, UK, DE, JP, CN, IE). Each entry shows how the office is won, term length, action bonus, and what it does for your character. Central bank chair roles are included: they are not elected through standard elections.

---

## United States

The US uses a **presidential system** with directly elected executives. The legislature is bicameral: Senate (upper) and House (lower). Sub-national offices include Governor and State Senator.

### President

| Field | Value |
|---|---|
| Won by | National general election (Electoral College, 270/538 votes to win) |
| Term | 4 years (192 turns) |
| Action bonus | +4/turn |
| Party strength weight | 1.0 |

The President is the most powerful office in the game. Winning requires a national campaign, strong NPI, and party organization in swing states. Cabinet nominations are made by the President and confirmed by the Senate. The President can veto federal legislation. Presidential approval feeds into national approval ratings.

**Running mate:** After winning the primary, the nominee selects a Vice President. The VP cannot be the sitting President and cannot be the same person as the nominee.

### Vice President

| Field | Value |
|---|---|
| Won by | Appointed by the President-elect after winning the primary |
| Term | 4 years (with President) |
| Action bonus | +2/turn |
| Party strength weight | 1.0 |

The VP presides over the Senate and succeeds the President if the seat becomes vacant.

### US Senator

| Field | Value |
|---|---|
| Won by | State general election (FPTP, single-seat) |
| Term | 6 years (288 turns) |
| Action bonus | +2/turn |
| Party strength weight | 0.8 |
| Chamber | U.S. Senate (100 seats) |

Senate seats are staggered across 3 classes, so only one class is up in any given election cycle. Senators serve 6-year terms; confirming Cabinet and judicial nominees requires a Senate majority. Leadership positions (Majority Leader, Minority Leader, Whip) are available to Senators.

### US Representative (House)

| Field | Value |
|---|---|
| Won by | State general election (FPTP or proportional by state) |
| Term | 2 years (96 turns) |
| Action bonus | +1/turn |
| Party strength weight | 0.9 |
| Chamber | U.S. House of Representatives (435 seats) |

The shortest term in the US system: House members are up for election every 2 game years. Revenue bills must originate in the House. The Speaker of the House is elected by House members.

### Governor

| Field | Value |
|---|---|
| Won by | State general election |
| Term | 4 years (192 turns) |
| Action bonus | +2/turn |
| Party strength weight | 1.0 |
| Sub-national | Yes |

Governors sign or veto state bills and control their state's executive. Holding a governorship gives you a 1.0 party-strength weight (the same as President) in state-level vote calculations. Governors are a strong stepping stone to Senate.

### State Senator

| Field | Value |
|---|---|
| Won by | State general election |
| Term | 4 years (192 turns) |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Sub-national | Yes |

State Senators vote on state-level legislation and fill the state legislature. Controlling a state legislative majority allows your party to pass state bills more easily.

### Federal Reserve Chair

| Field | Value |
|---|---|
| Won by | Presidential appointment (selected by central bank chair selection phase) |
| Term | 4 years |
| Action bonus | +3/turn |
| Party strength weight | 0 (non-political) |

The Fed Chair sets US interest rates, which affect bond yields, corporate borrowing costs, and the USD exchange rate. This is the highest action-bonus non-executive office. The chair is selected based on economic track record and presidential favor.

### US Cabinet positions (15 offices)

Cabinet members are nominated by the President and confirmed by the Senate. They hold no action bonus themselves: the value is influence and access. The 15 Cabinet positions in succession order:

| # | Position |
|---|---|
| 1 | Secretary of State |
| 2 | Secretary of the Treasury |
| 3 | Secretary of Defense |
| 4 | Attorney General |
| 5 | Secretary of the Interior |
| 6 | Secretary of Agriculture |
| 7 | Secretary of Commerce |
| 8 | Secretary of Labor |
| 9 | Secretary of Health, Education, and Welfare (HHS after the Education Act splits Education off) |
| 10 | Secretary of Housing and Urban Development |
| 11 | Secretary of Transportation |
| 12 | Secretary of Energy |
| 13 | Secretary of Education |
| 14 | Secretary of Veterans Affairs |
| 15 | Secretary of Homeland Security |

The Secretary of the Treasury is the Finance Minister equivalent and can authorize FX Reserve Transfers.

---

## United Kingdom

The UK uses a **parliamentary system**. The Prime Minister emerges from a Commons majority, not direct election. All elections use FPTP from single-member constituencies.

### Prime Minister

| Field | Value |
|---|---|
| Won by | Appointed as leader of the party/coalition holding a Commons majority (326+ seats) |
| Term | No fixed term (parliamentary system) |
| Action bonus | +4/turn |
| Party strength weight | 1.0 |

The PM is the head of government. No direct election: you must become your party's leader and your party must control the Commons. Snap elections can be called by the PM. The PM's favorability drives national approval ratings.

### Member of Parliament (Commons)

| Field | Value |
|---|---|
| Won by | Constituency general election (FPTP, single-seat) |
| Term | Up to 5 years (variable, parliamentary dissolution) |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Chamber | House of Commons (650 seats) |

The primary legislature. Three candidates advance from UK primaries (vs 1 in the US), making primaries more competitive. All 650 seats are contested in each general election (no staggering).

### Regional Councillor

| Field | Value |
|---|---|
| Won by | Regional Council general election |
| Term | Up to 5 years |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Sub-national | Yes |

Regional Councillors represent UK nations and regions in devolved assemblies. Regional legislation is signed by the First Minister of each nation.

### Governor of the Bank of England

| Field | Value |
|---|---|
| Won by | Central bank chair selection (PM appointment) |
| Term | 4 years |
| Action bonus | +3/turn |
| Party strength weight | 0 (non-political) |

Sets UK interest rates. Equivalent role to the Fed Chair in the US.

---

## Germany

Germany uses a **parliamentary system** with **mixed-member proportional representation (AMS)** for the Bundestag. This makes third parties far more viable than in FPTP countries. The Bundesrat (upper house) is appointed by state governments, not elected.

### Chancellor

| Field | Value |
|---|---|
| Won by | Elected by Bundestag majority after federal election |
| Term | 4 years (legislative term) |
| Action bonus | +4/turn |
| Party strength weight | 1.0 |

Germany's head of government. The Chancellor is elected by a Bundestag majority vote, not by direct election. Coalition governments are common given AMS proportionality. The Chancellor's favorability drives national approval ratings.

### Member of Bundestag (MdB)

| Field | Value |
|---|---|
| Won by | Bundestag election (AMS proportional) |
| Term | 4 years (192 turns) |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Chamber | Bundestag (630 seats) |

The German lower house. AMS means seats are allocated proportional to party vote share, so winning a constituency vote doesn't guarantee you a seat: list ranking matters too. Third parties regularly win seats.

### Minister-President

| Field | Value |
|---|---|
| Won by | State-level election |
| Term | 5 years (240 turns) |
| Action bonus | +2/turn |
| Party strength weight | 1.0 |
| Sub-national | Yes |

The chief executive of a German state (Land). Equivalent to a US Governor. Signs state legislation and controls state executive functions.

### President of the ECB

| Field | Value |
|---|---|
| Won by | Central bank chair selection |
| Term | 4 years |
| Action bonus | +3/turn |
| Party strength weight | 0 |

The ECB is a **shared central bank**: the European Central Bank governs the Euro for both Germany and any other Eurozone countries in the game. Setting ECB interest rates affects EUR across all countries using that currency.

---

## Japan

Japan uses a **parliamentary system** with two elected chambers. The Shūgiin (lower house) can be dissolved and is where PM confidence is established. The Sangiin (upper house) has staggered elections and cannot be dissolved.

### Prime Minister

| Field | Value |
|---|---|
| Won by | Elected by Shūgiin majority after election |
| Term | No fixed term (parliamentary system) |
| Action bonus | +4/turn |
| Party strength weight | 1.0 |

Head of government. Must hold a Shūgiin confidence majority (233+ seats). The Shūgiin can be dissolved for snap elections. The PM's favorability drives national approval.

### Member of the House of Representatives (Shūgiin)

| Field | Value |
|---|---|
| Won by | Regional constituency election (FPTP) |
| Term | Up to 4 years (variable, snap elections allowed) |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Chamber | Shūgiin (465 seats) |

Three candidates advance from JP primaries per party (same as UK). This is the confidence-giving chamber: PM survival depends on Shūgiin support.

### Member of the House of Councillors (Sangiin)

| Field | Value |
|---|---|
| Won by | Regional constituency election (FPTP) |
| Term | 6 years (288 turns, half contested every 3 years) |
| Action bonus | +1/turn |
| Party strength weight | 0.85 |
| Chamber | Sangiin (248 seats) |

Staggered 6-year terms, 124 seats contested per cycle (2 classes). The Sangiin **cannot be dissolved**: snap elections do not affect Sangiin seats. The Sangiin revises legislation but cannot override the Shūgiin on confidence matters.

### Governor (Japan)

| Field | Value |
|---|---|
| Won by | Regional election |
| Term | 6 years (288 turns) |
| Action bonus | +2/turn |
| Party strength weight | 1.0 |
| Sub-national | Yes |

Japan's regional chief executives. Signs regional legislation; controls regional budget allocations.

### Governor of the Bank of Japan

| Field | Value |
|---|---|
| Won by | Central bank chair selection (PM appointment) |
| Term | 5 years |
| Action bonus | +3/turn |
| Party strength weight | 0 |

Sets Japanese interest rates (BoJ default prime rate: 0.25%). Controls JPY monetary policy.

---

## Related

- [Multi-Country Play](/wiki/multi-country-play): Playing across multiple country contexts.
- [Advanced Strategy](/wiki/advanced-strategy): Career arc planning by office.
- [Reference: Formulas](/wiki/reference-formulas): Primary score formulas and action math.
- [Election Mechanics](/wiki/election-mechanics): Full election phase structure.
- [Snap Elections](/wiki/snap-elections): UK, JP, and DE parliamentary dissolution.
`;
