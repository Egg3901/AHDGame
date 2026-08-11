# What's New

# Beta 2

## v0.3.6 - 2026-06-27

### Tech Trees

Every corporation now has a **Tech** tab. Your sector tech tree is a grid of researchable
upgrades organized into six decade tiers — from the 1979 era all the way to 2029 — that
unlock as the game world's calendar advances. Each tier forks into two lanes: a **Corporate**
lane of generic business upgrades (automation, analytics, procurement, logistics) shared
across all your sectors, and a **Sector** lane of specialist R&D unique to what your
corporation actually does — energy, manufacturing, finance, media, pharma, and the rest.

You commit to one lane the moment you make your first unlock in a decade. The choice is
permanent unless you abandon that decade entirely and start the tier over from scratch, so
pick your path deliberately.

Unlocking a node spends two resources: **R&D Score** (earned through research operations)
and **cash** drawn as a fraction of your daily gross revenue. Cheaper tiers cost less;
late-game nodes are serious investments. Effects are cumulative — a fully-researched
corporate lane can add up to 8 percentage points to your profit margin and halve your
expansion costs — but the gains are capped so no single company can run away with the
economy.

- **What nodes do.** Each node applies one or more effects: a profit-margin bonus, a
  growth-cost reduction, a cut to how much of a commodity your production consumes, a boost
  to how much your production outputs, or flat increases to your marketing or logistics
  strength. Effects from the Corporate lane apply at half strength across all your sectors;
  Sector-lane effects hit your primary sector at full strength.

- **Tech-gated production methods.** Some advanced production methods — nuclear power,
  fracking, renewables, smart grids, AI platforms, quantum computing, fusion — are locked
  until your corporation researches the node that unlocks them. If the world has already
  moved past a method's decade, it unlocks automatically for everyone; only methods in the
  current or future era require the research investment.

- **Existing corporations get a head start.** Any corporation already operating when tech
  trees went live was automatically granted the appropriate early-decade Corporate nodes for
  the eras that have already passed, so no one starts the system with a blank slate.

### ⚙️ Mechanics

- **Defaulted corporations can now restructure their debt instead of dissolving.** When a
  corporation defaults on its bonds, the CEO can choose to restructure: the game liquidates
  the minimum set of highest-value sectors needed to repay bondholders in full at an 85%
  orderly-sale recovery rate, then cures the bonds and keeps the corporation alive on what
  remains. This is only offered when the value is actually there to cover the debt — if not,
  dissolution is still the only path. Corporations that stay in default across turns are
  now auto-restructured when feasible, so walking away from bondholders no longer works as
  a strategy.

### 🐛 Bug Fixes

- **Foreign-currency bond values were wildly inflated.** Bond holdings and holder values
  on the Bonds tab were shown in the bond's own currency (yen, pounds) without converting
  to anchor units, so JPY bonds appeared roughly 100× too high. Both now normalize correctly.

- **Abandoning a CEO no longer leaves the corporation's bond debt stranded.** Deleting a
  CEO character used to vacate the seat while leaving any outstanding bonds unpayable — the
  corp became a zombie that couldn't be dissolved or taken over. CEO-led corporations with
  outstanding bonds now run the full bond-default settlement waterfall on abandonment:
  bondholders are paid first, remaining assets go to shareholders, and the corporation is
  cleanly removed.

### Fixed

- **Education policy now actually moves the needle.** Bills that raise or cut education
  spending were barely affecting things like high school graduation rates or test scores,
  even when you swung funding from one extreme to the other. The underlying spend-to-outcome
  math has been recalibrated against real budget numbers, so a well-funded (or defunded)
  education system now produces a noticeably different outcome than before.
- **Healthcare spending policy now noticeably moves healthcare outcomes.** Enacting healthcare
  legislation — funding Medicare/Medicaid, public health, or state health programs — barely
  budged things like physician availability, healthcare affordability, or life expectancy, no
  matter how much you spent. The response to funding was tuned against unrealistically tiny
  spending figures, so it was already maxed out at real-world budget levels. It's now calibrated
  against the actual per-capita spending range achievable through healthcare bills, so funding
  levels have a real, noticeable effect on outcomes.
- **Infrastructure spending now noticeably moves infrastructure metrics.** Road condition, water
  quality, broadband access, and related metrics used to barely budge no matter how much (or how
  little) you funded infrastructure — the response to spending was calibrated so tightly it was
  effectively pinned near the top regardless of your budget. Infrastructure bills now have real,
  visible impact on these metrics as you move spending across a realistic range.
- **Environment policy now actually moves the needle.** Clean energy, conservation, and state
  environmental bills were barely affecting air quality, carbon emissions, or the energy
  transition no matter how much you spent — the response was already maxed out at realistic
  budget levels. Environment spending now has real room to move those metrics as you invest
  more, so bills in this area feel meaningfully different from doing nothing.
- **Public-safety spending policies now noticeably move public-safety outcomes.** Police funding,
  criminal-justice reform, and prison-rehabilitation bills were tuned against a scale so far off
  from their real per-capita cost that enacting one barely nudged crime rates, police staffing, or
  public confidence — spending anywhere in a bill's realistic range landed you at essentially the
  same result. The response curve is now calibrated to the real dollar range these bills actually
  spend, so pushing funding up or down within that range produces a genuine, visible change.
- **Social Security and welfare bills now noticeably move the metrics they're meant to affect.**
  Legislation touching Social Security and welfare spending — income inequality, child poverty,
  homelessness-adjacent outcomes, recidivism, pension stability, and the national poverty rate —
  used to move those numbers by only a hair, no matter how big the bill. The underlying spending
  response has been rebalanced against real budget scales, so social/welfare policy choices now
  produce a real, visible difference.
- **State labels on the US map no longer float out into the ocean.** States with islands, peninsulas,
  or complex coastlines (Michigan, Hawaii, Louisiana, Washington, and others) could get their name
  label placed off the actual landmass. Labels are now placed correctly on the state's main body.

- **Public safety metrics could get stuck reading impossible numbers, like violent crime or the
  incarceration rate outranking overall crime.** A national metric's internal tracking could drift
  outside its normal range and stay stuck there indefinitely, eventually producing results that
  didn't add up (e.g. crime subsets reading higher than the overall crime rate they're part of).
  This internal tracking is now kept within each metric's proper range so it can't get permanently
  stuck out of bounds.

- **Debate challenge prompts no longer linger after the election ends.** A debate challenge tied
  to a primary or general election could keep showing on the Actions page — with a live countdown
  and a working "Commit strategy" button — even after that race had already been decided. Debate
  challenges are now cleared the moment the election they're tied to resolves.

- **State party chair seats no longer get stuck after the chair leaves.** Retiring or leaving your
  party while holding a state chair, vice chair, or treasurer seat used to leave that seat
  permanently locked — the game still thought you held it, so nobody else could be appointed.
  Leaving now properly clears any state-level leadership seat you held.

- **Tech tab now marks old decades as inert instead of leaving them looking active.** Only your
  current and immediately previous decade's tech still gives ongoing bonuses — anything older is
  permanent history. Older decades in your tech history now show a "Historical decade — no longer
  providing bonuses" overlay so it's clear at a glance which lanes are still live. Permanently
  unlocked production methods aren't affected and still show in the Production Methods summary.

- **Index fund financials now make clear who a redemption total belongs to.** The fund Income
  Statement's "Unit redemption" line is a fund-wide total across every holder, not a personal
  transaction receipt — the subtitle now says so, and queued redemptions that are only partially
  paid out are now tracked with their own status instead of looking identical to a fresh request.

- **Presidential primary endorsements now stick to the right candidate.** Endorsing (or
  switching your endorsement) in a presidential primary was recording the candidate's character
  id instead of the candidate row id, so the "Endorsed" column stayed at "—" and the Switch
  button never showed who you had endorsed. Endorsements now use the correct candidate id.

- **Global leaderboard nation income now actually converts currencies.** Toggling the display
  currency on the Nations leaderboard had no effect on Median Income — every nation's raw
  local-currency figure was shown regardless of your selected currency. It now converts properly.

- **Political Operations state organization build cooldown now follows the turn boundary.** Building
  a state no longer locks you out for the remainder of the current turn and part of the next; you
  can build again as soon as the next turn begins.

- **Private sale offers no longer get stuck invisible.** A wall-clock/turn-count mismatch could
  leave a share listing hidden from your own "Your Active Listings" panel — showing "No offers
  yet" — even while a buyer's offer had gone through and you'd gotten the notification for it.

### 🎨 UI

- **Presidential primary map now has a Delegates mode.** The map on each party's primary page
  now has a `Leader` / `Delegates` toggle. In Delegates mode every state is labeled with its
  delegate count and the tooltip breaks down how many delegates each candidate is projected to
  win (or has already won), so you can spot the big prizes at a glance instead of clicking
  every state detail page.

### 🔒 Security & Stability

A hardening pass tightened several low-level surfaces: SVG uploads are no longer accepted
(preventing a stored-XSS vector), external image proxying now validates against a private-IP
block list to prevent SSRF, two admin data endpoints that returned configuration without
checking auth are now gated properly, logout revokes the session server-side immediately,
and the universal search endpoint is rate-limited. Money flows now alert when running
without database transactions so any atomicity gap is visible rather than silent.

## v0.3.5 - 2026-06-23

### Independence Update

The future of the Union is now fully in players' hands. Northern Ireland can hold a referendum to
leave the United Kingdom and reunify with the Republic of Ireland — and, new this update, Scotland
and Wales can do the same to stand up as independent countries of their own. Once Reunification or
Independence Desire runs high enough, the First Minister can call a referendum; if it carries and
Westminster consents, the change takes effect and the world map redraws around the new borders.

When Northern Ireland reunifies, it leaves the UK and joins Ireland as a province of the Republic.
When Scotland or Wales votes for independence, the new nation arrives fully formed:

- **Its own parliament.** The Scottish Parliament (Holyrood) and Senedd Cymru get full legislature
  pages — chamber composition, leadership, and the bill floor — and the First Minister becomes head
  of government.
- **Its own elections.** Each nation runs its own parliamentary, regional leadership (Provost in
  Scotland, Leader in Wales), and Regional Council elections on their proper cycles.
- **Its own regions.** Every macro-region — Greater Glasgow, the Highlands, the Valleys, Cardiff and
  the rest — now carries distinct demographics, a full census profile, and its own turnout. Glasgow
  reads post-industrial and diverse, the Highlands rural and older, the Valleys an old-Labour
  heartland, and so on.
- **The right money, parties, and maps.** An independent Scotland and Wales keep the pound, the SNP
  and Plaid Cymru carry over with their proper colours and logos, and the world and home maps redraw
  cleanly around the new borders.

**A First Minister's record now moves the national question.** While a nation is still inside the UK,
how popular its devolved government is now pushes Independence and Reunification Desire in the
direction of the First Minister's chosen Devolution policy. A popular pro-independence (or
pro-reunification) First Minister builds momentum to leave; a popular unionist one steadies the
Union; and an unpopular government does the reverse — a failing separatist loses the cause ground,
while a resented unionist stokes the backlash.

### 🏛️ Cabinet Office Update

A major overhaul of the Cabinet Office: every minister's seat is redesigned and most now have real, hands-on tools to run their department.

- **Redesigned Cabinet Office.** Every minister's office is now a tabbed "dossier" with a redesigned masthead, an at-a-glance stat strip, and a rail to browse every seat in the cabinet. Each seat's specialist tools — military, estates, energy, infrastructure, or monetary — live in their own flagship tab, themed to your country.

- **Ministers can do more each week.** Every cabinet seat now gets up to 4 actions per cycle (up from 2), so running a department is less about waiting and more about doing.

- **Defense — command a real armed force.** The defense seat now runs a full order of battle. Recruit units, modernize their tech, set each unit's posture (garrison, standard, forward, or alert), station them across your regions, or disband them. Your force's combat power and readiness feed national public-safety confidence; forward-deployed units trade civic cohesion for public trust; and upkeep is weighed against the defense budget. A national readiness tier scales the whole force at once.

- **Domestic ministers can build and run public estates.** Education, health, justice, interior, agriculture, commerce, labor, housing, veterans, and homeland seats can now open facilities and programs across their country's regions — schools and universities, hospitals and clinics, courts, parks, jobs centers, housing projects, and more. Fund each at reduced, standard, or enhanced levels and expand it over time; each lifts its host region's relevant metrics, with running costs drawn against the ministry's budget. Foreign affairs builds embassies and cultural institutes abroad that grow your soft power.

- **Energy ministers shape the national grid.** Build, upgrade, and retire power plants — coal, gas, nuclear, hydro, wind, and solar. Your national generation mix emerges from the fleet you build and steers renewable share, carbon output, and grid reliability in the regions where the plants sit.

- **Transport ministers run an infrastructure pipeline.** Start projects — highways, transit, bridges, broadband, freight, airports — that take several turns to build, and speed them up or slow them down with a per-project funding lever. Once complete, a project becomes a standing asset that keeps improving its region.

- **Departments now run on a real discretionary budget.** Each building seat — defense, estates, energy, infrastructure — gets a capital budget sized to a slice of its actual department funding, shown right on its Budget tab. A starter roster sits comfortably inside it, but keep expanding (more units, plants, projects, or estates — especially at higher tiers) and your upkeep eventually overruns the budget and drags your national budget balance. Building is no longer effectively free: scale is a real fiscal choice.

- **Finance ministers get a monetary dossier and a new lever.** The finance seat now has a single at-a-glance view of the central bank's prime rate, your sovereign borrowing rate (and the investor-confidence premium riding on it), FX reserves, and how much of the national debt your bonds cover. The new **Debt Management Operation** lets you spend an action to accelerate investor-confidence recovery after a shock — easing your borrowing-rate premium faster than it would heal on its own. Your bond-issuance profile and FX-reserve transfers now live here too.

- **Orders now show whether they're National or Regional.** Each cabinet order is tagged with its scope, and the region picker only appears on orders that actually target a region — so it's clear at a glance which orders hit the whole country and which boost a single region.

### 🌐 International Organizations Update

A full overhaul of International Organizations — the UN, NATO, the EU, and player-founded blocs all get redesigned pages and real diplomatic tools.

- **Redesigned organization pages.** Each org now opens to a dossier-style page: an **Overview** with your delegation's standing, a member table showing every country's contribution and influence, and the org's resolutions and elected leadership; plus a per-org **Flagship** tab that gives each bloc its own character and shows live data instead of placeholders. The top-level page lists every organization by category, highlights the ones your country belongs to, lets you found a new one, and carries a feed of resolutions across all orgs — and a **world map** lets you pick an organization to see its members, or click a country to see what it belongs to.

- **A diplomatic-action budget.** Foreign ministers now work from four diplomatic actions per turn — proposing a free-trade agreement, applying to join, or nominating a leader each spends one; voting stays free.

- **Every organization has a category.** Political, economic, security, or development — it shapes the dashboard and what the bloc can do. The UN, NATO, and EU are set; when you found a bloc you choose its category.

- **Joining, funding, and leaving go through your legislature.** These are raised from the org's page but must pass your national legislature on a simple majority. Joining is a two-part test — your members vote to admit the applicant _and_ the applicant's own legislature must ratify; if either fails, the other is called off with a reason.

- **Organization treasuries, in the right currency.** Members pay small annual dues (a slice of GDP, with the rate set by a member vote) into a shared fund held in the founding nation's currency — the EU's in euros, a player bloc's in its founder's currency — and transfers convert automatically at no cost. Dues now actually collect at the displayed amount, instead of a tiny fraction.

- **Sanctions.** Economic and security blocs can table a sanctions resolution against a country on a chosen commodity; if members pass it, every member embargoes that good, lifting automatically after about a year.

- **Aid packages.** Political, economic, and development blocs can vote to send aid from the fund to a member — crediting its treasury and giving a short-term growth boost (failing if the fund can't cover it).

- **Economic directives.** A member can table a standing directive — a Productivity Compact, Price Stability Pact, Cohesion & Convergence Funds, Solidarity Framework, or Green Transition — that, once passed, gently shifts that policy area across every member for about two years before lapsing (renewable with a fresh vote).

- **Joint statements.** Political and security blocs can endorse or condemn any country; a passed statement moves that government's approval — up for an endorsement, down for a condemnation — for about half a year before it fades.

- **Funded global agencies.** A political bloc can fund a programme — humanitarian relief, development, a climate fund, or culture and education — from the pooled treasury, giving every member a modest boost in that area for about a year.

- **Defense alert posture.** Defense alliances can vote between Reduced, Standard, Heightened, and Article 5; a higher posture raises every member's military readiness at a cost to civil liberties (and, at Article 5, to growth). The flagship page shows each member's defense spending against the 2% pledge.

- **The UN's founding powers hold a veto.** At the UN, a single "no" from a permanent member blocks a sanctions resolution or joint statement.

- **Real organization emblems.** The UN, EU, and NATO show their actual emblems, and you can upload a logo when you found your own bloc.

### ⚙️ Mechanics

- **Propose Custom bills for flavor.** Every legislature — national and state, in every country — now
  has a "Custom" bill category. It has no game effect: just write a title and summary for roleplay,
  declarations, resolutions, or fun. It still goes to a normal vote like any other bill.

- **Unpopular governors now pay at the ballot box.** A sitting governor's approval now shapes their
  re-election. Popular governors keep an incumbency edge; deeply unpopular ones face an
  anti-incumbency penalty instead of a free advantage. (Presidential approval already swayed that
  race; legislative races are unchanged.)

- **Cabinet ministers refill their actions every morning.** A minister's action pool now resets to
  full at midnight Eastern each day, instead of slowly trickling back one action every 24 turns. The
  Cabinet Office shows exactly when your next reset lands, so you can plan a busy day around it.

- **Debates are now one decisive choice.** Instead of stacking up to three strategies, you commit to a
  single approach — and so does your opponent. The three options are balanced so your strongest stat
  points to your best play: lead with **Attack** if you're a strong debater, **Remain above the fray**
  if you're charismatic, or **Tout your record** if you're an accomplished incumbent. Pick the one
  that fits you and own it.

- **Non-player parties pull their weight again.** The AI-run parties that fill out the political
  landscape were quietly fading — their campaigning and advertising landed at half a real player's
  effect, and their influence bled away faster than they could rebuild it. They now campaign and
  advertise at full player strength (with the same diminishing returns on heavy ad spend), and their
  political influence no longer drifts toward zero. Expect rival and minor parties to feel more alive
  and harder to ignore.

- **Stats no longer waste away when you're idle.** Your character's stats used to slowly decay just
  from not using them; that passive drain is gone (only debate skill still fades over time). Instead,
  stat losses now come from events you can see coming — a crisis like a political scandal can knock
  down the stats it touches (a scandal dents your charisma and statecraft, for example), so when a
  stat drops you'll know why.

- **Chair-initiated party purges are turned off for now.** The option for a party chair to purge
  members is disabled while the mechanic is reworked, so it no longer appears in the Chair Office.

- **Inactive players step aside so the game keeps moving.** When a player goes quiet for a long
  stretch (about 96 turns), the game now clears them out of the way: their election candidacies are
  withdrawn so they don't sit dead in a race or get auto-entered again, they're no longer
  automatically run for re-election, they drop off party membership rosters, and they stop holding a
  state's Political Strength cap. It's a clean hand-off, not a punishment — if they come back, they
  simply re-enter races themselves.

- **Contest is gone — Build Org now does both.** The separate Contest action has been retired and
  folded into Build Org. Building your organization in a region now also chips away at rivals'
  organization there, and the preview shows the breakdown — how much is your own growth versus what
  you poach from each rival. A party's national strength now partly backs its regional defense too,
  so a nationally powerful rival holds its ground better even where its local strength is thin. The
  standalone Contest panels are gone from the state-party page and the National HQ bulk tools.

### 🌍 Content

- **Nigeria is coming to the map.** A new playable country is being scaffolded in — six geopolitical
  zones drawn on a real interactive map, a full National Assembly (360-seat House, 109-seat Senate),
  the major parties (APC, PDP, LP, NNPP, APGA), and a 2019 starting baseline. It's rolling out
  gradually and switched on by admins while it's tuned.

### 🎨 UI

- **The approval pages are now "Approval & Active Effects."** Renamed and rebuilt to show not just
  your approval but the active modifiers shaping it — including the sector margin effects that move
  your corporations' bottom line. National and state approval pages, the regional conditions card,
  the approval tooltip, and the sector drilldown now lay these out as labelled, icon-tagged chips
  with net approval and net margin totals, so you can see at a glance what's helping or hurting and
  by how much.

- **The World Trade Ledger's Restrictions tab now shows tariffs too.** Alongside active embargoes, the
  Restrictions view lists every standing tariff in force across the world — grouped by the nation
  imposing it, with the scope (economy-wide, a sector, goods from a specific country, or a single
  corporation) and the rate. Trade barriers now read in one place instead of only embargoes.

- **The crisis Actions list only shows what you can act on.** Ambient, non-interactive crises no
  longer clutter your Actions page — they still play out in the world and on the Crises page — and a
  crisis you've resolved drops off the list automatically instead of lingering.

- **New "sector sold" alert.** When one of your corporation's sectors is sold off, you now get a
  notification in your inbox.

- **Filter expansion markets by country.** When you expand your corporation into a new market, you
  can now filter the suggestions by country. Every country with a market in that sector is selectable,
  and picking one surfaces its best markets — even ones that weren't in the global top list — instead
  of just narrowing what was already on screen. Leave it on "All" to see everything.

### 🐛 Bug Fixes

- **Cabinet ministers can issue their national orders again.** Standing orders that apply across the
  whole country — rather than to a single region — were rejected the instant you clicked "Issue
  Order," with a validation error. They now go through. And if a region-specific order still needs a
  target you haven't selected, the game asks you to pick one up front instead of quietly spending one
  of your ministerial actions on an order that would have done nothing.

- **You can actually pick your debate strategy now.** Debate challenges on your Actions page used to
  show up locked — disabled options under "Waiting on the other candidate" — for anyone who wasn't
  clicking around in-game at the exact moment the challenge appeared, which was almost everyone. Your
  side had already been auto-decided for you. Now every debate is yours to play: you have the full
  time on the clock to choose your strategy, and only if you let it run out does the game step in
  and pick for you. And once you've picked, coming back to the page shows your choice highlighted in
  green with a "You selected" badge, so you can always see what you locked in.

- **Players without a character always land in character creation now.** Whether you've just signed
  up, reset your account, retired, or lost your character to an in-game event, you're now reliably
  taken to the character-creation screen from anywhere in the game — instead of occasionally ending
  up on a page that didn't work for you. Players who already have a character are kept out of that
  screen so they can't accidentally make a second one.

- **Nationalized industries stay nationalized.** Several gaps let state-controlled sectors quietly
  re-fragment back into private or vacant hands after a nationalization. State monopolies now hold:
  stray private and unowned slices that crept into a nationalized market are folded back into the
  National Corporation, and the cleanup respects exactly what each nationalization law actually
  covered (an unowned-only law never sweeps up real private companies).

- **Fewer, better-paced crises.** Random crises spawn about half as often and are capped at one new
  one per turn, with natural disasters spread out more — so the world throws emergencies at you at a
  manageable rhythm.

- **A head of government who wins a legislative seat keeps their executive office.** Previously,
  taking a parliamentary seat could knock a leader out of their executive role; their head-of-state
  or head-of-government office is now preserved.

- **Party treasury figures now count Political Strength spending.** A party's net-income line
  includes the funds it invests into Political Strength, at both the national and state level, so the
  treasury picture adds up.

- **Resolved elections show their full results again.** A finished election used to render just the
  map and "0 votes cast" — no candidates, final tallies, or trend lines — because the cleanup that
  withdraws candidates after a race was hiding the real contestants. Resolved election pages now show
  the actual finishers with their results and trendlines.

- **Every leader now responds to a global crisis.** In a worldwide crisis (like an energy shock),
  only the first head of state to act used to be able to respond — and their choice was applied to
  the whole world. Now each nation's leader makes their own call, and it affects only their country.
  The crisis page shows a clean roster of how every leader responded.

- **Primary debates now stay in your own party.** During a primary you could be challenged to debate
  a candidate from another party's primary — someone you aren't actually running against. Debate
  challenges in the primary are now limited to your own party's field. (General-election debates are
  still you vs. the other party's nominee, as before.)

- **Debate results are more reliable.** Fixed a rare timing issue that could double-count a debate's
  favorability swing, and made debates between two human candidates resolve immediately when both
  submit — instead of occasionally waiting for the deadline.

- **Independence and Reunification Desire move again.** A bookkeeping conflict between two systems
  writing the same value could leave a nation's Independence or Reunification Desire stuck in place.
  The drift engine is now the single owner of that value, so the meter responds to events and to the
  First Minister's record as intended.

- **Spending and welfare bills now show the right effects.** A sign error (the same kind recently
  fixed for tax bills) meant some welfare, jobs, skills, and housing spending bills were modeled —
  and previewed in their projected-effect chips — as _worsening_ the very outcomes they exist to
  improve. The preview and the engine now move these in the correct direction.

## v0.3.4 - 2026-06-20

### ⚙️ Mechanics

- **Registration Drive action removed; passive Reg drift sped up to make up for it.** The
  PS-spending Registration Drive panel on state-party Overview and the State Politics tab is gone.
  Reg now grows the way it used to — automatically, as your Org grows — and the passive drift rate
  is up about 50% so the climb still feels noticeable each week. Focus on Build Org and Contest;
  Reg will follow.

- **Introducing character stats.** Your character now has six RPG-style stats — Charisma, Intelligence, Leadership, Business Acumen, Statecraft, and Resilience — that you build up over time. They're more than numbers: each one shapes what your character is good at and feeds directly into the new events and crisis systems below. Your profile breaks down what every stat does in plain terms, with tooltips showing exactly what it boosts and by how much at your current level, your current bonus, and your overall rating (Average, Above Average, and so on).

- **Change your stats once, for free.** Not happy with how you built your character? After your first allocation you get one free do-over, usable whenever you like. Hit "Reallocate" on your profile's Stats panel to redistribute all your points from scratch. Heads up: it's a full reset, so any growth you've earned through play goes back to your new starting spread — and you only get the one.

- **Introducing random events.** Between the big set-piece decisions, your character now runs into unexpected situations — a scandal to get ahead of, an opening to seize, a demand from your own shareholders — and you choose how to respond. Outcomes aren't scripted: your relevant stat (Charisma, Intelligence, Business Acumen…) tilts the odds, and the result card tells you which stat was in play and how much it helped. A new Random Events page in the wiki explains how it works.

- **Introducing the crisis system.** Major emergencies — disasters, scandals, political crises — now unfold as interactive events you actually steer, instead of things that just happen to you. Work through multi-step decisions where every option previews its likely effects before you commit, with a live countdown to the deadline. Some crises are collective — everyone affected can weigh in on the response — and your choices land for real when the turn resolves.

- **Character stats are fairer to build and keep up.** Using a stat now keeps it from slipping that
  turn, so practicing something never leaves you worse off than before. Energy reflects how active you
  actually are — stay busy and it climbs, go quiet and it fades. Business Acumen finally sticks while
  you're running a company instead of bleeding away, and it grows faster the more profitable your
  corporation is.

- **Business Acumen now makes your company cheaper to grow.** Instead of just padding revenue, a
  high-Acumen CEO pays less to expand their sectors — and shrugs off high interest rates that would
  otherwise make growth expensive. The growth-cost preview reflects your CEO's skill, so the price you
  see is the price you pay.

- **Getting better at debating is less of a grind.** Debate Prep now costs 1 action (down from 2) and
  succeeds more often, and the skill fades more slowly if you take a break. Best of all, you now get
  better at debating simply by debating — every election debate gives you a shot at improving, and
  winners gain more.

- **Natural disasters now happen automatically.** Regions get hit by realistic natural disasters — earthquakes, hurricanes, wildfires, floods — on a rolling schedule without any admin input. While a disaster is active, corporations operating in the affected region take an efficiency hit that fades each turn. This feature is rolling out gradually.

- **Minority shareholders push back when you own too much of your own company.** If a CEO holds more than 65% of a public corporation's shares, minority shareholders will now occasionally demand changes — a strategy pivot (naming your actual current and proposed strategy), expansion into a specific state where a shareholder lives, or a shift in your extraction approach. At 80%+, they'll threaten a full proxy campaign. Your Business Acumen stat determines how these play out.

- **Characters in elections can now debate each other.** Candidates can challenge opponents to a debate, accept challenges, and participate in debate sessions where your stats and preparation determine the outcome. Wins and losses feed directly into your election support numbers.

- **Disaster crises now explain their outcomes.** When a crisis resolves, you'll see a plain-language description of what happened and why — not just silent stat changes. The outcome is recorded in the crisis history so you can look back at how events unfolded.

- **Sending international aid goes through your legislature.** When your country pledges aid to a crisis abroad, it creates an emergency appropriation bill that your parliament or congress must pass. The money comes out of your treasury immediately — from surplus if you have it, financed as debt if you don't — and if the vote fails, the pledge is clawed back and your government takes a temporary approval hit. The feature is rolling out gradually (behind a feature flag).

- **Index funds now actually track their target holdings.** Funds rebalance every turn toward their
  target basket — trimming positions they hold too much of and topping up the ones they're short on —
  instead of buying once and sitting frozen. When shares of a target company are hard to come by,
  the fund now posts a standing buy order slightly above the market price to pick them up.

- **Owning too much of your own public company now hurts the stock price.** If the CEO holds more
  than 65% of shares in a public corporation, the share price takes a penalty — starting small at
  65% and reaching −30% at near-total ownership. This reflects that a concentrated, illiquid
  ownership structure is less attractive to outside investors. Private corporations are completely
  exempt.

- **Heavy CEO ownership also lowers the corporation's credit rating by one notch.** Same 65%
  threshold on public corps — a credit rating that would otherwise be BBB becomes BB, and so on.
  The share price badge and the credit rating tooltip both explain why the penalty is active and
  show the exact ownership percentage.

- **Public corporations can hold a ticker-symbol vote.** When a CEO of a public corporation wants
  to change the stock ticker, shareholders vote on the new symbol. Private corporations change
  instantly at the CEO's discretion.

- **Companies that live off bond interest are now valued more cautiously.** A business propped up by
  bond coupon income carries interest-rate risk a real operating business doesn't, so the market now
  pays less for that income — bond-derived earnings count for 75% of equivalent operating profit
  toward share price, and bond holdings get the same haircut on the balance sheet. Corporations that
  draw more than 75% of their income from bonds take an additional, escalating valuation penalty (up
  to half) the more reliant they are. Companies built on actual operations are unaffected.

### 🎨 UI

- **A redesigned inbox.** Notifications and player mail now live together in one place. A list down the left, the full item open on the right — filter by All, Notifications, or Mail, reply to mail without leaving the page, and snooze or archive anything you've dealt with. Time-sensitive events surface as a card at the top so you can act on them right there, and the bell in the navbar quietly pulses whenever something genuinely needs your input.

- **The corporation Financials tab is easier to read.** It now opens with the numbers that matter most — net income, profit margin, and how the market values the company — right at the top, and the Income Statement / Balance Sheet and Hourly / Annual switches sit together in one place. On wider screens a side panel shows where the money goes at a glance: a bar splitting revenue into its costs and profit, a cost breakdown, and your profit margin and credit rating. Losses now read in standard accounting style, and the page is tidier overall.

- **Stock price charts go all the way back to the start of the game.** The corporation Charts tab no
  longer stops a few hundred turns ago — it now shows the full price history back to the beginning,
  thinned out to stay fast.

- **When a shareholder vote passes, it stays on screen.** Previously a passed vote disappeared
  immediately — now it stays visible with a "PASSED" label until you reload the page, so you can
  see the result without wondering what happened.

- **Dual-class corporations now show two ownership charts.** When a corporation has adopted
  supershares, the shareholding breakdown shows two side-by-side pie charts: one for economic
  ownership (who holds what fraction of the business) and one for voting power (who controls
  shareholder decisions). The two can look very different when the founder's shares carry multiple
  votes.

- **Index fund shareholders link directly to the fund page.** On a corporation's shareholder list,
  index funds now appear as clickable links — tap one to go straight to that fund's page.

- **Issuing corporate bonds is now a slider.** The Debt tab's bond-issuance form lets you drag to set
  how much to raise — bounded by your per-issuance cap and minimum — with the coupon rate shown for
  each maturity option, instead of typing a raw figure and guessing the limits.

### 📚 Content

- **Wiki office pages now read like real history books.** The holder history on generated office
  pages — President, Prime Minister, Chancellor, Taoiseach, the US Vice President, cabinet posts, and
  congressional leadership — is now split into sections by game iteration (Alpha 1, Beta 1, Beta 2,
  …), oldest at the top. Tenures show the in-game week and year ("Week 12, 2020") instead of raw turn
  numbers, and a new Dates column shows the real-world dates each holder served ("June 16, 2026 -
  Present"). Admins can also fill in holders from past iterations by hand, right on the page.

### 🐛 Bug Fixes

- **Index funds no longer freeze up forever.** If one of a fund's holdings was taken private or
  delisted, the fund used to pause permanently and stop trading. It now simply drops that holding
  and carries on rebalancing.

- **Fixed a buy-order refund exploit.** Cancelling a buy order that had only partially filled could
  refund more money than was actually held in escrow. Refunds are now exact.

- **Proposing a second shareholder vote no longer crashes.** If a corporation already had one vote
  open (for example a ticker-change vote), trying to open a second vote would return an internal
  server error instead of a clear message. It now tells you to resolve the existing vote first.

- **Cutting spending now actually lowers it.** A budgeting bug meant that passing a bill to cut a
  spending category (for example NHS funding) could paradoxically _raise_ the amount spent and grow
  the deficit, because of how spending was scaled across eras. Spending now responds correctly to
  policy changes, scales with your country's economy, and a given policy costs the same no matter
  when it was passed.

- **Industry subsidies are no longer wildly over-costed.** The treasury was being charged far more
  for subsidies than the benefit companies actually received. Subsidy costs are now in line with the
  boost they provide (with a realistic inefficiency premium), so subsidizing industry is a sane
  fiscal decision again.

- **Incumbency only helps the actual officeholder now.** In races for a single office — President,
  Governor, Senator — the "Incumbency" persuasion driver was rewarding whichever party had simply
  polled better there last time, so two challengers could see an incumbency gap between them even
  when neither held the seat. Incumbency now backs only the party that currently holds the office;
  if neither candidate is the sitting officeholder, incumbency is a wash between them. Prime
  Ministers and other parliament-chosen leaders carry no personal incumbency bonus. Multi-seat
  legislatures (House and the overseas parliaments) are unchanged.

### 🔧 Platform

- **The wiki has its own address.** You can now go directly to
  [wiki.ahousedividedgame.com](https://wiki.ahousedividedgame.com) — same wiki, same login, just a
  cleaner URL. The old `/wiki` links on the main site still work.
- **The Android app no longer shows browser chrome.** When playing through the AHD Android app,
  the navigation bar, cookie notices, and ads are now hidden for a cleaner native experience.

## v0.3.3 - 2026-06-14

### ⚙️ Mechanics

- **The maps now follow the borders.** When a region changes country — like Northern Ireland
  reunifying with Ireland — it now disappears from its old country's map, appears on its new
  country's map (framed automatically), and changes colour on the world map. No more regions stuck on
  the wrong map.

- **Referendum campaigning feels fair and reads true.** The campaign actions now move the vote by
  roughly the amount their cards promise. Get-out-the-vote drives and rallies actually matter now —
  they turn out your own side's supporters, so a Yes drive and a No drive push in opposite
  directions. Pouring everything into one group of voters gradually tapers off instead of suddenly
  doing nothing, and when both sides campaign equally hard it comes out even.

- **Northern Ireland can now reunify with Ireland.** When a Northern Ireland reunification
  referendum passes, two bills are tabled at once — one at Westminster (to release Northern Ireland)
  and one in the Dáil (to admit it) — and BOTH parliaments have to vote them through. If both pass
  within the conversion window, Northern Ireland moves out of
  the United Kingdom and into the Republic of Ireland: its MPs take seats in the Dáil, its parties become Irish
  parties (with Sinn Féin joining the existing Irish party), the Dáil grows to give the North its
  share of seats, and everyone living there becomes an Irish citizen. Scotland and Wales independence
  (standing up brand-new countries) is still to come.

- **Scotland, Wales and Northern Ireland can now hold independence referendums.** When
  independence (or, for Northern Ireland, reunification) sentiment runs high enough, a nation's First
  Minister can formally request a referendum. The Prime Minister decides whether to grant or decline
  it. If it's granted, a campaign begins — the
  pro-independence and pro-union sides spend their political strength to swing the Yes vote before
  the ballot is held. Winning the vote doesn't redraw the map just yet, but the whole road to the
  ballot box is now in the game.

- **Major and Minor parties.** Parties are now Major or Minor. New and small parties start Minor
  with a lower Political Strength cap that grows by 10 for every region where they build 20%+
  Organization. Reach 20% Organization in a third of a country's regions and a Minor party graduates
  to Major and unlocks the full cap. A Major party that collapses below 10% Organization across
  two-thirds of regions gets an on-page warning and a countdown — recover to 20% in a third of
  regions in time, or it's demoted back to Minor. The historic big parties start Major; regional
  parties like the SNP start Minor, as they should.
- **Run a Registration Drive.** A new party action lets your chair, vice-chair, or campaigner spend
  Political Strength to register a state's Independent and Unregistered voters into your party,
  raising your Registration there. Registration is a slow, durable base that resists persuasion on
  election day — and it now climbs higher and counts for more than before.
- **Contest is no longer a sledgehammer.** Tearing down a rival's Organization costs more, no longer
  gets the catch-up bonus meant for building your own, and tapers off against parties that are
  already weak — so you can't cheaply grind a small party (or an abandoned major party) to nothing.
- **Organization has diminishing returns in elections.** A dominant party's Organization edge is
  softened, so a big lead is a strong advantage rather than a near-automatic sweep — leaving more
  room for candidate quality, momentum, and registration to decide races. Poll projections now use
  the same model as the real vote, so previews line up with results.
- **The presidential race uses the same vote model as every other election** — registration,
  persuasion, and a candidate's own reach all carry through consistently.
- **Nations now trade.** Countries exchange commodities each turn based on who has a surplus and who
  has a shortage, with allies and free-trade partners trading more. Imports ease shortages — so a
  country short on steel that trades for it sees prices and industry costs relax — and companies that
  produce goods their country exports earn a margin bonus. Tariffs, free-trade agreements, and
  embargoes now actually steer these flows: a tariff redirects trade to other partners, an FTA pulls
  partners closer, and an embargo can cut a good off entirely. Embargoes can be imposed quickly by a
  trade minister or made permanent through legislation.
- **Population growth is realistic again.** Immigration was being counted as if every country could
  draw migrants from everywhere at once, with no global limit, so world population was climbing far
  too fast each turn. Net migration is now capped at sensible rates per region and balanced globally,
  and the per-country migration figures have been corrected. Births and deaths were already accurate
  and are unchanged.

- **Tax bills no longer show backwards voter reactions.** Proposing a tax change displayed (and
  applied) reversed archetype approvals — e.g. libertarians and small business appeared to _like_ a
  50% income tax while unions and public-sector workers appeared to _oppose_ it. Approvals now move
  in the correct direction for tax and other affected bill types, both in the propose preview and
  when a bill passes.

- **1991 Ireland feels like 1991.** Starting a game on the 1991 reset now seeds Ireland's regions
  with era-accurate figures — pre-Celtic-Tiger research and renewable energy near the floor, far
  higher national debt, and a more conservative social baseline — instead of present-day numbers,
  and those starting points hold steady rather than drifting back toward modern values.

- **UK regional council seats now stay in sync with elections.** A cleanup pass makes sure every UK
  region's regional-council seat count matches the canonical schedule before elections are
  generated, fixing cases where legislature pages and election pages disagreed on chamber size.

- **Corporation credit ratings show the full breakdown.** Company pages now display the four
  components behind the credit rating — debt-to-equity, interest coverage, profitability, and
  liquidity — so you can see why a corp is rated A+ or BB-.

- **Index fund trading is steadier.** Fund leaderboards now sort by effective balance (what you
  actually see), and cross-fund rebalancing is throttled so funds don't churn positions every turn.

### 🎨 UI

- **Registration Drive panel.** A new card sits alongside Build Org and Contest on a state party's
  page (and the State Politics tab), with a live cost-and-gain estimate before you spend.
- **Major / Minor party badge.** Party cards and the National Party page now show whether a party is
  Major or Minor, and a Major party at risk of demotion sees a clear warning banner with a countdown.
- **Propose an embargo as a bill.** In the Propose Legislation window, the **Trade** category now
  has a Tariff / Embargo switch. Pick **Embargo** to build a durable trade embargo — choose the
  target country, a specific commodity (or all goods), the direction (your exports, their imports, or
  both), and whether to block the flow outright or cap it. Once the bill is signed the embargo takes
  effect on the next turn, and an "Embargo Repeal" provision lifts one the same way. A single trade
  bill carries either tariffs or embargoes, not both.

- **Trade ministers can impose embargoes directly.** The trade-policy cabinet seat (e.g. the US
  Secretary of Commerce, the UK Secretary for Business & Trade) now has a Trade Embargoes panel on
  its office page. It shows embargoes for and against your nation, and lets the minister impose a
  temporary embargo (target, commodity, direction, block-or-cap, and how many turns it lasts) or
  lift one early — taking effect the next turn. Each embargo costs 1 cabinet action and can last up
  to 96 turns; a minister can keep at most 2 active at once, and after embargoing a country that
  target goes on a long cooldown — so a lasting or repeated embargo has to go through legislation.
  Permanent embargoes still go through legislation and show here as read-only.

- **See every embargo at a glance.** The World Trade page (World → Trade) has a new **Restrictions**
  tab listing all active embargoes worldwide — grouped by the nation imposing them, with what's
  blocked or capped, whether it's a ministerial or legislated embargo, and when it expires. It also
  shows embargo bills still moving through a legislature, so you can see what's coming before it
  takes effect.

### Bug Fixes

### 🐛 Bug Fixes

- **Going independent no longer triggers a party-switch cooldown.** Leaving a party to sit as an
  independent was starting the same 24-hour timer that stops you from rapidly hopping between parties —
  so a long-time member who quit got locked out of joining anyone for a full day. The cooldown now
  only applies when you actually join a party; becoming independent is free. (You still can't dodge the
  timer by briefly going independent right after joining a party.)
- **You can reach the Endorse button on mobile.** On the presidential primary standings page, phones
  couldn't scroll the standings table sideways, so the Endorse button on the right was cut off and
  unreachable. The table now scrolls horizontally on small screens, so you can swipe across to endorse
  a candidate.

- **Profiles and politician pages load again.** Some players saw profiles and the politicians
  directory get stuck on a grey loading skeleton that never filled in (and console errors if they
  opened developer tools), while it worked fine for others. The cause was a background script that
  could get into a bad state in the browser and block the page from loading. It now clears itself
  out automatically — affected players just need to reopen the page once and it will load normally.

### 🔧 Platform

- **Pages load lighter.** The site logo and the login/sign-up background art are now served from a
  content delivery network and shipped in smaller, modern formats — so the app's images load faster
  and use less data, especially on the sign-in and character-creation screens.

## v0.3.2 - 2026-06-09

### 🎨 UI

- **New World Trade Ledger.** A new page under World → Trade shows the balance of trade between
  nations: a surplus/deficit league, what each commodity the world is long or short, a bilateral
  pair view, a country-by-country matrix, and a world map of net trade flows — all in your chosen
  display currency.

- **The company Operations page is tidier for multi-country firms.** Bulk "By Type" controls now
  sit under collapsible country sections (your home country opens first), and you can set an
  individual sector's growth with the same cost preview the bulk controls use.

- **Set growth and production for a whole sector at once.** Running a company with holdings spread
  across many states? You can now set a growth target and production level for every holding of a
  sector — Energy, Construction, and so on — or for the whole company in one go, instead of clicking
  through each state. Growth shows the projected cost before you commit, and you can still fine-tune
  individual holdings whenever you want. Works for both private corporations and National
  Corporations.

- **Executive pages now fly the real seal of office.** The President / Prime Minister masthead shows
  your country's actual executive emblem — the Presidential Seal, the Royal Arms, the federal eagle,
  the Prime Minister's emblem, the harp, the national emblem — instead of a generic crest.

- **Cabinet members get a "Cabinet Office" shortcut in the Nation menu.** If your character holds a
  cabinet seat — in any country — the Nation dropdown now shows a Cabinet Office link right under
  your home nation that takes you straight to your office page. Everyone else won't see it.

- **Cabinet ministerial actions reset at midnight Eastern Time.** Instead of trickling back one at a
  time on a rolling 24-hour clock, your cabinet action pool refills to 2 at midnight Eastern each
  day — so checking in once per day is enough and you won't lose progress for missing the exact hour
  your last action returned. The office page reminds you that actions reset daily at midnight Eastern.

- **Central bank pages now answer the one question that matters: is the bank ahead of inflation?**
  Every central bank opens under its own official masthead — the Fed in navy with its $ seal, the
  People's Bank of China in red with ¥, and Germany and Ireland now correctly share the European
  Central Bank's € masthead — with the prime rate as the headline number and live tiles for
  inflation, savings flow, and reserves. The new **rate corridor** chart draws the prime rate as a
  stepped line over the inflation band for the last 60 turns, with a plain-language verdict
  underneath ("Rate sits +1.15 above inflation — restrictive stance · inflation cooling"). All the
  tools you use — savings, lines of credit, FX intervention, chair nominations and lobbying — are
  exactly where they were.

- **National Policy is now your country's statute book — with a history view.** The policy page
  opens under an official code-of-law masthead showing the national Economic and Social axes, and
  organizes every law into numbered Titles with a sticky rail that shows each domain's lean at a
  glance (Taxation leans left −1.8, Immigration leans traditional +1.0 …). Each statute shows when
  it was enacted, under which bill, its ideology badges, and its annual budget cost. Flip the new
  **Code | Record** toggle and the page becomes a timeline: every enactment plotted against the
  running national average — click any node to see exactly how far that law moved the country. The
  link is shareable; the Record view has its own URL.

- **The Politicians page is now a real leaderboard.** Instead of a wall of cards, politicians rank
  in a dense ladder: every row shows an influence bar scaled against the current #1 (who gets the
  gold bar), with proper columns for party, office, influence, and favorability — so the list reads
  at a glance like a power ranking. Player characters carry a gold PLAYER badge, the four rows of
  filter chips collapsed into one compact toolbar (party, office, sort, and a Players-only switch),
  and party colors now always match each party's real colors. On phones the columns fold neatly into
  each row instead of clipping.

- **Executive pages got a full redesign — and now show what the government is actually doing.**
  Every country's executive page (the White House, Downing Street, the State Council, and the rest)
  opens with a new official masthead — the institution's photo fading into its national colors — and
  a strip of live gauges: government approval, bills on the desk (or orders in force), and how full
  the cabinet is. Below that, a new **Acts of Government** ledger chronicles everything the executive
  has done — bills signed and vetoed, executive orders and directives, cabinet nominations and
  confirmations — each stamped with when it happened and filterable by type. Offices render as
  plaques in constitutional order, and vacant seats now explain exactly how each office gets filled.
  Everything you could do before — signing bills, addresses, orders, appointments, no-confidence
  votes — is exactly where it was.

- **Country pages open with a new National Ideology readout.** Every country's landing page now shows
  where its laws actually sit: an **Economic Axis** and a **Social Axis**, each the average position of
  every national law currently on the books, drawn as a spectrum bar with the exact score. Beneath each
  bar, a small trend line shows how the average has drifted as laws were enacted, and a "Recently moved
  the needle" feed lists the last five laws that shifted the country's ideology — with exactly how far
  each one pulled the average. A "View National Policy" link jumps straight to the full law book. (An
  "Economic Model" slot also appears — that feature is coming later.)

- **The country page's link grid is now a proper directory with live figures.** Instead of big icon
  cards, links are grouped under Politics, Government, and Country & Economy — and rows show live
  numbers: how many parties are active, how many politicians are ranked, how many elections are live,
  how many bills are before the legislature, how many national laws are in force, and the central
  bank's current rate. Registration status moved into a glowing pill over the country photo.

### ⚙️ Mechanics

- **Eight new random events join the pool — thirteen total.** Alongside the original lottery wins,
  staffer scandals, viral moments, corrupt donors, and whistleblower memos, your character can now
  face a **tax audit**, an **old friend's startup pitch**, a **memoir offer**, a **town hall
  ambush**, a **polarizing celebrity endorsement**, a **hot mic before a debate**, a **product
  defect** at your corporation, or an **insider tip** you probably shouldn't trade on. Every event
  gives you four ways to respond — bold plays have bigger upsides and uglier downsides on the same
  hidden roll — and doing nothing is always a choice (with consequences).
- **Event outcomes now stay visible on the Actions page.** After you respond to an event (or the
  24-hour window runs out and the default applies), a compact "Latest event" card shows what
  happened and what it cost — or earned — you for the next two days.
- **Events reliably reach everyone.** Fixed an issue where only a portion of characters could ever
  receive random events, and another where re-syncing the event catalog could silently switch all
  events off. Timed-out events now always send their "Event resolved" notification.

### ⚙️ Mechanics

- **Command economies are defined by state ownership.** A country (or region) where National
  Corporations own at least two-thirds of all its sectors is classified as a State-Capitalist /
  Command Economy — so heavy nationalization, not just an energy-heavy sector mix, is what makes your
  economy "command." Privatize below that and the identity drifts back toward what your sectors and
  spending say.

- **Your country now has an economic identity — and it grants real bonuses.** Based on the industries
  you build, where your government spends, and the laws you pass, each country (and region) is
  classified as a Military-Industrial Complex, a Tech-Innovation Economy, a Financialized Economy, an
  Agrarian Economy, and more — shown on the country and region pages with a strength meter, the sectors
  driving it, and any rival model gaining ground. It shifts slowly and only changes identity after a
  rival stays ahead for a sustained stretch. Leaning in pays off: aligned industries grow faster and
  earn higher operating margins (with a Favored/Disfavored badge on the corporation page), spending
  that matches your identity goes further, and identity-linked metrics improve — while building
  against your model carries a mild penalty. The bonuses scale with how dominant the identity is, with
  diminishing returns at the top so specialization stays a strategic lean (with real fragility), not a
  permanent lock.

- **Wages and trade now grow on the real economy — and protectionism has a cost.** Wage growth
  reflects real income gains plus a share of inflation, and trade growth rises with free-trade
  agreements, common-market membership, a competitive currency, and a strong manufacturing base —
  while high tariffs and a punitive foreign-business tax drag it down. Both feed your income- and
  trade-tax bases, and they now compound a little every turn instead of jumping once a year, so the
  treasury tracks the economy smoothly. Push tariffs too high and you'll find receipts eventually
  fall as the trade base shrinks — a trade-policy sweet spot you can overshoot. Wage and trade
  growth appear as new economic metrics on the regional and national pages.

- **National debt, deficit, and the German debt brake now track real budgets.** Debt-to-GDP,
  budget balance (as a share of GDP), and Germany's Schuldenbremse headroom now reflect your
  government's actual treasury position each turn instead of a fixed starting figure — so fiscal
  management shows up in the numbers and in approval. A law now affects the budget through its real
  tax and spending changes rather than a separate scripted number. (The German debt brake only
  applies in the modern start; it didn't exist in the 1991 start. The Future Ireland Fund readout
  was removed — it wasn't established until after both start dates.)

- **Approval now depends on WHO you govern — there is no universally optimal agenda.** Each region's
  voters weight the issues their ideology cares about: conservative electorates reward growth,
  economic freedom, low debt, order, and national pride; progressive electorates reward low poverty,
  equality, and strong services; libertarian electorates reward civil liberties and a free press. The
  same record that delights one region disappoints another, so governing is about coalition and
  trade-off, not chasing a single best scoreboard. The two-axis "compass" metrics (civil liberties,
  national pride, military readiness, economic freedom, and more) now move approval for the voters
  who value them. (The effect is strongest where legislation is fully ideologically tagged; Japan and
  Brazil see less of it until their law sets are built out.)
- **Right-leaning policy now has real upside, not just trade-offs.** Tax cuts boost small-business
  formation, deregulation lifts economic freedom, immigration limits ease housing-cost pressure,
  tough-on-crime measures cut crime, and national-pride/security laws build it — so no single
  agenda is strictly best on the scoreboard. Several laws were also re-classified onto the correct
  economic/social axis (defense spending, the filibuster, policing, gender equality, and more).
  (Note: the payoff lands fully once the two-axis approval rework ships; Japan's law set is still
  being differentiated and Brazil has no legislation yet.)
- **Countries now have a national social outlook (libertarian ↔ authoritarian).** It starts from each
  country's character — China authoritarian, the US/UK/Ireland leaning libertarian, others in the middle
  — and shifts as social legislation is enacted: surveillance, state-media, and conscription laws push a
  country authoritarian, while press-freedom and civil-liberties laws push it libertarian. Economic bills
  leave it untouched. The National Policy page now shows a National Outlook strip with the country's
  social and economic lean at a glance.
- **Every political quadrant gets a scoreboard — the groundwork for ideological balance.** Six new
  metrics: civil liberties (eroded by surveillance, state media, and mass incarceration; lifted by press
  freedom), national pride (military prestige and a booming economy), military readiness (built by real
  defense budgets in every country), state media control, economic freedom, and regulatory burden. New
  Recruitment/National Service Acts in all six countries pose the volunteer-vs-conscription dilemma —
  compulsion buys readiness and pride at the cost of civil liberties — and Ireland and Japan finally get
  Media & Press Freedom Acts. These metrics are display-only for now: they deliberately do NOT move
  approval yet — that switch flips with the coming two-axis approval rework. Also fixed: approval had
  been quietly scoring two dozen "lower is better" statistics backwards — rewarding child poverty and
  knife crime — wherever they were tracked.

- **Every country's signature politics now lives and breathes.** UK devolution satisfaction tracks trust
  in government, and Scottish, Welsh, and Northern Irish independence sentiment rises with economic
  grievance and falls when devolution delivers — a corruption scandal can now cascade all the way into
  separatism. German pension stability finally feels the real demographic ageing curve (and pension
  funding pushes back); Bundeswehr readiness is built by actual defense budgets. Irish unity-referendum
  sentiment follows hardship and social cohesion, and the Direct Provision system strains under real
  migration inflows unless capacity keeps pace. Robotics adoption follows where the factories and the
  R&D money actually are. Defense, research, and devolution acts now work through the institutions they
  fund rather than double-counting their own headlines.

- **Legitimacy and the information sphere are now living systems.** Social-media sentiment swings with
  your government's popularity and the economy's direction; media polarization feeds on inequality and a
  souring public mood — and now bleeds into social cohesion and, through it, the schools. Trust in the
  news follows press freedom and polarization (with BBC trust tracking it in the UK); disinformation
  thrives where the press is muzzled and trust is low. Corruption responds to transparency institutions
  and elite capture, and public trust in government rises and falls with your approval, jobs, corruption,
  and the news — feeding back into approval itself as a slow, self-stabilizing loop. Ethics and media
  laws now act on the institutions they actually build (transparency, press freedom) with the engine
  carrying the consequences downstream.

- **Housing, homelessness, and the social fabric are now living systems — P3 is complete.** Housing cost
  pressure rises with the cost of living and falls when your regions actually build (housebuilding and
  planning acts now drive real supply); homelessness follows housing pressure and poverty, eased by mental
  health access — with rough sleeping in the UK and vacancy/rental pressure in Ireland tracking it. Social
  mobility builds generationally from schools and erodes under inequality; social cohesion frays with
  inequality, joblessness, and media polarization — and now feeds back into graduation rates, so a divided
  society schools its children worse. Civic participation follows education, cohesion, and trust in
  government. Also fixed: housing affordability was stuck at a hard cap in Ireland due to a unit clash, and
  several housing laws' effects pushed the wrong direction.

- **The environment now breathes with your economy.** Carbon emissions are driven by what your regions
  actually produce — an energy-and-heavy-industry economy emits far more per person than a services
  economy — minus your renewable share and environment budget. Air quality follows carbon, urban density,
  and renewables, and polluted air now measurably shortens life expectancy over the years (clean air
  extends it). Energy-transition progress tracks your renewable build-out; UK flood risk responds to
  climate-resilience investment; Irish agricultural emissions reflect agriculture's real share of the
  economy. Climate mandates, nuclear policy, and local environmental services still act directly; pure
  environment funding now works through the budget it books (no double-counting). Also fixed: a pair of sign bugs that had quietly REWARDED smoggy air — longer lives under pollution, and "green" cabinet actions (Blue Sky Defense, Clean Air
  Initiative, preservation orders) that actually worsened air quality while industrial options cleaned it.

- **Crime and policing are now living systems — and poverty and crime feed each other.** Your public-safety
  budget builds real police capacity, which pushes crime down; poverty, unemployment, and inequality push it
  up while graduation rates pull it down. Violent crime tracks overall crime, prisons fill with a lag,
  reoffending follows prison churn and job prospects, and public confidence in safety responds to all of it.
  The loop runs both ways: high crime deepens poverty and high poverty breeds crime — so social investment
  cuts crime over time and police investment eases poverty. Policing and justice funding acts now work
  through the budget they book (no double-counting); sentencing-regime laws (prison reform, strike-hard
  campaigns) still act directly. Cabinet orders that touch large-scale statistics (like per-100k crime) now
  actually move them — they were previously capped into irrelevance.

- **Poverty, incomes, and inequality are now living systems.** Median income grows with productivity and
  tight labor markets; inequality tracks unemployment and how growth is distributed, compressed by social
  transfers; poverty responds to unemployment, inequality, crime, and your social budget — and child poverty
  follows it into the schools, dragging graduation rates and test scores until investment pulls it back.
  Pension and welfare acts still choose who transfers reach. Also fixed: crime and incarceration statistics
  were internally capped far below their real per-100k scale, and income inequality was being corrupted by
  a unit mismatch — both now read correctly.

- **Long-run growth now comes from what you build.** A region's underlying growth trend is no longer a flat
  constant — it's driven by research intensity, workforce skill, transport and digital infrastructure, and
  urban density (with diminishing returns as cities saturate). Invest in schools, R&D, and infrastructure and
  the productivity trend rises over the years; let them rot and it sinks. Productivity growth on the metrics
  page reflects the same engine that drives GDP.

- **Infrastructure now crumbles without maintenance.** Roads, public transit, broadband, water systems, and
  the power grid are living capital stocks: sustained infrastructure spending maintains and improves them,
  while sustained underfunding visibly erodes them year over year — and restoring the budget rebuilds them.
  The investment-gap statistic shows how far your spending falls short of what the region needs. Targeted
  acts (broadband, rail, utilities, grid) still prioritize which infrastructure gets built.

- **Healthcare budgets now shape health outcomes — and mortality.** Healthcare spending builds physician
  capacity, improves affordability and mental-health access, and pushes preventable deaths down and life
  expectancy up over time — and life expectancy now feeds straight into your population's real death rate, so
  sustained healthcare investment visibly slows deaths while starvation accelerates them. An aging region
  (high dependency ratio) strains elder care and lengthens NHS/HSE waiting lists. Insurance laws act through
  coverage, funding laws through their budgets; mental-health, elder-care, and social-care acts still
  prioritize within the budget.

- **Education budgets now shape schooling outcomes.** Per-capita education spending — federal and regional —
  now drives graduation rates, test scores, literacy, college enrollment, and workforce skill over time, with
  diminishing returns: sustained investment lifts outcomes, sustained starvation erodes them, and child
  poverty drags on schools. Vocational and exam-pressure policy feed in too (apprenticeships build workforce
  skill; exam reform trades test scores for wellbeing). Education funding laws now act through their budgets
  rather than directly nudging the outcome numbers, so the money is what matters.

- **Education, healthcare, and crime stats read correctly.** Several regional statistics measured on their
  own scale — per-pupil education spending, preventable deaths per 100,000, and violent crime per 100,000 —
  were being capped at 100 internally, flattening them to the same value everywhere. They now hold their
  true figures.

- **Region pages now show living economy & population data.** The Metrics tab breaks GDP growth into its
  long-run trend and the boom/bust cycle riding on top of it, alongside the output gap and labor force. The
  Demographics tab adds a live population readout — total population and its growth, median age, sex ratio,
  dependency ratio, and net migration — plus an age-and-sex population pyramid. After a census, your region
  shows whether it gained or lost House seats.
- **Cabinet posts can now be reshuffled freely, but each seat has its own 24-turn appointment cooldown.** A Prime Minister can fire any cabinet minister at any time, with no waiting period. What's changed is appointing: each individual cabinet seat can only be filled once every 24 turns. The lock starts when you appoint someone and runs the full 24 turns even if you fire them early — so choose each minister deliberately, because the seat stays closed for the rest of the window after a dismissal.

- **National party Treasurers can now manage campaign budgets.** The Treasurer of a national party
  can now see and set the PS Investment, GOTV, and Voter Suppression budgets on the party Treasury
  tab — including the "Total this turn" PS readout — matching what state-party treasurers could
  already do. The national tax rate remains view-only for Treasurers.

- **Irish regional offices were stuck at 0 Office AP — now fixed.** Ireland's regional governors (and the
  office for any region added after a game was first set up) never accrued Office Action Points, leaving the
  Governor's Office unable to issue orders or take actions. Those offices now start at their full action
  cap and regenerate each turn, exactly like every other country's offices.

- **Bill votes now clearly show how many votes are needed to pass — and call out filibusters.** The vote
  panel reads "51% needed to pass" for an ordinary bill, and updates to "60% needed to pass" when a bill
  is filibustered in the Senate or "67% needed to pass" for bills that require a two-thirds supermajority
  (such as nationalizations and Japan's override votes). Filibustered bills now also carry a bold red
  "Filibustered" marker at the top of the page and on the vote panel, so it's obvious why the bar is
  higher.

- **Washington, D.C. no longer holds phantom elections.** D.C. has no congressional or gubernatorial
  seats — it only casts presidential electoral votes — but the game had been creating House, Senate,
  Governor, and state-legislature races there every cycle (with no real candidates). Those races have
  been removed and will no longer be generated. D.C. remains a normal region on the map for the economy,
  demographics, and the presidential vote.

- **Presidential coattails rebalanced around the sitting President's approval.** Down-ballot candidates
  of the President's party now get a modest boost when the President is popular and a modest drag when
  they are unpopular — the same size and shape as a governor's coattail in their home state, just applied
  nationwide. Previously coattails swung wildly with whoever was ahead in the live presidential race; they
  now reflect how the sitting President is actually doing.

- **Index funds.** Investment funds that track baskets of corporations by sector or market index. Each fund
  absorbs public float from its constituent stocks on a per-turn basis, rebalances positions, and
  issues/redeems shares at NAV. Players can subscribe and redeem fund shares through the stock market UI.
  10 index funds are live across US, UK, Japan, Germany, and China markets.

- **Contingent presidential elections.** When no candidate reaches 270 EVs, the incoming House picks the President from the top three finishers (one vote per state delegation, 26 to win) and the Senate picks the VP from the top two running mates (51 votes needed). Full 12th-Amendment resolution — chamber members vote by party match then ideology proximity; tied delegations abstain. Election detail pages and the wiki show the delegation and Senate breakdown.

- **Founder supershares now affect index fund voting power.** The dual-class share structure (v0.3.1) wasn't wired into index fund proxy voting — funds held shares that bypassed supervoting weight. Fund holdings now respect voting power, so a founder's control persists through fund accumulation. Index fund holdings also properly pass through to all voting-power-gated thresholds (subsidiary status, hostile takeover eligibility).

- **Presidential campaign strength rebalanced.** Vote multiplier soft cap reduced from +300% to +100% (`CAMPAIGN_STRENGTH_MAX_BONUS = 1`, `TAU = 50_000`). Each campaign turn, the leader is pulled back toward the field average by up to 175 CS. The formula uses a logistic curve (`1 + maxBonus * (1 - e^(-cs/tau))`) that preserves early gains while hard-capping total impact.

- **Presidential suspend & endorse (one-time CS transfer + ongoing org boost).** A nominee can suspend their campaign, stay on the ballot, and endorse another candidate in the general election. One-time immediate transfer debits 25% of campaign strength (CS) from the suspender and credits it to the endorsed candidate's campaign. The suspender retains their existing vote tally (votes already earned are preserved) but accumulates no further votes per turn, stays on the ballot in name only, and forfeits all passive bonuses (ground game, VP home-state). Additionally, 25% of the suspender's per-state character org (registration/ground organization) adds to the endorsed candidate's effective org for vote distribution in each state — no org is debited from the suspender. This means the endorsed nominee gains a meaningful grassroots boost proportional to the endorser's existing state-level investment, without penalizing the endorser's state presence. If the endorsed candidate withdraws, transfers are already done and the suspender remains frozen — no further action needed. One-way — cannot be undone.

- **Commodity market rebalance.** Iron, natural gas, energy, coal, oil, plastics, advertising, and timber were in critical shortage (S/D well below 0.4). Heavy consumers now use less; extraction sectors produce more; chemical plants co-produce more plastics; marketing budgets convert less aggressively into advertising demand.

- **Demographic laws now shape population and the workforce.** Pension, immigration, family and childcare,
  reproductive, elder-care, and rural-development laws now move the real drivers behind the population —
  fertility, migration, labor-force participation, and life expectancy — instead of nudging a cosmetic
  number, so their effects show up in the actual population and workforce over time. Three new laws join the
  set: a US Paid Family Leave & Child Care Act, a UK Childcare & Family Support Act, and a Japan Pension &
  Retirement Age Act.

- **The economy now grows on its population and productivity, not just corporations.** A country's
  underlying growth trend is now set by its **workforce** (the working-age population in the labor force,
  minus anyone in military service) plus its **capital and productivity** — with the corporate-sector engine
  driving the **booms and busts around that trend**. A shrinking or aging workforce lowers long-run growth;
  a sector boom now opens an "output gap" that closes over time instead of growing forever; and unemployment
  tracks how far growth runs above or below this potential. Low central-bank rates feed investment and a
  country's capital stock.

- **A decennial census now reapportions Congress.** Every ten game-years — the first week of years ending in
  0 — a census recomputes US House seats from each state's current population by the real method of equal
  proportions, and presidential electoral votes follow (seats + 2). Fast-growing states gain seats and
  electoral votes; shrinking states lose them, announced on the National Wire with the seat changes. Until
  the first census fires, apportionment matches the starting map exactly.

### 🐛 Bug Fixes

- **Restrictive immigration, deficits, and negative sentiment now register.** Several metrics that are
  meant to go negative — net migration, budget balance, and social-media sentiment — were silently floored
  at zero. As a result, immigration-restriction laws did nothing, budget deficits couldn't show, and
  negative public sentiment never appeared. They now move and display across their full range, so
  restrictive immigration has a real effect and deficits/negative sentiment are visible.
- **The cabinet page no longer shows ministers who aren't really in office.** On the parliamentary cabinet overview, a seat could appear filled while the minister's own office page showed it vacant (or the reverse). This happened after a change of government: the cabinet was only half-cleared, leaving a stale name on one screen. A change of Prime Minister or Taoiseach now clears the cabinet completely, so the overview and each office page always agree on who holds a seat.

- **Former ministers no longer keep their cabinet action bonus after the government changes.** When a government fell or a new Prime Minister, Taoiseach, or President took over, the outgoing cabinet was removed from the roster but its members quietly kept their cabinet office's action bonus until they were reassigned. Leaving the cabinet on a change of government now correctly returns each minister to their legislative seat (or to private life), so the bonus stops the moment they're out.

- **Cabinet ministers no longer lose action points for being promoted.** A legislator appointed to the cabinet was silently dropping their office's action bonus — a German minister who was also a Member of the Bundestag, for example, stopped getting their seat's bonus and regenerated fewer actions than a plain backbencher. Cabinet now stacks on top of your seat: you keep your seat's bonus and gain the cabinet bonus on top of it, and the number shown in your Political Standing matches what you actually receive each turn. The Actions tooltip now breaks the total down line by line — base, your office, your cabinet post, central bank chair, and party influence — so you can see exactly where every action per turn comes from.

- **Recruited NPPs can no longer jump into a race after its primary has ended.** Party leadership could slate an NPP onto a seat whose primary was already over, and the next turn would drop them straight into the general election — skipping the primary entirely. Slating now stops once a race leaves its primary phase, just like player filing does.

- **Contingent elections now finish reliably.** Races stuck mid-resolution retry instead of hanging forever. Empty congressional delegations no longer crash resolution.

- **Index fund NAV no longer declines perpetually.** NAV was tracking market price instead of accumulated cost basis. Now correctly computes from actual investment cost.

- **Index funds absorb public float 12× faster.** Absorption cap increased from `/1200` to `/100` of total shares. A 10M-share corp now absorbs 100K shares/hour instead of 8.3K.

- **Index fund subscribe and redeem hardened.** Large and concurrent trades no longer fail from duplicate-key races.

- **Vice Presidents can resign from the White House.** A Resign button on /whitehouse vacates the VP office without requiring withdrawal from other races — essential before a contingent House ballot when also holding a chamber seat.

- **Cabinet ministerial orders now expire on schedule.** Orders like China Targeted Credit Easing meant to run ~24 turns could remain active indefinitely. Expiry enforced per-turn, duplicate re-issue blocked, turn countdown shown in cabinet UI.

- **China executive endorsements work for same-party candidates again.** Party matching now recognizes CCP member IDs regardless of how the party ID is stored internally.

- **Cabinet ministers can change tier settings after adjusting regional allocations.** Allocation cooldown and tier setting cooldown now track separately.

- **New cabinet ministers start with a clean slate.** Settings cooldown resets on every appointment, preserving existing policy values.

- **Politicians list shows correct office titles per country.** Non-US characters no longer display "President of the United States" on foreign rosters.

- **VP achievement and contingent-election edge cases (bug #0767).** Winning VP now awards A Heartbeat Away. VPs blocked from resigning during a presidential run can step down. Contingent House ballots no longer count sitting executives as chamber voters.

- **Sovereign bond issuance works for all countries.** Bond series now iterate every configured country budget, not just US/UK/JP.

### 🎨 UI

- **White House VP resign.** Seated Vice Presidents see a resign control on the executive leadership card.

- **Central bank page fits narrow screens.** Chair names, policy labels, and the summary stat strip no longer overflow or clip on mobile.

- **Stock market exchange picker shows every exchange on mobile.** On phones, the exchange dropdown was cutting off its last option (Shanghai's SSE). It now opens as a full overlay that lists every exchange and scrolls if needed, instead of being clipped by the page header.

## v0.3.1 - 2026-06-07

### ⚙️ Mechanics

**Playable Countries: United States, United Kingdom, Japan, Germany, China, Ireland.**

- **Founder supershares — sell more of your company without losing control.** Corporations can now adopt a **dual-class share structure** where each of the founder's shares carries **2× to 10× votes** in shareholder votes. Opt in when you IPO (a dual-class IPO can float up to **75%** of the company instead of 49%), or propose it later from the CEO Admin tab as a shareholder vote. Supershares pay the same dividends and payouts as common stock — only the voting weight differs — and they convert to common stock when sold, so control can't be traded away. Vote tallies, subsidiary status, and hostile-takeover eligibility all respect voting power now, but privatization buyouts stay one-share-one-vote so minority holders can't be squeezed out by supervotes.

- **National Corporations — bring industry under state ownership, run it, and sell it back.** Governments can now take companies into public hands, operate them as state enterprises, and later privatize them. It's a full lifecycle with real political stakes, reachable from a corporation's page and from each country's National Corporation page.
  - **Two ways to nationalize.** A head of government can act directly through an **executive** taking — fast, but limited to publicly-owned/unowned firms and to private firms that are clearly failing, and it pays a reduced price (or nothing, as an outright seizure) at a steep political cost. The **legislative** path can take _any_ company in the country, pays full compensation, and is the "proper" route — but a nationalization (or privatization) bill needs a **supermajority**, not a simple majority, to pass in a free legislature. Either way the state pays a hefty **buyout premium** well above a company's going-concern value, so nationalizing is a serious fiscal commitment, never a bargain. You can take a single sector, a whole company, or sweep an entire industry.

  - **Private companies aren't easy targets.** A player's company can only be nationalized under specific, defensible conditions — it's in serious financial distress, it operates in a sector the government has declared _strategic_, it has grown into a near-monopoly, or the legislature votes for it by supermajority. Outside those conditions, taking a healthy private firm requires winning the political fight in the chamber.

  - **Owners get a warning and a way out.** When your company is flagged or formally targeted, its page shows an **at-risk badge** and a countdown, and you get time to react — recapitalize a distressed firm, divest out of a strategic sector, shrink below the monopoly line, or rally votes to block the bill. Abandoned or insolvent firms are the exception and can be taken immediately.

  - **What a National Corporation does.** State enterprises trade some profit for public benefit: a state-run sector lifts the matching public service (healthcare, power, transport, broadband, food security, and so on), can be set to hold prices down or guarantee employment, and is backed by the treasury so it can't simply go bankrupt. A well-governed, low-corruption state runs them efficiently; a corrupt one runs them into the ground. The finance minister appoints (and can remove) each National Corporation's CEO, and that CEO can manage budgets, workforce, modernization, and remit profits to the treasury.

  - **One state holding, or several focused ones.** Everything a country nationalizes folds into its single National Corporation by default, but the finance minister can **split off** a sector type into its own dedicated state firm (and merge it back later). Future takings of that sector type automatically route to the right firm.

  - **Privatization is the mirror image.** The government can carve a brand-new company out of a National Corporation and return it to private hands by floating it on the stock market or selling it at **auction** — optionally keeping a _golden share_ (a minority stake with veto power). Cooldowns stop seize-then-sell ping-pong.

  - **It moves the politics.** Every taking and sale shifts approval and legitimacy, and feeds a national **investor-confidence** signal. Nationalize aggressively and confidence falls — which drags on private profits, makes the government's own borrowing more expensive, and chills new business formation. Rescuing jobs or breaking up a monopoly plays well; seizing a thriving company does not. A _statist_ governing bloc pays little to nationalize and a lot to privatize; a _market_ bloc, the reverse.

  - **Everyone can see the record.** Each country's **State Ownership Register** is public: every nationalization and privatization, who did it, how, and the political cost — so the opposition can hold the government to account. Players in a country are notified when a state company is put up for sale.

- **National Budget reimagined as a finance ministry.** The budget page is now a treasury dashboard: a national seal and masthead, a fiscal stat strip, a flow diagram from revenue through the treasury to spending, expandable breakdowns of every tax and grant, a debt-and-credit panel with a trend line, and a sovereign-health readout. The country now tracks a single running **treasury balance** — its real cash position — which pays nationalization compensation, funds state-enterprise operations, and receives privatization proceeds; a negative balance is national debt.

- **Region seat appointments work for every country.** The admin tool for filling vacant regional seats previously only understood US offices; it now shows the correct appointable seats for each country.

- **Legislation pages redesigned.** Bills lists, bill pages, and the propose-legislation form across every legislature — US Congress, the UK, Germany, Japan, Ireland, China, and the state/regional legislatures — share a new editorial "Legislative Record" look. Bill pages now feature a live, vote-colored seating chart of the chamber (a hemicycle, the Westminster benches, or the Dáil horseshoe, depending on the country) and a "How it becomes law" explainer of that country's procedure — vetoes and overrides, Lords delay and Royal Assent, Bundesrat consent, the Shūgiin override, Dáil supremacy, and so on. Proposing a bill in the UK, Germany, Japan, Ireland, or China now uses one consistent form, and Germany and Ireland can now propose industry subsidies.

- **NPP corporations now prioritize profit.** AI-run corporations scale spending on what they earn (not what they bank), divest losing non-core sectors, invest aggressively in their own sector type, and only expand when margins and cash are healthy. Energy corps expand into energy, manufacturing into manufacturing, etc.

- **Germany's legislation catalogue is now complete.** 8 tax types (including Gewerbesteuer and Solidaritätszuschlag), 22+ national policy types, and 5 Land-level state-scoped types — all with LARP-style titles and English + German descriptions. The Bundestagspräsident opens automatically after every general election.

- **China's legislation catalogue is now complete.** 9 tax types (including LVAT, UMCT, and Stamp Duty), 21 national policy types, and provincial-level bills via the People's Congress chamber. CN-specific metrics (social credit, Belt and Road, common prosperity) are tracked.

- **China's regime can now collapse.** Sustained mismanagement feeds a public-legitimacy gauge that escalates through discontent → unrest → faction defection → forced transition to multi-party parliament. Five reform off-ramps (legalize a banned party, dial down vote multipliers, honest by-election, anti-corruption purge, constitutional amendment) and a voluntary constitutional convention give the Premier tools to course-correct. The country overview shows a public Regime Stability panel; the Premier sees the full Regime Health diagnostic. Collapse is intentionally slow — 200+ turns of sustained mismanagement — leaving real room to recover.

- **China's State Council expanded to 16 seats.** 7 new ministries added: Agriculture, Culture, Ecology, Emergency Management, Human Resources, Justice, and Veterans Affairs. Provincial legislatures and provincial governors are also live.

- **Turn-based deadlines across the entire game.** Election timers, parliamentary votes, leadership elections, recruitment cooldowns, relocation cooldowns, and crisis-decision windows all now run on turn counters instead of wall-clock time. The game clock catches up automatically if it falls behind.

- **Corporation stock ticker symbols.** Every corporation now has a unique ticker symbol (3–5 letters) shown in the stock list, search, and scrolling ticker bar.

- **Character creation improvements.** Starting wealth raised to 1M/2.5M/5M. Discord can be linked during creation (opens in new tab, auto-detects completion). One-click randomizer for quick starts. China selection shows a one-party disclaimer.

- **New players can't send money for 24 turns.** A transfer barrier prevents fresh characters from immediately moving funds. Election panels show when the cooldown expires.

- **Campaign Manager now renders correctly** in the political operations iframe.

- **Quorum acceleration for chair elections.** When more than half of a party's members have voted and the chair seat is vacant, the remaining election timer is halved — so a clear mandate fills the seat faster.

- **Discord webhooks for China and Ireland.** Game-event notifications now fire for Chinese and Irish channels alongside the existing country feeds.

### ⚙️ Mechanics

- **Sector subsidies reduced from +15% to +7.5% per subsidy.** Each national or state subsidy now provides a moderate +7.5 percentage point margin bonus instead of +15. Stacked federal+state subsidies together provide +15% total (down from +30%).

- **Influence-weighted leadership elections.** When a party uses influence voting (instead of one-member-one-vote), vote counts now display to two decimal places and an "Influence committed" badge explains the weighted tally method.

- **Player search covers Discord names and usernames.** The admin/moderator player selector, the universal search bar, and the character autocomplete now all search by character name, account username, and Discord handle — so typing someone's Discord name finds their profile.

- **Mod tools: Users list and Activity Log pagination.** The admin Users list now paginates at 25 rows (10 groups in Groups view). Duplicate-account groups are collapsible accordions. Activity Log has High/Medium/Low severity filtering and Prev/Next pagination.

- **Notifications auto-clear on open.** Visiting /notifications now marks everything as read immediately; the red dot on the navbar clears as soon as you arrive.

- **Currency symbols replace flag emojis.** Flag emojis have been replaced with proper currency symbols across forex rates and all UI surfaces.

- **NPP donor base level.** Non-player politicians now start at influence level 1 instead of 0, so they have a foundation to build from.

### 🐛 Bug Fixes

- **NPP CEO profile links now work.** Clicking an NPP CEO link in a corporation page previously led to a dead page. Now correctly navigates to the NPP profile.

- **Metric scores now comparable across countries.** Country metrics like median income were scored against a single scale that penalized non-US countries due to currency differences. All countries now score on the same USD-normalized basis, so the US, Japan, China, and others are compared fairly.

- **Notification bell no longer shows a phantom badge for unread mail.** The bell icon now only lights up for actual notifications. If you have unread mail but no unread notifications, the Notifications page now shows a hint like "All caught up · 3 unread in Mail" so you know to check the Mail tab.

- **5G/Infrastructure strategy buffed.** The telecommunications 5G strategy was previously a trap — it produced less network_services and software than Standard while demanding more inputs, so there was never a reason to pick it. It is now a proper network_services specialist (highest network output of the three telecom strategies) with infrastructure-focused demand reflecting tower and fiber buildout rather than crushing electronics consumption.

- **Closed a cross-country party-meddling exploit.** Players can no longer reach into another country's politics — e.g. a Chinese party leader could previously chip away at a US party's organization in a state. Contest, organizing, GOTV, suppression, and NPP actions now only work on parties in your own country, and the region politics tab no longer shows those actions when you're viewing a country that isn't yours.

- **Voter registration now influences the US presidential race.** A state's party registration lean now tilts the presidential vote the same way it already did for Senate, House, and Governor races — entrenched parties are harder to peel in states where they hold a strong registered base. The Registration Influence panel on the presidential page now shows each state's real party-lean breakdown instead of "no data tracked."

- **Third parties can now build voter registration.** A party that grows its organization in a state now steadily builds a registered-voter base there, instead of being stuck with none.

- **Central bank appointments now work for first-chair vacancies.** The People's Bank of China (and any future central bank without a sitting chair) now correctly resolves lobbying into appointments at turn time.

- **FX↔inflation deflation loop dampened.** Currencies in deep deflation no longer get locked in a self-reinforcing spiral where appreciation keeps dragging inflation lower.

- **Corporation dissolution conserves money** via salvage value and in-kind equity distribution, and is blocked until a corp is 24 turns old.

- **Party treasury displays in local currency** without double-converting through FX.

- **Withdrawn candidates no longer appear** in primary polling.

- **Election LARP years now honor the active preset** (1991 vs 2019) instead of defaulting to 2020.

- **Tab tooltips added** to the corporation detail page, country parties page, and stock market page. Hover any tab to see what it contains.

- **Sector split UI streamlined.** The Small / Normal / Large split-size dimension has been removed from sector-market-share attacks. Only the Full vs Half strength choice remains. The strength selector is now exposed directly on unowned market cards in the state Economy tab, so players can pick Full or Half strength and see live cost, marketing-strength cost, estimated capture, and capture percentage without leaving the state page. The sector detail page's Attack panel was updated to match.

- **1991 budget balance fixed.** Historical-start budgets no longer treat modern policy costs as if they were 1991 nominal spending, preventing extreme US / UK deficits from distorting inflation and central-bank diagnostics.

- **Corporation spend errors now show the correct currency symbol.** Sector operation error messages (expansion, retooling, cancellation) previously hardcoded `$` regardless of the corporation's actual currency — a Japanese corp would see `$` instead of `¥`, a German corp would see `$` instead of `€`. Fixed to use the corporation's local currency symbol.

- **Build Org now checks live state.** The Build Org action reads the current state of the party's organization instead of a potentially stale cached value.

- **NPP politicians now vote party line by default.** Non-player legislators now align their votes with their party, reducing random abstentions in closely divided chambers.

- **Non-office NPPs campaign for influence.** NPP politicians without an elected seat now actively build influence through campaigning instead of staying idle.

- **Opposition Leader correctly excluded when no government is formed.** The largest party is no longer automatically named Opposition Leader before a government exists.

- **Stock market maker is now treasury-backed.** The automated buy/sell orders that keep public-float shares liquid now draw from the corporation's treasury.

- **1991 market recompute preserves owned shares.** Reseeding the 1991 preset no longer resets player-owned markets to their default sizes — existing owned markets are preserved.

- **Auth cookie collision fixed for sandbox environments.** The login cookie now includes an environment prefix so sandbox and live sessions don't interfere.

### 🐛 Bug Fixes

- **Dividend Yield chart shows the actual payout rate, not 0% on pass-through corps.** For corporations with a legal minimum dividend (LLP 25%, LLC 20%, etc.), the chart previously showed 0% if the CEO never explicitly set a rate — even though dividends were being paid at the legal minimum. Now reflects the enforced rate.

- **Dividend income now appears in the status bar for pass-through corps.** The status bar was filtering out corporations where the CEO hadn't set a dividend rate, missing pass-through structures (LLPs, LLCs) that pay dividends through their legal minimum. Your dividend income will now show when hovering over personal cash.

### ⚙️ Mechanics

- **Telecommunications sectors now have state specializations.** New Jersey, Georgia, Dublin, and Huanan (South China) now recognize telecommunications as a secondary sector specialization, giving telecom corporations in those regions the same +2% margin bonus that other specialized sectors already enjoyed.

- **NPP corporations are smarter about money.** AI-run corporations now check if their sectors are actually making money before spending. Losing sectors get dialed back; profitable ones get more resources. They only expand when profitable, and only pay dividends when they can afford it.

- **NPP corporations now exist across all countries.** The UK, Japan, Germany, China, Ireland, and Brazil each have 17 AI-run corporations (one per sector), joining the existing US set.

### ⚙️ Mechanics

- **CEO share buyback & escrow desk.** Corporations can now run share buybacks in two modes — Instant, or through an Escrow desk — set from the CEO Budget tab. The buy and issue modals show how many of your own corp's shares you can still acquire, and bond repayments can draw on escrow before defaulting.

- **CEO salary capped at 1.25× revenue.** A CEO's salary is now capped at 1.25× their corporation's revenue.

- **Preset-aware Electoral College & House.** On the 1991 start, the US Electoral College and House apportionment use the 1991 census instead of modern seat counts — so the map, electoral-vote totals, travel costs, and primary delegates all reflect the era.

- **You must hold a party for 24 turns before its leadership.** New members now wait 24 turns before they can run in or vote in a party's national, state, or caucus leadership elections.

- **One Party States can appoint any player to cabinet.** China's State Council can appoint any eligible player to cabinet, not only sitting legislators.

- **Dual-office Public Scrutiny choice.** If you hold both a state and a national office, you now choose which Public Scrutiny pool a spend comes from.

- **GOTV, suppression & turnout in every country.** Get-out-the-vote and suppression actions, and turnout data, now work across every playable country.

- **Hard whips bind non-player legislators.** When a leadership, PM, or cabinet whip is hard, NPP legislators now comply.

- **Bill discussion threads.** Legislators can now discuss bills in threaded comments on national and regional bill pages, with thumbs up/down reactions.

- **China's NPCSC and CPPCC chairs.** Two new Chinese offices are live — the NPCSC Chairman and the CPPCC Chairman — each with its own panel and election.

- **Germany's Bundestag seats all 630 members.** The list-tier (Landeslisten) seats now fill automatically, so the Bundestag seats its full membership.

- **Party officers can manage NPP-held offices.** A party's officers can now handle orders, legislation, devolution, and bill assent for regional offices held by NPPs.

- **Game clock keeps to real time.** The game clock now converges to wall-clock time instead of only ever running ahead.

- **Countdowns show remaining turns.** Election and vote countdowns now show how many turns are left.

- **Presidential vetoes posted to Discord.** US presidential vetoes are now announced on the game-events webhook.

### 🎨 UI

- **Player corporation pages reskinned.** Corporation surfaces have a refreshed market-instrument look.

- **Interactive Persuasion Drivers.** The election Persuasion Drivers card now lets you choose which candidate and opponent to compare, and shows presidential and governor coattail effects.

- **Banner-ad cooldown shown in turns.** The player-ad composer now shows your submission cooldown as a turn countdown.

- **Consistent political-lean labels.** Candidate, party, and region political-lean labels now share one scale, with the exact score shown on hover.

- **Legislation pages refined.** Bill pages gained effect tags on provisions, an all-party whip count, a member vote-history panel, and a seating chart on state bills; government hubs show a country-correct chamber composition chart.

- **Per-metric projected effects on bills.** Bill pages now show each metric's projected effect direction (versus current law) instead of one direction applied to every metric.

- **Inflation breakdown shows monetary stance.** The central-bank inflation breakdown now includes a monetary-stance driver in its tooltip.

- **More legislation page refinements.** Bill detail shows archetype approval reactions, the cross-pressure member list paginates, and the Current → Proposed view stacks on mobile.

### 📚 Content

- **UK agriculture & technology bills.** New agriculture and technology legislation types for the United Kingdom.

- **Ireland artwork.** Region hero banners and a Dáil chamber header for Ireland.

- **Demographics for every country and era.** The Demographics & Turnout tab now populates for all countries on both the 1991 and 2019 starts.

- **Ireland & China spending budgets.** Both countries now seed their default spending laws so their budgets show real expenditure, with 1991 figures tuned to era-realistic deficits.

- **China's PRC leadership uses its proper titles.** Chinese PRC offices now use their real titles (General Secretary, Secretariat, CMC Chairman), and the head of state shows as President of the PRC.

### 🐛 Bug Fixes

- **Sector trades logged correctly.** Buying or selling a sector now shows as a Sector Purchase / Sale instead of "Founding Capital."

- **Closed a cross-country vote leak.** Foreign legislators can no longer slip into another country's bill tally.

- **Party member counts stay accurate.** Counts reconcile every turn, and players who leave or get purged are cleanly removed from leadership races and votes.

- **Purges only block the purging party.** Being purged blocks rejoining that party for 24 turns, but you can join other parties immediately.

- **Party merges are clean.** A merge transfers seats and coalition slots to the surviving party and clears the absorbed party's leftovers.

- **Candidates with personal pull aren't zeroed out.** A candidate with influence but no party organization is no longer dropped to 0% — personal reach now sets an organization floor.

- **Region political lean reads on the right scale.** Region lean now displays on the −5…+5 scale and ignores foreign voter groups.

- **End-of-race surge timed correctly.** The closing-days polling surge is keyed to turns, not the game clock.

- **Campaign-upgrade prices match the button.** Cost previews now include the general-election surcharge, so an affordable-looking upgrade no longer errors with "Insufficient funds."

- **Hostile-takeover bond payoff works everywhere.** "Pay off bonds" no longer fails with a server error.

- **CEOs can't trade their own bonds.** CEOs, incoming CEOs, and recent former CEOs are blocked from buying their corporation's bonds.

- **Corporation pages no longer error on CEO actions.** Founding or taking over a corporation no longer throws server errors.

- **Build Org where you have a presence.** Parties present in a state but without an organization record can now Build Org and Contest there.

- **Archived campaigns are read-only.** Campaigns that lost a primary are hidden from the elections list and can't be managed through a direct link.

- **Tariff origin picker fixed.** The tariff origin-country selector loads its country list correctly.

- **Discord bot fixes.** Avatar and logo thumbnails render in embeds, `/predict` works for Ireland, Brazil, China, and Nigeria, and Ireland's Dáil seat counts are correct.

- **Correct office labels in party rosters** for every country.

- **Local currency for corporation region spending.** Region-economy actions are charged and shown in the corporation's own currency.

- **Share-buyback escrow no longer distorts share price.** A corporation's buyback escrow is no longer factored into its share price, fixing a crash and price-distortion case.

- **China bill proposing and voting fixed.** Proposing agriculture/technology bills no longer crashes the form, empty categories are hidden, and Chinese chamber and vote eligibility resolve correctly.

- **Cabinet regional breakdown sorts correctly.** Clicking a regional breakdown column header now actually sorts it.

- **US region turnout shows up.** The Demographics & Turnout tab now shows US region turnout that was previously blank for some regions.

## v0.3.0 - 2026-05-24

### ⚙️ Mechanics

**Playable Countries: United States, United Kingdom, Japan, Germany, China, Ireland.**

- **Ireland is now playable.** Pick Ireland on the character-creation screen to play in the Republic of Ireland's parliamentary system. Run for a Dáil seat in one of 8 regions (PR-STV multi-seat constituencies), aim for Taoiseach through coalition government, or run nationwide for Uachtarán na hÉireann (President of Ireland) on a 7-year term, although the President election feature is not yet active and will be added soon. The Tánaiste is now a first-class office. Every region has a Local Council with its own Cathaoirleach / Mayor running on a 5-year cycle. The Seanad shows a cosmetic composition panel for now while the player-facing Seanad loop is designed. Áras an Uachtaráin has its own page with the sitting Uachtarán and the Council of State. The Cabinet of Ireland is a parliamentary cabinet shell. The Taoiseach delivers an "Address to the Oireachtas." Ireland's economy, regions, parties, demographics, and legislation catalogue (taxes + 41 national + 4 regional types, all wired through revenue calc) come with the rollout.

- **China's regime can now lose the confidence of its people.** Sustained economic mismanagement, repression, and unpopular policy now feed a public-legitimacy gauge that, if left to slide, escalates through public discontent → mass unrest → faction defection → regime collapse and forced transition to a multi-party parliamentary system. New reform tools (legalize a banned party, dial down vote multipliers, hold an honest by-election, anti-corruption purge, constitutional amendment) give the regime real off-ramps. The Premier can also announce a constitutional convention as a voluntary off-ramp — negotiating the target system, a legacy seat reservation for the former ruling party, and the timing of the post-conversion snap election. The country overview shows a public Regime Stability panel; the Premier sees a full Regime Health diagnostic tab on the executive hub. Collapse is intentionally slow — sustained mismanagement takes a long stretch of turns to actually topple a regime, leaving room to course-correct.

- **NPP names match their country.** China's NPPs are named in Chinese, Germany's in German, Ireland's in Irish/English, and so on across every country. The old Anglo fall-through pool is gone.

- **CN provincial legislatures and provincial governors are live.** Provincial People's Congress delegate elections resolve on a one-party model, flowing from provincial representatives up to the national NPC. Provincial governor elections now schedule at bootstrap. The CCP starts with a fuller regional NPP roster.

- **A Bundestagspräsident race opens automatically after every German general election** and the seat vacates on government transition.

- **Persuasion Drivers card extended to Senate, Governor, House, and State Senate generals.** Previously only presidential generals broke down each candidate's swing by source; now every general race does.

- **Election panels show why the Run button is disabled.** New-character cooldown countdowns surface on election cards, and a mid-flight extension to election duration retroactively applies to in-flight elections.

- **Character creation UI overhaul.** The character creation page now starts with a "World State" card showing the in-game date and era-specific flavor text (e.g. "the Cold War has just ended" for 1991, "the world is on the brink of the 2020s" for 2019). Country buttons use real flag images instead of emoji flags. Each country displays its registered player count. Selecting China shows a disclaimer about the one-party CCP system.

- **Discord linking during character creation.** You can now link your Discord in the character creation flow — it opens in a new tab so nothing gets lost, and the page auto-detects when linking is complete. Discord is recommended for coordinating with parties and nations.

- **Randomize button.** One click randomizes your country, name, home state, policies, and background — great for quickly generating starting points.

The first Beta 2 release lands the long-running political system rework. It rewrites how parties grow on the ground, how registration and turnout flow into elections, and how chairs, treasurers, and committees run their parties — and it adds Party Charters as the way to found new parties from scratch. Several country systems (UK Devolution, German Land Minister-Presidents, Japanese prefectural governors, UK First Ministers and the Mayor of London) come online as part of the same release.

- **China's regime can now lose the confidence of its people.** Sustained economic mismanagement, repression, and unpopular policy now feed a public-legitimacy gauge that, if left to slide, escalates through public discontent → mass unrest → faction defection → regime collapse and forced transition to a multi-party parliamentary system. New reform tools (legalize a banned party, dial down vote multipliers, hold an honest by-election, anti-corruption purge, constitutional amendment) give the regime real off-ramps. The Premier can also announce a constitutional convention as a voluntary off-ramp — negotiating the target system, a legacy seat reservation for the former ruling party, and the timing of the post-conversion snap election. The country overview shows a public Regime Stability panel; the Premier sees a full Regime Health diagnostic tab on the executive hub. Collapse is intentionally slow — sustained mismanagement takes 200+ turns to collapse a regime, giving the player room to course-correct.

- **Elections now run on a redesigned vote model.** General elections use a new pairwise-peel model that handles three or more candidates more naturally and now exposes _why_ each candidate is moving — incumbency advantage, fundraising, presidential coattails, sticky party support, and tribal pull all show up as named drivers on the new Persuasion Drivers card. The familiar base factors (candidate favorability, political influence, policy appeal to each voter group, and party organization in the state) still feed the underlying vote weight — the rework didn't replace them, it sits on top and explains the swing between candidates. Diff-tests keep typical margins within the same range as the previous engine, but multi-way races behave more sensibly.

- **Registration, Organization, and Support are now the three normalized inputs to vote share.** Registration is each party's slow-moving share of registered voters in a state, Organization is each party's on-the-ground presence in that state, and Support is sticky cycle-to-cycle voter loyalty. The election engine reads all three.

- **Each state now has its own median voter, and the presidential race blends per-state medians weighted by Electoral Votes.** This makes state races feel more local and presidential races more national.

- **Political Strength is the new currency for party actions.** Parties accumulate Political Strength as a reserve that grows from a small per-turn trickle plus a treasury-driven conversion. Building Org, contesting a rival, and other party actions spend that reserve. Spending repeatedly in the same state escalates a pressure ladder that makes the next action there more expensive — but spending in a different state doesn't.

- **Treasury can be converted into Political Strength through one chair-tunable lever.** Chairs set an explicit per-turn cash spend that converts treasury into PS at the expensive rate, and a small baseline trickle converts a fixed share of treasury at the cheap rate without debiting cash.

- **Primary elections now run for every chamber, not just President.** Senate, Governor, House, and State Senate primaries each get tier-aware surfaces with calendars, carve-ups, candidate lists, polling, and state-leader tables.

- **Founding a new party now requires a Party Charter.** Three real-player founders must each sign before the party is ratified. The charter sets the founding platform across four axes (economic, social, foreign policy, culture) and includes a "founding cohort" of three NPP politicians spawned in the chair's home state and two adjacent regions.

- **Charter founders take on initial party offices.** When the charter ratifies, the proposer becomes Chair, the second founder becomes Vice Chair, and the third founder becomes Treasurer.

- **The vice-chair now inherits chair authority when the chair seat is vacant.** They can use the Chair Office, propose government formation in parliamentary systems, take coalition actions, etc. — but they don't formally become chair; the seat just sits vacant until elected or appointed.

- **Committee proposals were reworked.** Proposals pass with sixty percent of the filled committee + leadership roles voting yes; not voting counts as a no at expiry. Chairs, vice-chairs, and committee members can propose; treasurers can vote but not propose. Each proposal type has its own cooldown after passing.

- **The position-shift proposal now covers all four axes.** Previously only economic and social could be moved by amendment; now foreign policy and culture can shift as well. Each axis has its own long cooldown.

- **A new committee proposal vacates an officer's seat.** Chair, Vice Chair, and committee members can be removed by a passing vote. The target can't vote on their own removal.

- **A new Priority Region cluster lets chairs concentrate their party's PS spending.** Chairs pick two or three connected adjacent states (four with a "Governor anchor") and the party gets an effectiveness bonus on direct national PS actions in those states. The cluster is locked in once set and can't be changed for a long cooldown.

- **The Governor anchor rewards holding executive offices in your priority states.** When the party holds the state-level executive (US governor, German Minister-President, Japanese prefectural governor, UK First Minister or Mayor of London) in one of its priority states at the moment of setting, the cluster can include one extra state.

- **National Party treasury actions now default to two-person approval.** Send to Member and Transfer to State Party require the Treasurer plus the Chair (or Vice Chair) to both approve before the transfer executes. A new "Pending Transactions" list shows in-flight approvals.

- **Any party member can request campaign funds from the party treasury.** The request goes into Pending Transactions and waits for officer approval. The requester can never approve their own request, even if they hold an officer seat.

- **A new committee proposal toggles treasury actions between two-person and single-person approval.** All parties start in two-person mode; switching the mode goes through committee vote.

- **Treasury controls now reflect who can actually use them.** Regular party members no longer see any of the management surfaces at all — they get the read-only Treasury overview, the Donate card, the Pending Transactions list, the new Request Funds card, and the Treasury Transaction Log. Within the officer set, gating is finer: Tax is read-only for the Treasurer (Chair and Vice Chair edit), the Treasury Plan is read-only for the Chair and Vice Chair (Treasurer edits), and the chair-level budget controls (GOTV / Suppression / PS Investment) are hidden from the Treasurer entirely.

- **Campaign Manager backend extended to US Senate, Governor, House, and State Senate.** The strength gate, eligibility checks, and race-family-aware copy + budget scaling all support non-presidential races now — a State Senate campaign will price upgrades and income at State Senate magnitudes rather than presidential ones, and a House campaign at House magnitudes. The Campaign Manager UI panel itself is still hidden for non-presidential races while related fixes are pending; until that panel lights up, elections in those races resolve normally on the base mechanics (party Org, Registration, favorability, political influence, policy alignment, incumbency, coattails, support). Campaign Manager is a strategic layer on top — players who can't use it yet aren't penalized; they just don't get the extra fundraising-driven swing.

- **UK Devolution drifts each turn with a per-region Independence Desire.** Government policy choices and election outcomes push the dial; high readings tilt elections toward pro-independence parties.

- **UK First Ministers, the Mayor of London, German Minister-Presidents, and Japanese prefectural governors are now first-class regional executives.** They run perpetual elections, appear in state-overview chips, and sign or veto state bills like US governors.
- **House and Senate now elect Majority and Minority Whips alongside their party leaders.** Whip elections follow the same schedule as leader elections and are resolved automatically each turn. Whips are authorized to issue party whips in their respective chambers.
- **Close corporations with shareholder caps can now issue private share invitations.** CEOs of corporations with capped legal structures (like US S-Corps, limited to 100 shareholders) can invite specific characters to purchase private shares at a fixed price per share.
- **Inflation is now harder to run away.** The model pulls back toward 2% over time, clamps single-turn swings to ±1.5 percentage points, and reacts more smoothly to shocks.
- **GDP growth no longer locks in permanently inflated policy deltas** from pre-clamp cabinet orders. The sector baseline now initializes correctly, and policy deltas are capped at ±8.
- **Cabinet ministerial orders now have a per-metric cap** so a fully staffed cabinet can't stack unlimited growth modifiers on the same metric.
- **Wage growth now updates dynamically each turn** based on unemployment vs the natural rate and GDP growth, instead of staying frozen at its starting value.
- **Committee election term extensions now apply to committee races too,** not just national leadership elections.
- **China's legislative elections are now live.** Provincial People's Congress delegate elections run on a one-party model, resolving from provincial representatives up to the NPC. Provincial governor elections are now also scheduled at bootstrap.

### ⚙️ Mechanics

- **The campaign now starts in January 2019** instead of 2020.

- **A new alternative game-start preset launches the game in 1991** with hand-curated historical seats for the US, UK, Germany, and Japan, and 1991-era default parties (UUP in Northern Ireland, PDS in East Germany, JSP and DSP in Japan). A follow-up audit pass resolved silent failures in bundle loading, election scheduling, and party bootstrapping for this preset.

### 🎨 UI

- **Every state page leads with a new State Overview tab.** Headline KPI strip, all-party Org pie chart, Political / Economy / Primary / Watchlist cards, and a regional-executive chip showing who currently holds the state's top executive office.

- **A new Battleground Map shows the current state-by-state competitive picture** for general elections, with per-candidate hover cards.

- **A new Persuasion Drivers card breaks down where each candidate's vote share is coming from** (incumbency, money, coattails, support, etc.).

- **A new Registration Influence card shows how each party's registration share is shifting** in a given race.

- **Build Org and Contest tiles now show what the action will cost AND what it will gain before you click.**

- **PS-spend tiles animate and glow when an action lands** so the player sees the system respond.

- **Both Build Org and Contest now visibly call out a "Priority Region" bonus** when the targeted state is in the spending party's cluster.

- **Chair Office gets a Priority Region card** with a state picker that auto-dims non-adjacent options as you pick and shows a "Gov" badge on states where the party holds the state-level executive.

- **Party Charters has its own UI at /charters,** reachable from the Nation dropdown next to Political Parties. List view, draft wizard, detail view with founder roles + sign/reject actions.

- **Founder invitations and charter ratifications send notifications** to each founder so they don't have to be told out-of-band that they were named or that their party is now live.

- **Committee proposals get a new modal type for the treasury approval mode toggle.** The currently active mode is greyed out so you can't propose to keep things the same.

- **The Treasury tab now shows a Pending Transactions card above the transaction log.** Approver slots appear with the approver's name and an indication of whether they auto-approved at propose time or clicked approve later.

- **The China executive hub gets a Regime Health diagnostic tab** for the sitting Premier — popular legitimacy, party confidence, the current escalation stage, the next reform's projected effect on each scalar over the next 48 turns, and one-click reform actions. The selective-concession reform now asks which banned party to legalize rather than auto-picking the lowest-loyalty one.

- **Country pages with one-party regimes get a public Regime Stability panel.** A high-level severity-coloured stage chip and an in-character LARP blurb explain what stage the regime is in without exposing the underlying numbers.

- **CN executive hub gets an Admin tab** (red, after Regime Health) that lets admins force a stage transition, set scalars directly, or trigger a forced conversion without leaving the page.

- **Áras an Uachtaráin page.** Sitting Uachtarán, election link, and the Council of State (ex officio members).

- **IE Oireachtas page with a Seanad chamber switcher.** The Seanad tab shows a cosmetic composition panel for now while the player-facing Seanad loop is designed.

- **The Government of Ireland (Cabinet of Ireland) page is now a real parliamentary cabinet shell** instead of a placeholder.

- **Parliament charts scale up to the size of the National People's Congress.** Previously, very large chambers (the CN NPC has nearly 3,000 seats) overflowed the chart with overlapping seats; the renderer now picks row counts and seat sizes based on total seat count.

- **Taiwan no longer appears on China's regional map** in either the 1991 or 2019 starting state. It was previously drawn as part of the HD (East) region.

- **A new Request Funds card on the Treasury tab lets any party member request campaign funds** with an optional note.

- **German Bundesländer get hand-picked landmark banner images.**

- **Political Strength now appears as a stat in state and national party headers.**
- **Close corporations get a new Manage Private Shareholders panel** for issuing and tracking private share invitations.

### 🔧 Platform

- **Cron platform migrated from Vercel to Railway.** The game's per-hour turn engine no longer depends on Vercel cron and runs on a self-hosted node-cron schedule with a backup-fire guard against double-fires.

- **Auto-pause behavior tightened.** The simulation now pauses when the cron service actually goes silent, rather than when the game clock drifts (which could be triggered by daylight-saving time or browser tab throttling on the dev side). When auto-pause kicks in, the reason is surfaced to moderators and on the turn-controls panel.

### 🐛 Bug Fixes

- **Selecting your country at character creation now shows real per-country starting context.** China selection shows a disclaimer about the one-party CCP system; the in-game date and a short era flavor blurb tell you what world you'll be playing in.

- **Background NPP politicians actually campaign now.** NPPs who don't currently hold an office were sitting idle on per-turn campaigning because they had no campaign priority assigned; they now build influence like everyone else.

- **Campaign Manager endorsements now work for any same-country race**, not just the CM's own race-family.

- **Bill UI previews now read direction correctly.** Options that lower a metric whose lower value is "better" now read as the right color; the previous engine sometimes flipped them. The Japan, Germany, Ireland, and China legislation catalogues had a related convention bug that's now corrected.

- **Minimum-wage bills no longer falsely list unemployment rate as one of their metric effects.**

- **Game reset now auto-enables maintenance mode** so players don't catch the world in a half-seeded state while bootstrap settles. Mods turn it back off when the reset is verified.

- **Position-shift proposals that "passed" but never moved the position are now recovered.** Previously, if a party had a missing position field on one of the four axes, the first passing shift would persist NaN, and every subsequent shift would re-read NaN, re-write NaN, and silently no-op. The engine now treats non-finite as neutral zero and the next passing shift recovers the party.

- **Election timers and primary calendars now display turns relative to the current turn,** instead of the wave-table offset.

- **State bill assent now routes through the country-aware regional executive.** German bills are signed by the Land Minister-President, Japanese bills by the prefectural governor, etc. — not the US governor stand-in.

- **State Overview's regional-exec chip shows the correct party abbreviation,** with correct casing for the state ID.

- **Resetting the game to the 1991 preset no longer hits a counter collision** when introducing preset-only default parties. Preset-only parties are now seeded before historical NPP seeding.

- **Charter drafts now reject names + abbreviations that match preset-gated default parties,** even when that default isn't currently seeded — so switching presets doesn't suddenly create a duplicate-name row.

- **Cross-country founders are rejected at charter draft time** instead of letting an incoherent charter sit in pending-signatures.

- **The president primary page now shows an empty state when no candidates have filed** instead of returning 404.

- **Tier-primary pages distinguish "no contest", "pre-primary", and "leader resolved" states** instead of conflating them.

- **Tier-primary maps now show stable per-state colors and meaningful state-leader tables** even before votes are cast (ranked by projected primary score).

- **Election-detail surfaces primary-map pills for every tier,** including tiers where nobody has filed yet.

- **Discord bot bulk sync-roles no longer crashes** when a linked character holds no party (post-purge or just-joined state).

- **UK region pages show First Minister / Mayor of London chips and Office buttons in the hero header.**

- **UK Devolution backfills `independenceDesire` on stale DBs** so old saves aren't missing the field.

- **The election status strip no longer mislabels stages** for upcoming races whose timers were modified by an admin.

- **Coalitions now update their chair when the lead party's chair changes through any path** — not just regular party-leadership elections. Previously, removing the chair via committee vote, a chair retiring, a banned-user cascade, or an admin reassignment would leave the coalition still showing the old chair until a brand-new party-chair election happened to resolve. The coalition's listed chair now follows the lead party's actual chair immediately on a committee-vote removal, and within one turn for the other paths.
- **Better error messages when trying to vote in an ended election cycle.** Instead of a generic 400 error, the message now tells the player to refresh for the next cycle.

- **Bond issuance no longer raises a false equity violation for non-anchor corporations.** The form was sending the raw local-currency amount to the server, which expects anchor units (₳); for corps whose local currency is weaker than ₳, this inflated the debt-ceiling check and blocked issuances that were within the allowed limit. The submit handler now converts to ₳ before posting. Bug #1698.

- **Chinese region display names switched to Pinyin.** State pages and election maps for China now show Dongbei, Huabei, Huadong, Huazhong, Huanan, Xinan, and Xibei instead of the generic English equivalents.

- **Primary NPI reach diminishing-returns curve re-enabled.** The curve that reduces the marginal return on very high NPI in primaries had been accidentally disabled; it is now active again.

- **Registration entrenchment in primaries softened.** Reg-entrenchment coefficients for tier-3 calibration were over-tuned; they have been reduced so registration shares respond more naturally to player actions.

- **Pending treasury approval slots no longer corrupt on save.** Undefined approval slots were being persisted as BSON null, causing stale null entries to interfere with the two-person approval check. Slots are now omitted when not yet filled.

- **The Party Charters link now appears in the mobile hamburger menu.**

- **Charter invite notifications are now clickable** and route to the correct charter detail page. The Nation dropdown "Party Charters" entry is also correctly hidden when not yet applicable.

- **CN regional map now hides Hong Kong and Macau in the 1991 preset.** Hong Kong wasn't returned to the PRC until July 1997 and Macau until December 1999, so showing them as part of China was wrong for 1991 starts. The map switches automatically to the modern (Hong Kong included) version once a campaign reaches July 1997. Taiwan is still drawn as part of the EAST region — that's a separate, larger issue.

- **CN macro-regions now use Pinyin abbreviations** (Dongbei = DB, Huabei = HB, Huadong = HD, Huazhong = HZ, Huanan = HN, Xinan = XN, Xibei = XB) instead of the English compass codes. State URLs and IDs change accordingly. A world reset is required to migrate existing CN campaigns to the new IDs.

- **DE Bremen's internal state code is now `BRE`** (was `HB`), to avoid a database conflict with CN Huabei (also `HB` in Pinyin). The two-letter Hansestadt abbreviation `HB` is preserved as the displayed map label, but URLs and lookups now use `BRE`. A world reset is required to migrate existing DE Bremen campaign data.

---

# Beta 1

_Beta 1's final release was v0.2.20 (2026-05-22). Everything below this line is Beta 1 history._

## v0.2.20 - 2026-05-22

### 🐛 Bug Fixes

- **Stock market index restored to normal levels.** MOP (Means of Production) had performed a large forward stock split that inadvertently exploited a price floor in the share price formula, inflating its market cap from ~€27B to ~€2.6T and driving the Global Market Index up +5,240%. MOP's shares have been administratively reverse-split to their pre-exploit count. The share split mechanic now blocks any forward split that would take the per-share price below the minimum floor.

## v0.2.20 - 2026-05-21

### ⚙️ Mechanics

- **State metrics now use one shared cross-country catalog.** Metrics that used to be US-only, UK-only, or Japan-only are now available consistently across the simulation when seeded/backfilled, including productivity, trade balance, R&D intensity, public care wait times, housing supply, debt-to-GDP, energy transition, demographic decline, and more.
- **Corporate margins now react to many more state conditions.** Sector profitability now considers a full strategy-aware state metric profile instead of only a handful of headline metrics. A technology sector cares more about digital infrastructure and innovation; manufacturing cares more about logistics, skills, grid reliability, and environmental compliance; healthcare cares more about health capacity and demographics.
- **Sector strategy changes blend their metric effects during transition.** When a sector changes strategy, the metric profile now gradually shifts from the old strategy to the new one instead of snapping instantly.
- **National budget balance and debt metrics now come from actual budget records.** National metrics pages now use the country's budget/GDP/debt data for fiscal health instead of only aggregating regional rows.
- **Inflation now includes housing/rent pressure.** High national cost-of-living readings now push inflation upward, making housing pressure visible in the macro model.
- **Unowned sectors no longer create such a strong recession floor.** Background unowned-sector growth has been reduced so real corporate contractions can pull state GDP growth negative.

### 🎨 UI

- **Corporation sector margin panels now explain metric effects.** The margin breakdown has a collapsible "Metric effects" section showing the strongest positive and negative state metrics affecting that sector's profitability.
- **Metrics pages show the unified metric set.** Countries no longer hide useful metrics just because they started as another country's seed field.
- **News loads faster on first visit.** The news page now server-renders the first article page and includes a short public intro for discovery/crawler previews.

### 🔧 Platform

- **Production metric backfill included.** A new migration backfills missing state metric fields and matching baselines, then recomputes national metrics.
- **Sector margin audit tool added.** Admins can compare old vs. new state metric margin effects across live sectors before or after rollout.
- **Private corporation share-market design documented.** The private-corp outside-investor/order-book design for bug #0562 is now captured for implementation.

### 🐛 Bug Fixes

- **Election timers and phase labels now use the game clock.** Election phase displays (endorsements, office pages, dashboards, canvassing eligibility, PIP, wiki live-stats, and the landing page) now read from the game turn instead of the real-world clock. This fixes inconsistencies where phases appeared wrong because of cron lag or daylight-saving time.
- **The game now auto-pauses if the turn processor falls too far behind.** If cron drift exceeds 4 hours, the simulation automatically pauses and surfaces the reason to moderators and turn controls. A warning banner appears at the 2-hour threshold.
- **Coalition join/accept/leave/kick no longer corrupts party membership.** Fixed a bug where a party could silently end up in two coalitions at once if an invite or join request was accepted after the party had already joined a different coalition.
- **German national-party "State Parties" tab shows the correct regions.** The 16 German Länder (e.g. Baden-Württemberg, Bayern, Berlin) now appear instead of the 50 US states. Bug #0568.
- **Election status strip no longer shows "Opens in Ended."** Fixed a visual glitch that could appear after an admin modified election timers while a race was in the upcoming state.

### 🔧 Platform

- **Maintenance-mode page is now gated earlier in the request stack.** Prevents the brief flash of normal UI before the maintenance screen loads.
- **Turn scheduling is now immune to daylight-saving time shifts.** The cron runner uses UTC to eliminate seasonal drift.

### 🇩🇪 Germany

- **Germany map overview API now supported.** The `/api/country/DE/map/overview` endpoint returns lean, approval, and party organization data for Germany's interactive map (previously UK and CN only).

## v0.2.19 - 2026-05-19

### 🏛️ Governor's Office (new subsystem)

- **The Governor's Office is open for business.** Every state governor — and every parliamentary regional executive (Minister-President, etc.) — gets a new "Office" page at their region with five tabs: Overview, Address, Orders, Endorsements, and Legislation Queue. All four action types spend from a shared "Office AP" pool (cap 3, regenerates +1 every 18 turns).
- **State of the State address.** Governors deliver a written address with a title, optional speech body, 1–3 emphasized policy categories, and an optional voter-group target. The address gives a temporary approval bump in your state, nudges co-partisan NPP votes on bills in your emphasized categories, and (if you targeted a voter group) boosts that group's turnout in your state for the address's duration. Cooldown applies between addresses.
- **Executive Orders (US) / Orders in Council (UK / DE / JP / etc.).** Issue a temporary ±1 policy nudge (or ±2 with extra AP) on any state-level policy. The order shifts the underlying policy by one or two slots for the order's duration or until rescinded, and is automatically superseded if a real bill passes setting that same policy. Two slots per office.
- **Governor endorsements.** Endorse a candidate from your party running in a race within your state — including federal House and Senate, your state's slate of presidential primary/general candidates, and sub-national legislative races. Endorsements give the endorsee a small boost in your state's race plus an ongoing campaign-actions boost. Auto-withdraws when the election ends, the candidate becomes inactive, or you leave office.

### 🇺🇸 / 🇬🇧 / 🇩🇪 / 🇯🇵 White House / Executive Office

- **National Address.** The sitting head of government delivers a national-scope address — "State of the Union" (US), "Address to the Nation" (UK), "Government Declaration" (DE), "Policy Speech" (JP). Same effects as a state address, except the demographic turnout boost fans out across every state in the country with per-state headroom clamping. Auto-posts to the news wire.
- **Executive Orders / Orders in Council at the federal level** — US President issues "Executive Orders"; UK PM, DE Chancellor, JP PM issue "Orders in Council." Federal-scope policy nudges on national legislation, two slots per office.
- **Endorsements from the head of government.** Endorse candidates in any state (filter by state in the UI) running for upper or lower chamber, regional executive (governor / minister-president), or sub-national legislature. Same in-race vote multiplier + campaign-actions boost as governor endorsements. Cross-party blocked. Auto-withdraws under the same conditions.
- **New tabs on the parliamentary executive pages** (UK / DE / JP / etc.) — the existing executive hub became an "Overview" tab, and Address / Orders / Endorsements tabs sit alongside it, visible only to the sitting PM / Chancellor (or an admin).

### 📰 News Wire

- **Address delivery posts to news.** Every State of the State / State of the Union / Address to the Nation / Government Declaration / Policy Speech gets a news post with the title, who delivered it, and the speech body when provided. Discord webhook subscribers receive these in the "executive" category.
- **Order issuance posts to news.** Every Executive Order / Order in Council generates a news post listing the policy area and the option transition (e.g. "Shifting from Moderate to Progressive").

### 🛡️ Admin

- **Admin Override on Address and Order issuance.** Admins can act on behalf of any state or national office — including vacant or NPP-held seats — by enabling the override toggle in the modal. AP / NPI / cooldown all waived; the row is tagged so admins can audit override usage later.
- **Game Reset now wipes Governor's Office state** — addresses, orders, endorsements, queued bills, office AP pools, and per-party demographic favorability. Reset also clears stale character pointers so authenticated users with deleted characters no longer get stuck in a login redirect loop.

### ⚙️ Mechanics

- **Endorsement vote multipliers tuned down** for both governor and presidential/PM endorsements. Endorsements remain materially valuable — they also boost the endorsee's campaign actions — but no longer single-handedly tip close races.
- **Per-party demographic favorability.** When the head of an office delivers an address targeting a voter group, their party gets a temporary appeal boost with that group during elections, on top of the turnout effect. Independent leaders skip this.

### 🐛 Bug Fixes

- **Game Reset login redirect loop fixed.** After a Game Reset wiped characters, authenticated users with stale character pointers got bounced back to the login page in a loop. The pointer is now cleared on reset, and authenticated users without a character redirect to character creation instead of login.
- **Profile page no longer errors on character data.** Internal cleanup so the Profile page reliably renders the career-history section for all users.

## v0.2.18 - 2026-05-15

### ⚙️ Mechanics

- **Home-state surge now correctly deducts campaign funds in all currencies.** The one-time primary boost previously debited from the legacy `funds` field, which could leave the displayed balance out of sync in countries with the forex economy enabled. It now debits from the canonical campaign balance and guards against race conditions.
- **Caucus taxes now correctly debit campaign funds in all currencies.** The turn-phase caucus tax pass previously checked the legacy `funds` field when deciding whether a member could afford their share, which caused incorrect skips or potential overdrafts in forex-enabled countries. It now checks the canonical balance and guards on the correct field.
- **Cabinet bill proposals no longer risk double-spending national political influence.** The proposal route previously calculated a new NPI total in JavaScript and applied it with `$set`, which could allow concurrent proposals to overspend. It now uses an atomic `$inc` decrement, matching the action-point guard. `src/app/api/country/[code]/legislature/cabinet-bills/route.ts`.
- **Corporate sector attacks now correctly escalate split costs under concurrency.** When two players attacked or split the same sector at nearly the same time, the marketing-strength cost escalation could be lost. Both attack paths now apply the increment atomically so the cost always rises as intended. `src/app/api/country/[code]/region/[id]/economy/attack-sector/route.ts`, `src/app/api/country/[code]/region/[id]/economy/attack/route.ts`.
- **German national policy proposals now apply at the correct scale.** Policy bills passed in the Bundestag were silently using the US 1/50 per-state divisor instead of the correct 1/16 for Germany's 16 Länder. All pending and new DE national policy effects now apply at their intended strength.
- **UK and JP cabinet transitions no longer leave ghost cabinet records.** In some cases, ministers from a previous government survived a VONC or election loss and remained listed in the cabinet. Cabinet state is now fully cleared on all government transition paths.
- **Party chair political influence bonuses now always apply.** In games with more than 10 players, the turn-phase NI bonus for party chairs was silently skipped. It now fires regardless of server-side player count.
- **Forex limit orders that get stuck processing now recover automatically.** Orders that entered a `processing` state but were never completed (e.g. due to a crash) previously required admin intervention. They now automatically reset to `open` after two turns so you don't lose pending trades.
- **Corporation shareholder votes now resolve the moment the threshold is crossed.** Previously a decisive vote (e.g. majority YES on a share issuance) would sit open until the turn processed. Voting now checks for resolution immediately, so share issuances and governance changes take effect right away.
- **Committee system temporarily removed.** The party national committee and congressional committee assignment features have been stripped out while a replacement design is prepared. This affects the Congress page (no Committees tab), party pages (no National Committee elections or proposals), and bill detail pages (no Committee Delay action). Committee chairs and committee-based voting are also gone for now.

### 🐛 Bug Fixes

- **Corporation dissolutions now pay every shareholder, not just characters (Bug #0540).** When a corporation was force-liquidated or dissolved through the bond-default flow, the system computed a total shareholder pool but only paid out the slices owed to character and imperial-character shareholders. The portions attributable to corporate equity holders and the public float were silently destroyed — on the Elevance Health dissolution this lost about $26.35B (≈47% of the pool, owed to General Electric and Whitlam Manufacturing Corp). Corporate shareholders are now credited to their liquid capital, and any public-float slice is paid into the country's central bank reserve. The dissolve preview UIs were also misleading: the "Cash you personally receive" headline and the bond-default modal's "Est. shareholder pool" both showed the _total_ pool rather than the requesting CEO's pro-rata cut. Both surfaces now lead with the CEO's actual share and show a full distribution breakdown across every shareholder bucket. Affected corps from the Elevance Health incident will be made whole via a one-off compensation pass at the FX rate that was in effect at the time of dissolution.

- **Attacking another corporation's sector no longer fails with "Defender corporation not found."** A few corporations were dissolved in a way that left their old sector rows behind, which made those sectors show up in the regional economy view as "Unknown" attackable rivals. Clicking Attack Sector on one of them died immediately with "Defender corporation not found" and could block all attempts to split into that market. Those phantom rows are now hidden from the economy view, and any stale attack request that still hits one automatically cleans the row up and points you at Split Unowned Market instead. (Bug reports #0537 / #0539.)

- **Brazil inflation is now tracked separately from the US.** A code path that picks the federal budget document was routing Brazil (a presidential-government country) to the US budget instead of Brazil's own. Inflation history, chair scrutiny calculations, and the monetary policy panel for Brazil will now reflect actual Brazilian data going forward.
- **Party merge proposals no longer fail with "Invalid ID format."** Selecting a target party from the merge tab and submitting sent an integer sequential ID where the server expected a MongoDB ObjectId, causing every submission to be rejected immediately. The correct ID is now sent.

- **Additional country-scope validation added to state-changing routes.** A routine audit tightened query filters on several high-traffic endpoints (economy attacks, party whips, slate withdrawals, discussion moderation) so they only match entities belonging to the country in the URL. This prevents cross-country ID enumeration and ensures errors are returned consistently when an out-of-scope ID is supplied.
- **Sovereign debt crisis: countries stuck awaiting an executive decision now auto-resolve.** If a country enters the crisis decision window and no executive action is taken before the 48-hour deadline, the game now automatically repudiates the debt on their behalf rather than leaving them indefinitely in `crisisPending`.

### 🎨 UI

- **Nation dropdown now shows your current country and lets you switch.** The "Nation" menu in the top bar now displays the flag and name of the country you're viewing, and adds a "Switch Nation View" option to jump to any other configured country without leaving the page.

## v0.2.17 - 2026-05-14

### 📚 Content

- **Game Starting State page now supports a 1991 or 2019 start.** A toggle at the top of the dashboard switches between the two scenarios. 2019 is the canonical opening with full economy, party, and region data. 1991 currently shows the seeded historical seat composition (US 102nd Congress, UK post-1992 election, JP post-1990 election, DE 12th Bundestag) — macro economics and 1991-era party rosters are still being reworked. The admin reset preset is now labelled "1991 Start Date - Default Parties" to match.

### ⚙️ Mechanics

- **Presidential races now weight candidate ideology more heavily.** The election engine previously weighted the party's platform at 75% and the candidate's personal views at 25%. That has been flipped: candidate ideology is now the primary signal (75%), with party platform as a secondary modifier (25%). This makes spoiler candidates and crossover bids more viable, and makes candidate selection more consequential.

- **No demographic group is ever completely unwinnable.** A new appeal floor guarantees that even candidates far from a voter group's preferences approach zero support but never reach it. Every group is theoretically gettable with enough spending and ground game.

- **Voter archetype leans rebalanced across all 50 states + DC.** The demographic seed data that underpins every US election has been recalibrated and reseeded.

- **Withdrawn and primary candidates no longer render as "Unknown" on presidential maps.** Past primary contenders who still appear in state-level historical data now keep their names, parties, and party colors across the state map, the vote-over-time view, and the electoral-vote timeline.

- **Campaign panels now show real party names.** "Your Campaign" and "Campaign Operations" no longer show a numeric party id — they show the party's actual name (e.g. "Democratic Party") next to the candidate.

- **Minority governments can now form even when a majority bloc exists.** In Westminster systems (UK, Germany, Japan), a party that does not hold a majority can still bid for Prime Minister / Chancellor if no majority coalition has formally locked in support. Previously the game blocked these bids when any majority bloc existed; now the bid proceeds and the legislature votes, matching real-world convention.

### 📚 Content

- **1991 starting state: economy and resource data for all countries.** The 1991 wiki view now shows economy summaries, resource capacities, and sector specializations for Brazil, China, and Ireland (using the 2019 baseline) alongside the seeded countries.

### 🐛 Bug Fixes

- **Barnstorm now works correctly for UK and other non-USD characters.** Players with enough campaign funds could see the barnstorm button appear to do nothing. The underlying atomic guard has been fixed. Additionally, if any action fails for any reason, the error message is now shown directly on the interaction card instead of being silently swallowed.

- **German and UK regional officials display correctly.** The region page and admin tools now correctly label Landtag members and Regional Councillors in notifications and vacancy counts.

- **Campaign funds can no longer go negative.** Donations, influence buys, and party tax transfers now enforce floor guards so race conditions can't drive your campaign balance below zero.

- **NPP interaction panels now show campaign funds in your home currency.** Non-USD characters no longer see a misleading raw figure.

- **NPP AI behavior is more varied.** NPP characters were repeating the same action patterns too frequently; the action picker now diversifies across turns and the caching heuristic has been corrected.

- **Election countdown timers now track real time.** When the server falls behind its hourly schedule, election countdowns used to show the server's internal clock rather than the wall clock — so you might see "15 hours remaining" while the date said "ends at noon today." Countdowns now always reflect real wall-clock time.

- **Presidential election display improvements.** The election card now labels the popular-vote section "Popular Vote." The electoral-vote chart shows a dashed 270 EV threshold line. The endorsements section shows how many NPPs and players have endorsed each candidate, with type badges.

### ⚙️ Mechanics

- **Party membership actions now have anti-abuse guards.** Rapid joining, leaving, and returning to parties is now rate-limited. This prevents gaming party mechanics through rapid churn.

- **Sovereign debt crisis decision panel redesigned.** Before you commit to a resolution path, you now see a consequence table showing exactly what each option does — market lockout duration, GDP hit, exchange-rate impact, and bond-holder treatment — with severity color-coding. The current inflation rate is shown in the header. If the 48-hour auto-action deadline is approaching, a countdown badge is shown.

- **Pre-Crisis Risk Monitor is now collapsible.** The sovereign debt risk table on the World Crises page folds into an accordion so it doesn't dominate the page when there's nothing urgent.

- **Crisis severity badges.** Active crises now show a severity level (High / Medium / Low) based on their economic tick impact.

- **German Landtag elections now allocate seats to individual candidates.** Seats are distributed proportionally within each party using the Sainte-Laguë method, matching real German electoral law.

- **State economy page redesigned.** The in-game state economy view has been overhauled with a new card layout and clearer data presentation.

## v0.2.16 - 2026-05-11

### ⚙️ Mechanics

- **Choose how your loan pays itself.** Each central bank's loan tab now lets you flip your line of credit between **Principal + Interest** (the default — chips away at the loan over time) and **Interest only** (keeps your principal flat). Interest-only is handy for tight cash-flow turns, but adds 2.00% to your rate while it's on. You can switch back after 24 turns. The Portfolio loans pane shows a small **I/O** chip next to any currencies running interest-only so you can see at a glance which accounts are deferring principal.

- **Two new commodities: Network Services and Entertainment Services.** Telecom sectors now produce **Network Services** (broadband and connectivity capacity) as their primary unique output alongside software. Entertainment sectors now produce **Entertainment Services** (live events, streaming, and studio capacity) as their primary unique output. Both commodities have background macro demand that scales with state GDP, so even in regions with few Telecom or Entertainment sectors there is a baseline market for these services. Both are fully tradable, priceable, and visible on the commodity market page.

- **Commodity markets deep-rebalanced.** The v0.2.16 first-pass cap work stopped sectors from being destroyed by commodity costs, but several structural shortages remained. This pass targets the root causes:
  - **Extraction: diversified is no longer the only good choice.** The broad diversified strategy's output rates have been trimmed ~20%. Focused strategies (Iron & Metals, Oil & Gas, Coal, Copper, Timber) now supply 4–5× the diversified rate for their target resource, giving specialised extraction a meaningful edge over the hedge.
  - **Steel shortage reduced.** Nuclear Energy was the single largest steel consumer in the game (125 of 202 energy sectors). Nuclear steel demand has been cut by a third and redirected partly to iron. Renewables have also been made more attractive with higher output and lower electronics/rare earth inputs, shifting the energy sector mix.
  - **Oil and natural gas shortage addressed.** Oil & Gas focused strategy output up to oil 0.58 + nat_gas 0.32 (from 0.47 + 0.24). Combined with diversified rate reductions, focused oil & gas extraction is now the dominant supply lever for these markets.
  - **EVs now demand rare earth and software more than electronics.** Battery cathodes and vehicle firmware are the real cost drivers; circuit boards are not. Electronics demand for EV production down 0.30→0.22, redistributed to rare_earth (0.14) and software (0.16) with steel added (0.10).
  - **Food supply corrected.** After the v0.2.16 agriculture output increase, food reached D/S ~0.85× (oversupplied). Agriculture output has been trimmed back ~9% across all strategies.
  - **Healthcare no longer a commodity black hole.** Pharma and electronics input rates for hospital networks cut ~27%. Government healthcare macro demand reduced further (0.018→0.013). Financial services input to real estate cut 33%.
  - **Telecom now has a reason to exist beyond software.** Network Services is the new primary Telecom output. Electronics and copper input rates reduced to reflect capex-as-infrastructure rather than ongoing component consumption.
  - **Entertainment no longer just contributes advertising.** Entertainment Services is now the primary Entertainment output across all three strategies (standard, streaming, live venue).
  - **Construction and infrastructure inputs eased.** Building materials, copper, natural gas, and timber input rates reduced for general contracting. Infrastructure buildout adds building materials co-production. Live venue entertainment cuts construction_services demand.

- **Regional sector markets now have audited local specialties.** Every playable region in the US, UK, Germany, Japan, Brazil, China, and Ireland now has an explicit sector seed profile and opening specialty. Finance dominates New York, extraction dominates West Virginia and northern Brazil, technology leads California and Dublin, Bavaria and central Japan lean automotive, and China's northwest opens as an energy/extraction region. Sector seed sizes have increased ~4.5× across all regions, producing a significantly larger starting stock market.
- **The Game Starting State wiki now audits sector markets directly.** Its dashboard shows each country's primary (+10pp) and secondary (+5pp) sector-specialty bonuses by region, and the interactive map still lets you select any of the 17 sector types to compare starting market weights across countries and regions.

**Corporations**

- **Commodity markets rebalanced.** Several persistent structural problems have been addressed:
  - **Extreme market pressure is now capped.** No sector can have its margins collapsed below −30% or boosted above +30% by commodity prices alone, regardless of how many scarce commodities it consumes or sells. Energy, automobiles, construction, and healthcare should no longer sit near zero effective margin purely from commodity costs.
  - **Extraction is no longer the easy button.** The diversified extraction strategy's broad output has been trimmed. Focused strategies (Iron & Metals Mining, Oil & Gas, Coal Mining, Copper Mining, Timber & Forestry) have all been buffed to give a stronger supply signal and better margins when the target resource is scarce — making it actually worth specialising rather than staying diversified forever.
  - **Plastics shortage eased.** Chemical plants now co-produce plastics alongside chemicals as standard. This addresses the persistent plastics shortage that was penalising the auto, construction, healthcare, and agriculture sectors.
  - **Energy sector more viable.** Energy output is up slightly, and energy plants' dependency on scarce oil and copper has been reduced. Fossil-fuel energy should no longer drain margin purely from input costs.
  - **Agriculture pays better.** Standard farming output has been raised, making agriculture a more rewarding sector when inputs (fertilizers, energy, vehicles) are expensive.
  - **Construction input stacking reduced.** Building materials and timber demand rates have been trimmed for construction companies, easing the effect of buying several scarce commodities at once.
  - **Healthcare and financial services demand moderated.** Government healthcare spending and bond-market financial demand have both been scaled back to reduce persistent 2×+ prices in those commodity markets.
  - **Resource-poor states penalised less.** States without local oil, gas, iron, copper, timber, coal, or rare earth deposits no longer take extreme commodity margin penalties for those globally-traded resources — the game now assumes corporations can import them.

- **Commodity demand for food, vehicles, and financial services now responds to interest rates.** High interest rates suppress demand for vehicles and food (as consumers cut spending); low rates stimulate it. Financial services demand is also sensitive to the rate environment. The effect zeroes out at the 2.75% neutral rate, so stable monetary policy has no additional impact beyond existing demand levels.

### 🐛 Bug Fixes

- **Loan auto-pay now uses your savings as overflow when your wallet runs short.** Previously the LOC only debited your liquid wallet — savings sat untouched and arrears accumulated even though you had the money to cover the payment. Auto-pay now pulls from personal wallet first, then savings, so loans actually pay down on schedule. **Campaign funds are never touched** — they're legally separate from personal cash and are off-limits to loan collection.

- **Admin Loan ledger now reads correctly for garnishment rows.** The Type column shows "Garnishment", the amount is negative (since it reduces debt), and the Interest / Principal split is visible — matching how Auto-pay rows already read. New `Distress Drain` rows show the same split for idle-balance liquidations.

- **Canvassing and GOTV now actually move election results.** The state Demographics & Turnout page has always shown your turnout boosts and suppression as `Actual = Baseline ± Modifier`, but the election engine was reading turnout from a different code path and silently ignoring those US modifiers, so canvassing spend produced no measurable change in vote share. Vote tallies, primary stagger accumulation, and the poll's voter-group breakdown all now route through the same calculation the "Combined" view uses, so the boosts you see are the boosts you get.

- **Poll's Likely Voter Turnout panel is now consistent with the state Demographics & Turnout page.** White at 63% on the poll and 53.4% on the state page (the actual rate elections use) was the same demographic looked up two different ways. The poll panel now applies the same GOTV / canvassing / suppression modifiers, so the per-group rates line up with the "Actual" column.

- **Poll's "est. total voters" no longer reports ~4× the real electorate.** The header was summing four different demographic slicings of the same population (race + age + education + income), so a 10.7M-population state showed 25M est. total voters. The header now reports the average of those dimensional estimates, matching each section's subtotal.

- **UK characters can now use campaign actions without a false "Insufficient funds" error.** The affordability check was comparing a GBP balance directly against a USD-denominated cost. It now converts correctly through the live exchange rate first.

- **The commodities tab on national exchanges (NYSE, LSE, TSE, DAX) now shows total national supply and demand.** Previously the two rightmost columns showed which state had the highest and lowest price; they now show total units produced and consumed nationally — more useful for reading market health at a glance.

- **Private corporation pages now load correctly.** Visiting a privately-held corporation's page as a regular player no longer shows "Corporation not found." You can now view the corporation's basic info, sectors, and shares tab and buy shares as normal. Detailed financials remain hidden for private companies.

### ⚙️ Mechanics

- **Income / hr on the corporation page now matches what actually goes into the bank.** Two long-standing bugs were inflating the displayed net income relative to the cash flow players were seeing turn-to-turn:
  - **Dominant sectors weren't paying their dominance penalty on the corp page.** A corporation with a state-dominating sector (think LLC empire in California healthcare, or kanto-area telecom in Japan) saw the dominance margin reduction and the 5%-of-revenue regulatory burden in the turn loop, but the displayed Income / hr ignored both. That's now applied: the page-level margin breakdown and the headline Income / hr both honor the same dominance math the turn loop uses.
  - **Pass-through structures' mandatory dividend payouts weren't shown.** LLCs, S-Corps, LLPs, and equivalents force a minimum % of net income to shareholders every turn whether the CEO sets a dividend rate or not. The corp page was reporting Income / hr before this payout, so a CEO who set their dividend to 0% still saw the gross figure even though 20–30% was leaving each turn. Now Income / hr is the post-distribution number — what actually retains — and FinancialsTab displays the effective rate with a "Legal floor" tag when the structure is enforcing the minimum.
- **Dissolution votes now execute automatically.** When a shareholder dissolution vote passes, the corporation is dissolved immediately — the CEO no longer has to manually click "Execute Dissolution" after the vote closes.

- **Frozen borrowers whose income covers the payment are no longer stuck.** If a borrower's income was collected by the turn processor before it reached their wallet (e.g. due to garnishment), the game could incorrectly keep them flagged as distressed even though they earn enough to make their payment. Borrowers in this situation are now unfrozen automatically.

- **Fed chair nomination timing is clearer.** The central bank page now says nominations open in `X` turns, during the final year of the chair's term, instead of making that countdown sound like the selection chance.

- **Deflation now correctly penalises corporations.** Negative inflation was previously applying a bonus to sector margins — the same formula meant for low inflation kept running below 0%, so corporations were being _rewarded_ during deflationary periods. Deflation now applies a margin penalty at twice the per-point rate of high inflation.

- **High interest rates now bite much harder.** When the central bank's prime rate is above the neutral rate, the deflationary demand suppression is now three times stronger than before. A rate of 7% (vs 3% neutral) previously knocked about 1.6 pp off inflation per turn; it now knocks off ~4.8 pp. Rate cuts and low-rate stimulus work exactly as before.

- **Deflation is now uncapped.** Inflation could not previously fall below −2%. That floor is gone — severe deflationary spirals can now compound if monetary policy and economic conditions align.

- **Deflation penalises corporations twice as hard.** Each percentage point of deflation now reduces sector margins by 4 pp rather than 2 pp. The mild bonus from low (but positive) inflation is unchanged.
- **Corporations sitting at negative output get hit faster and harder.** The sustained-negative-production penalty has been tripled in severity (−15 pp → −45 pp) and the ramp compressed — the full penalty now kicks in within ~3 game days instead of ~11. The 2-day grace period is unchanged.

- **Voting on a bill twice no longer moves your compass twice.** Abstaining and re-casting your vote on a bill was applying the political compass shift a second time, causing your character's position to drift with every vote change. The shift now only applies on your first real (non-abstain) vote per bill.

### 🎨 UI

- **Garnishment warning on portfolio page.** If your bond income is currently being seized by an active line of credit, the Overview pane now shows a banner with the exact per-turn amount being captured. The Loans pane also flags the specific account doing the garnishing so you can see at a glance why your income is lower than expected.

- **Widespread mobile display fixes.** A multi-batch pass addressed the most common layout breakages on phones (320–360 px): navbar dropdowns no longer hang off the right edge of the screen; the turn controls panel collapses to a single column on narrow screens; the StatusBar character name always truncates cleanly; the Universal Search chip grid stacks vertically on small screens; actions hero stat cards scale down gracefully; admin heal panels, IP bans, and user tables no longer cause horizontal scroll; slate tab map tooltips stay on screen. Covers roughly 15 components across the app.

---

## v0.2.15 - 2026-05-08

### ⚙️ Mechanics

- **Shareholder votes now finish automatically.** Corporation votes no longer depend on someone opening the vote page after the result is already known. If a vote has enough shares to pass, can no longer pass, or reaches its deadline, the turn processor finalizes it.
- **Share issuance votes are safer under heavy page traffic.** Parallel page loads can no longer double-apply a passed vote's effects or send duplicate pass/fail notifications.
- **Old stranded share issuances can be repaired.** A new dry-run migration is available for share-issuance votes that passed before the old effects bug was fixed.

- **Filed slate candidates can be withdrawn by party leadership.** Withdrawing a filed slate row now also pulls the live candidate off the ballot, removes them from the tally, and deletes the campaign record. The UI now confirms this before acting.

---

## v0.2.14 — 2026-05-07

### ⚙️ Mechanics

- **National committee proposals.** Party committees can now vote on formal proposals to change the party. Eligible voters include all committee members plus the national chair, vice chair, and treasurer. Any committee member may propose:
  - **Rename** — change the party name and abbreviation.
  - **Ideological shift** — move the economic or social position ±1 step (clamped to −5…+5).
  - **Election method** — switch how national leadership elections are tallied: all members vote (default); committee and leadership only; or party-influence weighted (all members vote, but each vote is weighted by that member's party influence score).
  - **Election duration** — set a custom length for future leadership elections, between 1 week (168 turns) and 2.5 weeks (420 turns).

  The party **chair** may additionally propose a **merger** — absorbing your party into another. Proposals run for 24 turns and pass or fail by simple majority of eligible voters. A merger proposal triggers a simultaneous vote in the _target_ party's committee; both must pass before anything happens. On merge, all members and NPPs transfer to the surviving party (party influence halved during transfer), half of each state organization's strength carries over, and the full national treasury moves across. The absorbed party is marked defunct and removed from party listings. Look for "Committee Proposals" in the party page committee tab.

### 🔧 Platform

**Performance**

- **Faster staging deploys** — Non-production Railway builds now skip Sentry source map processing and TypeScript compilation on the build server, saving ~4 minutes per deploy. Type safety is still fully enforced by the CI pipeline.

### 🐛 Bug Fixes

- **Dividend income in status bar** — The "+X/turn" figure shown in the dividend breakdown tooltip was being over-converted for non-USD home currencies, inflating the displayed amount. Fixed.

- **Caucus dues no longer drain your war chest** — Caucus membership dues were incorrectly calculated as a percentage of your total campaign fund balance rather than your per-turn income. A character with large savings in a 2.5%-rate caucus was losing ~$1M per turn silently. Dues are now a percentage of what you earn each turn. The deduction also now appears in your financial transaction log as "Caucus Tax" so you can see exactly what's being taken.

- **IPO share price display** — For corporations denominated in non-USD currencies (e.g. yen), the share price shown in the "Go Public" panel was severely inflated — e.g. ¥56,825/share was displaying as ¥6.1M, and projected treasury proceeds were similarly off. The correct figures are now shown throughout the IPO flow: the description, the live preview card, and the success message after going public.

---

## v0.2.13 — 2026-05-06

### ⚙️ Mechanics

**Germany**

- **Landtag system.** Germany's 16 Länder now have player-eligible state legislatures, with seats allocated proportionally to party vote share — not first-past-the-post like US/UK state houses. Land elections, sitting members, and admin tooling all flow through the new Landtag system. (Thanks to **Dani** for the implementation.)
- **Land terminology and Imperial Character config.** Germany's "regions" are now called **Land** / **Länder** throughout the UI to match how Germans actually talk about their state-level politics. Imperial Character settings have been wired up for Germany so VIPs can be seeded into the system. (Dani.)
- **Bundestag 2021 and Minister-Presidents 2020 are seeded historically.** Two independent admin seeders bring the federal Bundestag (2021 election results) and every Land Minister-President (2020 line-up) into the live game DB. New games starting from this point have a realistic German political baseline. (Dani.)
- **Bundesrat tab disabled.** Following the same pattern as the UK Lords, the Bundesrat tab is now disabled in the UI — its members are appointed by Land governments rather than directly elected, so it doesn't slot cleanly into the player-action model. (Dani.)
- **NPP auto-generation works for every country.** The non-player-politician generator was previously hard-coded for US and UK. It now generalizes across all supported countries (US, UK, Germany, Japan, Canada, Brazil), so admin seeding works the same everywhere. (Dani.)

**Corporations**

- **Private and Public corporations.** Choose at founding (or later) whether your corporation is private — you own 100% and your treasury, income, dividend rate, share price, and per-sector financials are hidden from outsiders — or public, where the IPO raises extra treasury cash by selling shares to the public market. The float % slider in the founding modal lets you pick how much of the company to sell (10–49%), and a live preview shows your final ownership and the cash you'll raise. A private corporation can later go public via a "Go Public" CEO action.
- **Privatization buyouts.** Crossed 75% ownership of your public corp? Open a 24-turn shareholder buyout vote at a 10% premium over the current share price. If non-CEO shareholders vote in favor (simple majority of shares cast), every minority holder is bought out at the locked price and the corporation returns to private. If the vote fails, your reserved cash is refunded and a 96-turn cooldown applies before you can try again. The CEO can cancel an open vote without a cooldown. While a vote is open, share issuance, splits, and dividend changes are blocked to prevent gaming.

**Parties**

- **Party chairs can now purge members** — As national party chair, you can expel regular members from your party. The action costs you 25 infamy and half of the expelled member's party influence (taken from your own balance). The expelled member is removed immediately and receives a notification. There is a 6-turn cooldown between purges. Leadership roles (Vice Chair, Treasurer) cannot be purged. Find the button at the bottom of your Chair Office tab.

- **Longer corporate bonds now cost more** — When issuing a bond, the interest rate you'll pay depends on how long the bond runs. 2-year bonds are the same as before. 5-year bonds carry a +1% premium on top of your credit-spread rate, and 7-year bonds carry +1.75%. The Issue Bond form now shows the rate for each maturity option before you pick, so you can weigh the lower refinancing risk of a longer bond against the higher annual interest cost.
- **Corporate bonds now scale with your revenue** — The $100M-per-issuance ceiling is gone. You can now issue up to 25% of your annual gross revenue per bond, with $100M as the floor so smaller corporations aren't affected. A $21B corporation with $2B in yearly revenue can issue up to $500M at a time. The Issue Bond panel shows your current per-issuance cap alongside your debt headroom.

### 📚 Content

- **Major fact-check pass across the wiki.** The following articles were rewritten or substantially corrected to match what the code actually does (rather than what was intended at design time): **Stock Market**, **Currency Exchange**, **Central Banks**, **Corporate Bonds** (pricing formula + IMF bailout + national-corp restrictions), **Sovereign Bonds** (rewritten to match implementation), **Subsidies** (added fiscal cost + market sentiment effects), **Tariffs** (added inflation impact, sentiment clamp, ending mechanics, fiscal sync), **Commodities** (unowned-sector fallback, audit + correction), **Election Mechanics** (audit + correction), **Voting & Whips** (rewritten for the cross-pressure model), **Government Approval** (rewritten to match metric-based calculation, fixed modifier count, election link), **National Budget** (debt ceiling, state-grants timing, fiscal year), **Corporations** (type-switch cooldown, strategy penalty, commodity caps, optional starting capital, power-grid modifier), and **Bills / Game Loop / Turn Order**. Plus various smaller fixes across **Stock Market** (removed non-existent dividend preference), **Currency Exchange** (fixed macro formula signs and noise sources), **Central Banks** (inflation table, exchange-rate formula, reserve sources), and **Status Bar tooltips**.

### 🎨 UI

- **Wiki Full Page List is paginated** — The Full Page List on the wiki overview previously rendered every entry in three giant columns. Each section (Auto Generated, Player, System) now shows 10 pages at a time with Prev / Next navigation and a page count. Auto Generated Pages also sort newest-first now, so recent elections show up at the top instead of buried alphabetically.

### 🐛 Bug Fixes

- **Electricity output now tracks production correctly** — Electricity production could dip on the commodity page even when energy sectors were growing, because the market update was not reading active sector production-policy levels. Electricity supply/demand now uses those production settings, and the Top Producers / Top Consumers lists use the same math as the market totals.
- **Stock and reverse splits no longer get stuck on dead-corp buy orders** — If another corporation had ever placed a buy order on your shares and was later dissolved, that orphan order couldn't be cancelled, which blocked your reverse splits with a `"Buyer corporation not found"` error. The cleanup now drops the orphan order so the split can proceed; existing bad orders against your corporation have been cleared.
- **Marketing Strength tooltip no longer talks about elections** — Hovering the violet MS chip in the top bar (when you're in a corp) used to claim Marketing Strength "increases voter reach and demographic campaign effectiveness." That was wrong — MS is a corp stat. The tooltip now describes what MS actually does: boosts how much of an unowned market you capture each time you split into a new sector, and grows from your daily marketing spend.
- **UK Education Spending, Power Grid Reliability, Violent Crime Rate, and Test Performance now show real values** — These four metrics had been stuck at a placeholder `100` for every UK region since the seed update that introduced them, so the per-region detail page rendered `$100` with a flat 96-turn history line. The actual ONS-calibrated values (e.g. London's £8,500 per-pupil education spend) are now in the database, and the country dashboard's UK national averages are recalibrated to reflect them.
- **UK & Japan elections now show every nominee, not just the lead** — When a party fielded multiple candidates that won their primary (UK and Japan let three nominees per party advance), the polling table on the elections page only listed the highest-scoring one. All winning nominees are now displayed in the general phase, so you can actually see who's running where before deciding who to boost.
- **Presidential CS column now reads correctly** — The Campaign Strength column on the presidential candidate table was stuck on "—" for every candidate. Strength values you contribute via the Support button now show up in real time, and freshly-entered candidates with zero strength read as "0" instead of a blank dash.
- **Relocating an NPP now respects the state's capacity** — The Relocate action on the national party influence panel was bypassing the per-state NPP limit. Full states are now disabled in the dropdown (with their slot count shown), and the server rejects relocations into a full state instead of consuming party actions and treasury for nothing.
- **Cabinet `Declare` actions now actually spend** — Cabinet members created via the US confirmation flow or admin force-confirm could see `2/2 Cabinet Actions` in the briefing but get `"No ministerial actions remaining"` on click. New cabinets are seeded with the correct action pool, and existing cabinets are auto-fixed on the first attempted action.
- **Founding private and immediately going public no longer hits the IPO cooldown** — Corporations founded as private were getting blocked from the "Go Public" action for 96 turns by the same cooldown that's meant to prevent rapid privatize-then-IPO flipping. A freshly-founded private corp has never been public, so there's nothing to flip — going public right after founding is identical to founding via IPO in the first place. The 96-turn cooldown still applies after an actual privatization buyout.

## v0.2.12 — 2026-05-06

### ⚙️ Mechanics

**Sovereign Default**

- **A whole new crisis system.** Countries can now go into sovereign-debt crisis when bond auctions fail or fiscal standing collapses. The Executive proposes one of four resolutions — IMF Bailout, Repudiate, Restructure, or Monetize — and the Legislature ratifies (or rejects) the choice. NPCs auto-propose and auto-vote when no human is in the role.
- **Four resolution paths, each with consequences.**
  - **IMF Bailout** caps your federal spending under austerity rules while a multi-turn IMF facility pays your obligations. Failing to meet the primary-surplus check delays recovery.
  - **Repudiate** wipes the debt but tanks investor trust, depreciates your currency, hits foreign holders for write-downs, and triggers contagion across the global economy.
  - **Restructure** writes down outstanding bonds at a partial haircut, splitting the pain across holders.
  - **Monetize** prints money to cover the shortfall — gated on inflation — and applies a recovery GDP penalty.
- **Contagion cascade.** Sovereign defaults ripple outward: bondholders take write-downs, corporate insolvencies follow, and sectors take a margin penalty. Heavy cross-border holdings can mass-cascade into a global event.
- **Recovery state machine.** After resolution, your country grinds through a recovery period tracked turn-by-turn. The Recovery Progress panel on your country dashboard surfaces standing, IMF facility status, and remaining obligations. A debt sustainability index gauge gives an at-a-glance read of fiscal health.
- **Political fallout.** Resolution costs the Executive favorability and infamy. Repudiate and Monetize auto-trigger a no-confidence vote in parliamentary systems. Legislators take favorability hits at chamber tally. Populist factions get a favorability surge on crisis-fire, and civil unrest events fire in the days after resolution.
- **New pages.** `/world/crises` lists pre-crisis warning indicators across the world. `/international/imf` shows the IMF Board, active bailouts, and override history. The country dashboard now has a bond market demand widget so you can see your auction prospects before the close.
- **Player and entity holdings tracked.** Your character portfolio now has a per-country sovereign holdings panel showing your exposure to each country's bonds — useful for predicting your write-down risk in a default.

**Elections & Campaigns**

- **Presidential Campaign Strength.** Presidential candidates now have a campaign-strength metric you can boost via a new Support button on the candidate table. Contributions multiply per-candidate vote accumulation in the general election. The Campaign Strength Panel on presidential campaign pages shows current strength, contribution costs, and the rolling impact. Strength resets to 0 when the election resolves.
- **Primary scoring rebalanced.** Primaries now weight how well your policies match your **state** alongside how well they match your **party platform**. State match is the bigger factor (25 pts) and party match is secondary (15 pts), so a candidate who fits the state's politics gets a real edge over a candidate who's a perfect partisan match but out-of-step with the state. When state cached lean isn't available, scoring falls back to the previous party-only formula.
- **Infamy now hurts your performance.** Infamy reduces your primary and general election performance up to 5% at infamy=100 (linear). NPPs aren't affected.
- **Political influence matters more at the high end.** The state-primary influence sub-score uses a less aggressive curve, so a candidate at PI=99 now meaningfully out-pulls one at PI=85 in primaries.
- **Real-world GOP per-state allocations.** GOP primary per-state allocation rules now match real-world state rules instead of generic proportional defaults.
- **Same-party candidates differentiate again.** A regression that averaged out party positions in primary projection has been undone, so two same-party candidates with different policy positions get different scores.
- **Vote share and delegate share line up.** Primary detail cards now reconcile the displayed vote-share and delegate-share numbers from the same source data so they don't disagree.
- **Polls match the election engine.** Poll previews now apply the infamy penalty in both the per-archetype and full simulation paths, so what the poll page shows is what the live election engine will produce.
- **Block no-op stat actions when target is at cap or floor.** Influence actions that would land at zero effect now refuse instead of silently consuming actions.
- **Winning vacates your prior office.** Winning a different race now correctly vacates your old seat, instead of leaving you double-seated on profile pages.
- **Exclusive leadership seats enforced.** A character can only hold one of Speaker / President pro tempore / Whip at a time; concurrent-write race fixed.
- **Auto-reelection targets the right seat.** A bug that could enroll auto-reelection characters in the wrong staggered race in the same state has been fixed — Senate class and chamber class are now matched.

**Corporations**

- **Sector secondary market.** CEOs can now list any of their corporation's sectors for sale at 75% of NPV (a 25% discount on fair value), and another corporation's CEO can purchase it with their corporate treasury. The asking price is locked when the listing goes live so buyers see a stable quote that doesn't shift with margin or commodity churn. Funds flow corp-treasury to corp-treasury, fully forex-aware: the buyer's home currency is debited at the live FX rate, the seller's home currency is credited, and the sector's stored revenue and growth-cost figures are re-denominated to the new owner's currency on transfer. Sectors with non-positive base profit can't be listed, and you can't buy a sector type you already operate in that state. Listings are visible as a `For Sale` badge on the sector page hero, your `Sectors` tab, and the state economy market participants list.
- **Monopoly pressure penalty.** Corps holding sustained monopoly market share now face a soft growth-cost penalty. Splitting your sector portfolio is meaningfully cheaper to grow than concentrating in one sector.
- **Sustained-negative-production penalty.** Corps that have been running negative production over multiple turns now take an escalating margin penalty until they reverse course.
- **Vote CEO button only shows for HQ-eligible shareholders.** Players holding shares in a corp HQ'd outside their country no longer see a Vote CEO button they couldn't actually use.
- **CEOs can buy from public float.** Restored a CEO's ability to buy shares from public float through normal flows; whip notifications also now deep-link directly to the relevant bill.

**Financial Markets**

- **Stock prices stick after splits.** The fundamental share price now scales with stock splits and reverse splits, so the next-turn snap-back effect is fully eliminated.
- **Stock-price formula closer to balance-sheet truth.** The tangible-book weight in the share-price calc is now 1.0 (was 0.8), so cash-heavy corps trade closer to book.
- **Stock exchange refresh restored to 15 minutes.** The exchange refresh schedule had drifted; cron is now correctly aligned to the 15-minute cadence.
- **Hourly turn cadence restored.** Cron schedules for the main turn loop normalized after the deployment-target switch.
- **Manipulation paths closed.** Several share-price manipulation paths around limit-order fills and concurrent buys have been hardened.

**Tariffs & Trade**

- **FTA-aware sentiment and inflation.** Sentiment pulses and inflation pressure from tariffs now skip pairs that share an active free trade agreement, so signing an FTA actually shields you from each other's tariffs.
- **Foreign-side sentiment on FTA rescission.** Cancelling an FTA now fires the appropriate foreign-side sentiment pulse alongside cleanup migrations.

**Government & Cabinet**

- **Acting cabinet appointments.** Vacant cabinet roles can now be filled with an Acting officer (non-confirmed) who carries an approval penalty until they're confirmed by the proper process.
- **UK Prime Ministers can pick a constituency.** UK PMs now choose a real Westminster constituency from their region, matching MP behaviour.
- **DE Labour Minister + ministerial orders.** Germany's Labour Minister office is added with its own page, metrics, and ministerial orders. Foreign Minister wiring also refreshed.
- **JP propose flow restored.** Japanese legislation propose flow had stalled; cabinet portfolios now use correct seeds; fiscal year is country-scoped instead of mixed.
- **JP Shugiin override.** The Shugiin override is now correctly applied in JP whip and vote-handler paths; NPP cross-pressure for JP rebalanced.
- **Income tax fiscal-year handling.** Multi-currency income tax no longer double-counts or escapes the fiscal-year window.

**Parties, Coalitions & Caucuses**

- **Coalition and caucus Discord invites.** Coalition Chairs and Caucus Chairs can now save a Discord invite URL on their chair-management surfaces; the saved link appears as a Discord button in coalition headers, coalition cards, and caucus headers. Same normalization and validation rules as national-party Discord links.
- **NPP endorsements are now manual-only and relationship-gated.** Removed turn-time organic NPP campaign endorsements. The player Request Endorsement action is now a hidden deterministic relationship check tied to your policy distance from the NPP. The picker shows Likely to Accept / Likely to Decline chips and arranged endorsements only persist for the active campaign.
- **Player-NPP boost actions don't need a positive relationship.** Boost Favorability and Boost Influence on the NPP profile panel now gate only on actions and campaign funds — hostile or neutral relationships no longer block them.
- **Reduce Favorability and Reduce Influence.** Player-to-NPP profile actions now include the symmetric reduce options. All four stat actions charge both action points and campaign funds, and refund both on rollback.
- **Caucus chair vote withdrawal.** Caucus members can now clear their own vote during an active caucus chair election, matching the main party leadership voting surfaces.
- **Slate reassignment honors active candidates.** High-fit NPPs already filed in another race now accept Slate reassignment instead of declining; on the next filing pass the Slate mover withdraws them from the old race and refiles them.
- **Incumbent NPPs match by Senate / chamber class.** Seat-defending NPPs now re-file into the correct staggered seat, fixing reports of Senate NPPs auto-filing into the wrong class.
- **Relocation auto-resigns and auto-withdraws.** National Request Relocation no longer blocks when the target NPP is in office or running. Accepted requests vacate the office, fire Senate vacancy notifications when relevant, withdraw from any open elections, and complete the home-state move.
- **NPP voting behavior corrections.** Multiple fixes to NPP autonomous voting on bills — federal-vs-local pressure rebalanced, hidden-roll edge cases for hard whips closed, and a tally regression where strong cross-pressure swung NPP votes incorrectly is fixed.

**Central Bank & Inflation**

- **Inflation hardened.** Recalculation reworked, FX-pressure and commodity diagnostics clamped to sane ranges, and a wave-8 backfill migration corrects historical inflation rows.
- **Right budget for non-US presidential countries.** A bug caused inflation to read the wrong federal budget for some presidential systems under forex; resolved.
- **Inflation diagnostics admin panel.** Admins now have a panel that surfaces per-input contributions to the inflation calc, side-by-side with the recalc output.

**Line of Credit**

- **Income history beats lucky hours.** Your LOC ceiling still respects recurring income, but it now looks at your average bond-coupon, CEO-salary, and dividend income over the last 48 turns and also respects a hard net-worth cap. Short-term income spikes are much less effective at inflating the limit.
- **Central Bank LOC exploit closed.** A path that allowed bypassing LOC draw caps via reused state was patched, alongside additional concurrency guards on draw flows.

### 🎨 UI

**Page Redesigns**

- **Election charts use unified candidate colors.** The line graph, pie chart, candidate legend, and the leader bar at the top of an election card all now use the same color per candidate.
- **Currency display preference honored on portfolio.** Your portfolio formatting now respects the display-currency preference instead of always showing the anchor currency.
- **Stock market and logo fallbacks stabilized.** Several rendering jitter cases on the stock market page and party-logo fallbacks have been resolved.
- **Settings page refreshes on load.** A stale-cache bug could leave the settings page tied to the previous character.

**Mobile / Layout**

- **Party office cards no longer overlap on narrow viewports.**
- **Filter capitalization is consistent and survives navigation.**
- **Site-wide UI fixes.** Several rounds of small site-wide fixes addressing image fallbacks, navigation regressions, and minor UI breakages.

### 📚 Content

**Countries & Regions**

- **Country roster expansion.** Ireland (IE), Brazil (BR), and China (CN) added as econ-only countries; Nigeria (NG) added as a planned rollout. Country runtime states unified across the codebase.

### 🔧 Platform

**Admin**

- **Admin Reset Lock control.** Admins can now reset stuck turn locks via a dedicated button on TurnControls; the action is logged to admin audit.
- **Moderator activity timeline + position updates.** The moderator panel now exposes profile and character timeline events in the activity log, and includes a route + form for positional moderator changes.
- **Moderator priority queue dashboard.** Reports and flagged content surface in a priority queue with a sidebar nav.

**Discord & Bot Integrations**

- **User-managed bot keys.** Players can now mint, scope, and revoke API keys for bots. Bot API auth path is hardened with structured logging; the elections view endpoint enforces a public token.
- **Discord OAuth referral codes.** Referral codes now flow correctly through Discord OAuth signups so referrers are credited.

**Performance & Stability**

- **Cached hot polled endpoints.** High-frequency polled API routes use short-TTL caching to cut backend CPU during quiet periods.
- **Render-path bottlenecks removed.** Several slow custom image paths bypassed; global chrome bootstrap overhead reduced.
- **Sentry noise gated.** Known no-op error noise is dropped from Sentry; long fetch chains gain abort controllers; an NPP upsert race fixed; several N+1 query loops batched.
- **Stuck turn processing closed.** Two stuck-processing gaps closed and the turn-lock recovery hardened so a stuck turn can no longer block the world.

**Security**

- **Cross-country political actions blocked.** The action authorization layer now enforces that political actions (campaign, NPP, party) target same-country entities, closing a class of cross-country exploits.
- **Settled wealth and portfolio history are snapshotted.** Historical chart points no longer repaint when underlying inputs change.
- **Privacy policy + Google CMP.** Site-level support for Google's certified Privacy & Messaging consent flow, footer-based consent revocation, and consent-mode-ready Google Analytics defaults for EEA/UK/Switzerland traffic.

**Monetization**

- **AdSense readiness hardened; minimum age lowered to 13+.** Final compliance pass for AdSense.
- **Google Ads conversion tag.** Conversion measurement wired on the registration funnel.

**Notifications**

- **Whip notifications link to the bill.** Clicking a whip notification now takes you straight to the relevant bill page.

### 🐛 Bug Fixes

- **Bond cash payoff fallback when MongoDB replica set is unavailable.** Bond payoff now falls back to a non-transactional path instead of failing the turn when the cluster falls out of replica-set state.
- **Bond maturity flows folded into pre-default delta.** Maturity payouts no longer trip a spurious sovereign default check on the same turn.
- **Corp `liquidCapital` displays in anchor currency.** Mixed-currency totals on corp detail are gone — `liquidCapital` is FX-normalized before returning to the UI.
- **Corp FX fees applied on corp trades.** Corporate forex trades now correctly debit the spread fee, matching player trades.
- **Subsidy income aligned with the actual debit.** Corp Financials subsidy lines now match what the turn actually pays.
- **Subsidies budget mismatch.** A budget-line accounting mismatch on subsidies caused the displayed budget to disagree with the live charge — fixed.
- **Median income stays in bounds.** `medianIncome` no longer clamps to 100 in some currencies; min/max bounds enforced in the metric definition.
- **State-party elections show cooldown message.** A failure path was misclassified as a membership error.
- **Slur filter no longer blocks "queer".** Removed from the moderation slur list for news/posts.
- **Auth: redirect users without setup to /create-character on sign-in.** Admins are exempted so they can land on admin pages.
- **Currency display fixes.** Several UI labels formatted currency with mixed scales (e.g. JP showing M when it should show B).
- **Portfolio charts: FX rates snapshotted per history point + last 500 returned.** Historical USD chart values no longer repaint when the live FX rate changes; the chart now returns the most recent 500 history points instead of the oldest.

## v0.2.11 — 2026-04-30

### ⚙️ Mechanics

**Elections & Campaigns**

- **Auto run for re-election.** A new toggle in Settings → Policy Positions lets your character automatically file for every election in your home district. Once enabled, you'll be entered as a candidate each cycle without having to do it manually. You can still withdraw from any individual race, and a withdrawal won't cause you to be re-entered later. Doesn't apply to presidential races.

**Parties**

- **Party Analytics command center.** National and state/regional party pages now have an Analytics tab that summarizes Org & Growth (state-by-state organization caps, headroom, and expected growth/turn from each state party's treasury settings), Discipline & Compliance (low-loyalty / high-stubbornness NPP risk, caucus chair relationship-exit risk, and active player and NPP whip defiance counts), and Slate & Race Coverage (live Slate gaps and likely-to-decline signals). Cards deep-link straight into the relevant Treasury, Whip Room, NPPs, Slate, or Elections workflow.
- **Treasurer planning, presets, and insights.** Treasury pages now include a Treasurer planning card with soft reserve targets (transfer reserve, member-support reserve, NPP-recruitment reserve) and runway forecasting. The Treasurer can apply curated presets that auto-fill reserve targets and budget ratios. National treasury also exposes leadership-only insights — recent transfer recipients, low-cash state parties, expansion opportunities, growth leaders — and an emergency-override history when sends or transfers pierce the reserve. Only the Treasurer (or an Admin) can edit reserve targets; Chairs see the card but cannot change it.
- **State and regional Slate tab.** State and regional party pages now expose the shared Slate as a scoped race list limited to that page's geography. National and state/regional leadership edit the same underlying rows from either surface, candidate rows show who assigned them, and same-state NPP assignments made by the State or Regional Chair or Vice Chair receive a hidden acceptance bonus.
- **State and regional NPP management parity.** State and regional NPPs tabs now mirror the national split into Recruitment and Management. State Chairs and Vice Chairs can run Boost Favorability, Boost Influence, Strengthen Party Loyalty, and Improve Cooperation against same-party home-state NPPs, with a small hidden home-state success bonus on loyalty and cooperation requests. Officeholders and active candidates are flagged directly in the target list. Relocation remains national-only.
- **National NPP relocation requests.** National Party Chairs and Vice Chairs can request that an NPP relocate to another state through the NPPs → Management panel, for 25% of the target state's normal recruitment cost.
- **Coalition Priorities.** Coalitions replace the old placeholder priorities tab with a real mechanic. Coalition chairs can post up to three active priorities at a time across policy themes, live bills, and leadership goals. Each member-party chair votes Support, Oppose, or Abstain to activate them. Coalition cohesion now summarizes active support vs dissent, public and internal-only visibility are both supported, and bill or leadership priorities auto-expire when their target window ends.
- **Whip Defiance watch.** Party, state-party, and caucus Whip Rooms now include a live Defiance view that surfaces only active non-compliance with current whip directives, split into Players and NPPs. Rows disappear automatically once the voter falls back into line, and Discipline analytics summaries also surface the current player and NPP defiance counts.
- **Bill detail Whip Panel.** Congress bill pages now have a Whip Panel directly beneath the description so party chairs and vice chairs can issue Player Whips and NPP Whips without leaving the bill. Whips issued from the bill page or the party Actions tab stay synced.

**Caucuses**

- **Caucus Chair elections.** National-party caucuses now hold real Caucus Chair elections in a new Elections sub-tab — candidate entry and withdrawal, member-only voting, winner promotion, and notifications all included. The caucus election cadence is anchored to the parent party's national chair election window so caucus leadership turns over on the same cycle as broader party leadership.
- **Caucus Whip tab.** Each caucus now has a dedicated Whip sub-tab where the Caucus Chair can issue Player and NPP whips against bills and leadership votes, scoped to caucus members only, using the same shared whip UI as the main party Whip Room.
- **Caucus Chair treasury controls.** The caucus Chair's Office now lets the Caucus Chair send caucus funds to active player members or transfer caucus funds back to the parent National Party treasury, with full audit trails.
- **Relationship-gated NPP caucus recruitment.** The Chair's Office now includes Recruit NPP to Caucus, showing same-party NPPs alongside the Chair's current relationship with each one. Recruitment requires at least 60 relationship; NPPs already attached to any caucus are hidden; and a 12-hour caucus-wide cooldown applies after any successful NPP recruit. NPP relationships now decay 0.1/turn toward neutral, and caucus NPPs automatically leave when their relationship with the current Chair falls below 20.
- **Caucus Health dashboard.** Each caucus Overview now shows a Healthy / Strained / Fragile status badge alongside recent joins, leaves, and forced exits, active caucus-whip defiance counts, chair-election activity, and NPP members drifting toward the chair-relationship exit threshold. The same signals roll up into the national party Analytics tab.
- **Caucus membership share chart.** The national party Caucuses tab now includes a pie chart that splits caucus-aligned members across all active caucuses, with the legend doubling as a caucus selector.
- **Chair's Office privacy.** The Chair's Office tab is now hidden from non-chairs in caucus detail views, instead of showing chair-only management to the rest of the caucus.

**NPPs**

- **Organic endorsement lifecycle.** NPPs now run a turn-time endorsement pass that can create, hold, switch, and withdraw endorsements across any race they can plausibly care about, scored against relationship, ideology, party, race relevance, and viability. Endorsements track whether they were organic or arranged — arranged endorsements get extra staying power before the NPP will defect — and re-evaluate every 4 turns plus on field-change triggers. Active endorsements also now contribute a small capped favorability bump in race calculations, so an NPP backing matters beyond just generating campaign actions.
- **NPP voting on state and local bills.** NPP legislators in state senates and regional councils now auto-vote on local state bills using the same deterministic ideology + whip + district + donor framework as federal bills, but with heavier home-region pressure and lighter donor pressure. Vote predictions persist for both federal and local races, the NPP forecast card can read either, and state-party whippable-bill lists now surface both federal delegation bills and local chamber bills.
- **Whip compliance is now a hidden roll, and soft bill whips are advisory.** National, state/regional, and caucus NPP whips now resolve through a hidden loyalty/stubbornness success roll instead of a hard compliance threshold, with hard whips getting a stronger built-in bonus than soft. For bills specifically: soft NPP whips no longer flip the vote immediately — they persist as a lighter cross-pressure force in autonomous bill voting. Hard bill whips still write the vote on a successful hidden roll, falling back to normal cross-pressure on failure instead of blindly obeying.
- **Incumbent NPPs auto-defend their seats.** NPP race entry was reordered so incumbent NPPs automatically re-file into their defending primary before generic party fill — even if the race carries a same-party cooldown stamp. Slate-accepted NPPs still file immediately after the incumbent-defense pass, so a slated challenger can deliberately create a same-party primary against a defending incumbent. President was also dropped from the NPP race-priority ladder (NPPs no longer auto-enter presidential races), and Commons was reordered between House and Senate.
- **Player NPP direct interactions overhauled.** The player-facing NPP profile menu now offers Boost Favorability and Boost Influence as deterministic actions that raise the relevant NPP stat directly and improve the player's relationship with that NPP. Both spend the character's normal action pool — the separate Political Capital resource and refresh phase have been removed. Horse Trade and Threaten Primary are gone.
- **National NPP management.** Management actions now show Slate-style Likely to Accept / Likely to Decline chips instead of a raw success percentage. Boost Favorability and Boost Political Influence succeed automatically, while Strengthen Party Loyalty and Improve Cooperation use the loyalty/stubbornness acceptance roll, slightly softened so loyal, less stubborn same-party NPPs are easier to persuade. Request Opposition and Request Leadership Support have been removed. Displayed NPP stats now round to one decimal place across both national and state management cards.

### 🎨 UI

**Party Pages**

- **Two-row navigation.** Both national and state/regional party page tab bars now wrap into two rows instead of forcing horizontal scrolling, so all party surfaces stay reachable as the feature set has grown.
- **Non-member privacy.** Non-members of a party now only see Overview and Members tabs. Analytics, Whip Room, Slate, NPPs, Elections, and Treasury are hidden from outsiders, and the Discipline Watch and Recent Activity cards on Overview are members-only as well.
- **Slate races sort by office priority.** Within each state or region, Slate lists now order upper-chamber races first, then lower chamber, then governor-level races, then state/regional legislature races — instead of alphabetically. Upper-chamber Slate cards also display their chamber class (e.g. Class II) directly in the title so staggered races are easier to distinguish.

**Maps & Globe**

- **Global Monetary Policy chart now uses consistent currency colors.** EUR, CNY, BRL, and all other currencies now match the color scheme used on the forex exchange rates page.
- **Real photos for ECB, PBoC, and BCB.** The European Central Bank, People's Bank of China, and Banco Central do Brasil now show real building photos on their central bank pages instead of the country flag.

### 📚 Content

**Wiki**

- **Party and NPP design pages now match the live systems.** Internal reference docs were refreshed to reflect the current NPP endorsement, whip, Slate, caucus, coalition, treasury, and analytics mechanics rather than older placeholder behavior.

### 🐛 Bug Fixes

- **Bond purchases no longer tank a corporation's share price.** When a CEO bought government or corporate bonds with company cash, the share price formula didn't count the bonds as an asset — it just saw cash disappear. Held bond positions are now included in the tangible book value calculation, so buying bonds is balance-sheet neutral as it should be.
- **Coalition creation no longer races into duplicates.** Rapid duplicate clicks by the same National Party Chair could spawn multiple coalitions at once. Coalition creation now atomically reserves the founding party before insert and debits actions before commit. Full game resets also now delete all coalition documents and clear `coalitionId` pointers from default parties so stale coalition cards no longer survive a reset.
- **Caucus chair elections handle bans, leaves, and self-deletes.** Leaving a caucus, deleting your account, or being banned now immediately withdraws you from any live caucus-chair election, removes any caucus-chair votes you cast or received, and clears stale membership/chair pointers so caucus rosters and tallies don't keep ineligible players.

## v0.2.10 — 2026-04-30

### ⚙️ Mechanics

**Financial Markets**

- **Stock prices now update every 15 minutes.** Share prices react to market activity and economic events between turns. A new real-time sentiment and order-flow system drives live price pressure — market buys, sells, and limit-order fills affect price impact immediately, and events like bond defaults, IMF bailouts, government subsidies, and tariff changes trigger instant market reactions.
- **LOC auto-payments now tap your other currency wallets before freezing.** If your loan-currency balance falls short of a scheduled repayment, the game automatically converts from your other personal wallets at live market rates to cover the gap. Your account only enters arrears or gets frozen if all your balances combined are still insufficient.

**Corporations**

- **Logistics investment is now fully uncapped.** Logistics strength above 200 now keeps raising your sprawl threshold — heavy logistics investment scales linearly all the way up. Penalty reduction still tops out at 50% so it can never invert.

**Government**

- **Two new UK cabinet posts: Deputy Prime Minister and First Secretary of State.** The UK cabinet roster expands with two new positions, each with their own office page, metrics, tier settings, and ministerial orders.
- **UK cabinet ministers now earn NPI.** Appointed UK cabinet ministers now properly receive national political influence (NPI) on action refresh, matching other cabinet systems. When removed from cabinet, your MP status is restored automatically.
- **Commons MPs can now choose their constituency.** If you are elected to the UK House of Commons, your profile now lets you pick a real Westminster constituency in your region. Your office and career history will show that constituency, and you keep it automatically if you win re-election in the same region.

### 🔧 Platform

**Admin**

- **Admins can now forgive LOC arrears and force-unfreeze frozen accounts.** The Central Bank admin panel's loan detail view now has buttons to forgive outstanding arrears (per currency) and to manually lift a draw freeze when appropriate.

### 🐛 Bug Fixes

- **Stock prices are restored.** A formula rework had dropped sectorNPV from the share-price calculation, collapsing most corp values by 86–100%. sectorNPV is back in the formula and weights are rebalanced (50% NAV / 40% earnings / 10% growth).
- **Eurozone LOC accounts now work correctly.** ECB bank routing was broken: pool reserves read as 0 for every Eurozone player, and interest repayments were silently discarded instead of credited to ECB reserves. Both are fixed.
- **LOC draw error messages now tell you what's actually blocking the draw.** Previously the error always said "70% DTI cap" even when the real cause was a depleted lending pool.
- **House and Senate Majority Leader is now the largest party, not the coalition.** Leadership races and admin assignments now use the single party with the most chamber seats.
- **ECB president candidates are now restricted to euro-member countries.**
- **Bond maturity payouts and history records are now reliable.** Maturity calculations, cross-currency settlements, and bond history writes all hardened.
- **Multiple exploit-prone write paths patched.** Dozens of routes across actions, elections, forex, bonds, shares, and party operations protected against race conditions and duplicate submissions.
- **Bills stuck in committee now unblock.** A turn-timing bug that could stall bills indefinitely in committee is fixed.
- **NPP recruitment cooldowns no longer interfere across levels.** State-level and national-level recruitment now use separate cooldown timers.
- **Deleting a national party now cleans up all associated NPPs.**

## v0.2.9 — 2026-04-28

### ⚙️ Mechanics

**Corporations**

- **Governors can now appoint NPP senators.** When a U.S. Senate seat goes vacant (via resignation or a failed election), governors can appoint any eligible character — including NPPs — as a replacement. Previously only player characters were eligible.
- **CEOs are automatically removed when fully divesting.** Selling or listing all of your remaining shares now immediately vacates your CEO role.
- **Sector attack and expansion costs now show in the correct currency.** JP sector costs show ¥, US costs show $, etc. Large currency values also now display properly (¥262B instead of ¥262000M).

**Financial Markets**

- **Line of credit auto-payments no longer false-shortfall on bond coupon days.** LOC scheduled payments now run after bond coupons land in your wallet, so borrowers with bond income sufficient to cover their payment no longer get incorrectly frozen.
- **Bond yields are now consistent everywhere.** The yield shown on the bond detail page, listing, and Discord bot now all use the same calculation.

**International Organizations**

- **Players can now withdraw from international organizations.** A Withdraw option is available from the membership panel.

**Government**

- **Congressional leaders and party chairs earn NI on action refresh.** Speakers, Majority/Minority Leaders, Whips, and national party chairs receive influence bonuses on action refresh. The Central Bank chair bonus now stacks with any elected-office bonus instead of replacing it.

**Maps**

- **Brazil and China now have full interactive maps.** BR and CN upgraded from economy-only placeholders to full map mode controllers — showing election results, economic overlays, and demographics, matching the US, UK, DE, and JP maps. Ireland's economic infrastructure was also seeded this build.

### 🎨 UI

**Profile**

- **Career history now has tabs.** The Career History section on your profile splits into Elected, Executive, and Other tabs, making it easier to browse long careers. Dates now display as in-game months.

### 🐛 Bug Fixes

- **Senate vacancy notifications now fire through election resolution.** Governors are alerted when a seat goes vacant via a failed election (no tally / zero votes), not only via resignation.
- **State party treasury income estimates were wrong for non-USD countries.** JP and other non-USD state party pages showed inflated income figures due to a forex scaling bug.
- **Liquid capital snapshots could diverge from actual balance.** Resolved a mismatch between the stored LC snapshot and the value the turn processor used for share price calculations.
- **Bond foreign-currency valuations were not correctly preserved across turns.** Net worth, financial data, and currency income estimates now all use the correct per-bond exchange rate.
- **Central bank page could break for shared-bank countries.** Routing for countries sharing a central bank (e.g. Euro Area) is now correctly resolved.
- **Share trading could double-charge on concurrent requests.** Bond buy, share buy, offer accept, and order fill routes are now protected against race conditions.
- **Navbar routed to wrong country pages in multi-country view.** Country-scoped navigation now resolves correctly (fixed in two separate patches).
- **FX intervention now actually moves rates.** Previously, intervention spent reserves correctly but the rate impact was capped so tightly (~1% per turn max) that it could never overcome normal macro drift of 2–3%/turn. Intervention now applies a direct multiplicative rate shift (up to 5%) independent of the organic volume-pressure cap.
- **Intervention log "Spent" column now shows the currency symbol.** The reserves-spent amount in the Central Bank intervention log now renders as `€281` instead of `281`.
- **Legislature pages now default to the Bills tab** across Congress, Parliament, the Diet, and Bundestag.
- **Presidential primary stagger waves bootstrap and catch up correctly.** The Iowa wave and subsequent waves can now persist results as soon as the election enters the T-5 window, and catch-up runs all due waves in a single turn instead of one per hour.
- **U.S. presidential term limits enforced across entry, VP selection, and succession.** Characters who have served two terms are blocked from running, from being selected as running mates, and from ascending via succession into a third term.
- **Congressional leadership elections: incumbents from the wrong bloc no longer auto-nominate.** Speakers and President Pro Tempore incumbents are not re-nominated if they've fallen out of the majority.
- **Congressional leadership whip panel restored.** Party-page whips for Speaker and House/Senate leadership elections now correctly target the live election IDs.
- **Corporate sector abandonment, dissolution, and bond-default now return market share to Unowned** instead of silently shrinking the state market.
- **Bill whip panel added to bill detail pages.** Party chairs and vice chairs can now whip directly from the bill page without navigating to the party actions tab.

## v0.2.8 — 2026-04-23

### ⚙️ Mechanics

**Central Bank**

- **Central Bank Chairs can now run FX Interventions.** Post a soft-band (floor + ceiling) and the turn phase will spend FX reserves to defend the band when the rate drifts past it — pulling from `forexRevenue` first, then `reserveBalance`. Widening the band is free; narrowing or cancelling needs a 6-turn cooldown. If both reserve pools drain while the rate is still outside the band, the chair takes an infamy hit. IMF lock blocks policy changes but not ongoing defense.
- **Finance Ministers can now transfer Treasury funds into the FX Reserve.** New cabinet action on the finance-minister office page (US Treasury Secretary, UK Chancellor, JP/DE Finance Minister) moves federal surplus into the central bank's reserve pool — one transfer per turn, capped at 0.5% of annual revenue.
- **FX spread fees now seed the reserve.** 10% of every collected FX spread fee flows into the central bank's reserve balance, so chairs passively build intervention ammo without waiting on a manual Treasury transfer. Germany's European Central Bank now updates every turn alongside the US / UK / JP banks (was being silently skipped).

**Corporations**

- **R&D is now a real lever.** Corporations can set an R&D daily budget alongside marketing, logistics, and CEO salary — the budget counts against the same 150% overhead cap. Spending accumulates an R&D score that decays 3%/turn and drives breakthroughs every 6 hours. A breakthrough gives a random sector a permanent +1–10% revenue boost (or +1–5% for extraction corps); extraction breakthroughs additionally grow the state's resource capacity across whichever resources your strategy actually produces. CEOs see the slider and projected net change in the CEO → Budget subtab, and get a dedicated "R&D Breakthrough!" notification when one fires. Prior builds wrote R&D to the DB but had no way to configure it through the UI.

- **Stock splits and reverse splits no longer collapse market cap on the next turn.** Splits that previously scaled up sharply (e.g. 10:1 reverse) would see the share price snap back to the balance-sheet formula next turn, losing 50–80% of the intended cap-preserving scaling in one step. The price now drifts gradually toward the new equilibrium across several turns.
- **Reverse splits no longer wipe 1-share holders or corporate shareholders.** A prior bug rounded tiny holders to zero, either failing the restructure entirely or silently removing corporations and imperial characters from the register. Every holder with positive weight now receives at least 1 share; when the invariant still trips, the error names the affected holders instead of showing raw IDs. Corps 217 (Harris Industries) and 221 (British Chemical Company) were reparated for live-data victims.
- **Your corporation's Liquid Capital now counts toward Portfolio Net Worth.** Cash-only corps no longer show as `$0` Net Worth in the Portfolio & Wallet corp-mode view. Liquid Capital appears as its own stat tile, rail entry, and chart series.
- **Displayed income and strength projections now match what the turn actually pays.** Two separate drift bugs between the Financials / Budget tabs and `sectorCalculations.ts` — one in extraction-resource supply math, one in marketing/logistics strength normalisation — had let the displayed "next turn" projection diverge from the real debit. Both have been consolidated into single shared helpers.
- **Sector attack / expansion cost previews now match the actual charge.** The cost shown on an attack or expand button was computed via a different formula than the one the route used, so players were sometimes charged a different amount than what the UI quoted.
- **Sectors no longer count supply from commodities their state has zero capacity for.** Extraction margins were being unfairly dragged down by "supply" from resources the host state doesn't actually produce.
- **CEOs must retain at least 5% of their corporation's shares when creating a private listing.** Prevents insider-dump patterns before public disclosures.

**Financial Markets**

- **FX rate math was inverted in four places.** The forex turn phase was treating rising prime rates, GDP growth, trade surplus, and net buy pressure as _weakening_ the local currency when they should _strengthen_ it (and treating inflation the opposite way). Rates on all active forex currencies will now move in the intuitive direction. The "vs-base" color in forex tables and the sparkline arrow in the stock-market page were also coloured the wrong way — positive deviation is depreciation (red), not appreciation (green).
- **FX buy routes could take your money without giving you the bonds.** A rounding quirk (`Math.floor` instead of `Math.round`) in the market-maker trade helper could leave the converted balance one unit short of the cost, making the downstream buy route reject the purchase after the source-currency debit had already committed. Fixed.
- **Your Personal Cash chip now shows your total cash across every currency you hold.** Previously only your home-currency balance was displayed, which made money appear to "vanish" after a cross-currency trade even though it was safely sitting in the other currency.
- **Wire transfers capped at ₳5M per 24 hours.** Limit is anchor-normalised so it applies identically across USD / GBP / JPY / EUR senders. Prevents large liquidity flight from compromised accounts.

**Parliamentary Countries**

- **Post-election Confidence Motion.** After every lower-chamber general election (regular or snap), the sitting PM auto-files a 24-hour Confidence Motion. Pass and they stay; fail and the PM is vacated, the government collapses to pending, and the 96-turn vacancy clock re-arms. Closes the loophole where an incumbent with unfavourable coalition math could cling to office indefinitely.
- **Legislation freezes during government formation.** While a parliamentary country has no confirmed PM (status `pending`), bill proposals, modifications, and cabinet actions are blocked, and UK/JP bill-lifecycle phases skip entirely. Creates direct pressure to form a government instead of endlessly stalling.
- **VONC-parallel PM nominations.** PM appointment votes can now be filed during an active Vote of No Confidence (not just during a pending government). If the VONC fails, all parallel appointment votes are cancelled and nominees are notified. Lets opposition parties pre-position successors.
- **Snap elections blocked during an active VONC.** A sitting PM can no longer trigger a snap to preempt an imminent no-confidence loss.
- **Snap elections now vacate the PM immediately.** Triggering a snap (by PM or admin) now immediately unforms the government and clears the cabinet, bringing runtime behaviour in line with the snap-elections design doc.
- **Lower-chamber dissolution only clears the lower chamber.** Bills in the US Senate, UK Lords, JP Sangiin, JP cabinet review, or already enrolled survive dissolution; only the lower chamber's in-progress bills and active VONC votes are cleared.

### 🎨 UI

**Themes & Styling**

- **Every page now respects your selected theme.** A sweep of 20 files removed dead `dark:` Tailwind classes (they never activated) and replaced them with semantic tokens, so badges, alerts, modals, wiki content, and appoint/vacancy panels now follow the theme you picked instead of rendering as white islands or black-on-white strips.
- **Modal backdrops now adapt per theme.** The backdrop used to be a hard near-black on every theme; now it tints based on the theme's ink color — subtle on Broadsheet (cream paper theme), appropriately dark on the dark themes.

**Search**

- **Universal Search upgrade.** The navbar search now includes all 50 US states (by name or abbreviation), national country pages (US / UK / CA / DE / JP), admin-only tabs/subtabs for moderators (with an animated red glow when admin results are present), and a rotating placeholder with clickable example searches.

**Maps & Globe**

- **Japan now appears on the main map overview** alongside US, UK, and Germany.
- **Germany regional map** upgraded to the same `react-simple-maps` rendering every other country uses. Layout drift on the German map is fixed.

### 🔧 Platform

**Admin & Moderation**

- **Financial Transaction Ledger.** Every money movement on the platform — wires, share trades, bond flows, treasury credits/debits, dividends, salaries, payouts — is now logged and searchable. Admins get a Financial Ledger subtab under Economy with a filterable timeline plus a Suspect Alerts view that groups flagged transactions by subject. Moderators get a narrower view focused on reviewing/dismissing flags.
- **Moderator content tools expanded.** Moderators can now delete news posts and review player banner ads that violate content guidelines. All deletions record a mod audit entry.
- **Currency labels standardised to ₳.** Party fundraising, donate flows, action messages, and error strings all use the anchor symbol and FX-aware formatting instead of hardcoded `$`.
- **Resource capacities rebalanced ~1.5×** across US, UK, DE, and JP states/regions, widening the extraction margin band and giving commodity sectors more headroom.

**Security**

- **48-hour cooldown before creating a new character after voluntary retirement.** Closes the alt-cycle loophole where players reset their action economy and leadership eligibility by rapidly retiring and re-creating.

**Performance**

- **FX rates are now cached, and the heavy forex / stock-market / central-bank pages fetch data in parallel.** Noticeable TTFB improvement on those pages.

### 🐛 Bug Fixes

- **FX interventions now actually defend the band.** The first implementation routed reserve spending through the organic trade-volume channel, where a ±5% cap and 20% direction weight limited the CB to ~1% rate correction per turn — not enough to offset 2–3%/turn macro drift. Reserve spend is now reserve-proportional and the correction is applied directly: a 3% breach burns reserves in ~17 turns and meaningfully slows the slide; a 15%+ breach drains them in ~3 turns with a 5%-capped correction each turn. The intervention log now shows the currency symbol on reserve amounts (€281 instead of 281) and the column is labelled "Reserves spent."
- **Player banner ads now render on every eligible page.** After the multi-country migration moved game content to `/country/[code]/...`, the ad path filter wasn't updated, so ads silently failed on legislature, executive, elections, parties, stock market, metrics, central bank, and forex pages. Fixed.
- **User-uploaded images now display reliably.** Profile pictures, banner ad uploads, and anything else served from `/api/uploads/*` or Vercel Blob CDN now bypass Next.js image optimisation (they're already pre-optimised WebP) so they stop disappearing under certain request patterns.
- **Admin/Moderator Grant Resources panels show ₳ and a live FX preview.** Inputs were labelled `$` despite the forex migration storing campaign funds in anchor units; now clearly labelled `₳` with a live conversion preview showing what each country receives.
- **Policy and legislation pages rebuilt.** Congress, UK Parliament, JP Diet, and national policy pages had drifted from the shared enrichment contract — category filters, status filters, and display data were wrong or missing on multiple surfaces. Now consolidated behind a single contract with test coverage.
- **Hourly inflation no longer pegs at the 15% cap** for US/UK/JP/DE after the turn-275 commodity-price corruption; the underlying commodity duplicates were healed, a unique index now prevents a recurrence, and per-row pressure contributions are clamped so a single bad row can't detonate the average.
- **Sovereign bond self-buy check no longer crashes.** Calling `corporationId.toString()` on a sovereign bond (which has no `corporationId`) was throwing a 500 after the capital check passed; fixed with a null guard.
- **Several `toFixed()` crashes from `null` numeric fields.** The top Sentry crash cluster on `/profile`, `/country/*/budget`, and `/forex` — missing `priceChange1h`, `inflationRate`, spread composites, and raw rates — is resolved with null-coalesce guards.
- **Bond page no longer returns a 500 on DB connectivity issues.** The `generateMetadata` call in the bond page layout now returns `{}` on failure instead of crashing the route.
- **Germany is visible on the world map in economy-preview mode** regardless of "active" playability status; beta-status countries can now expose their economy window independently.
- **Corporation expansion modal now fits on short viewports.** The Confirm/Cancel footer was being pushed below the fold on 1080p laptops with the sector list expanded; now capped and scrollable.
- **Economy-preview countries no longer get gated behind `status === "active"`** — beta countries can expose an economy-only window.

---

## v0.2.7 — 2026-04-21

### ⚙️ Mechanics

**Corporations**

- **Sector growth rates now smooth over time.** When you adjust a sector's growth rate, it takes several turns to fully take effect — the economy (stock valuation, GDP, bond credit) uses the actual current rate, not the target setting. This prevents instant stock price manipulation via rapid growth-rate changes.
- **Stock splits and reverse splits no longer collapse market cap on the next turn.** When a CEO performs a split, the price is scaled to preserve market cap (e.g., a 10:1 reverse split turns a $100 share into a $1000 share). Previously the next corporation turn would immediately overwrite that scaled price with the formula's natural balance-sheet equilibrium, so the cap could collapse (or jump) by 50–80% in one turn — making splits look like value-destruction events. The price now drifts gradually from the scaled value toward the new equilibrium across several turns instead.
- **Hostile takeover blocked against insolvent targets.** A corporation with negative Liquid Capital can no longer be targeted for a hostile takeover. A bug that let the acquiring corp's cash be drained by the target's negative balance has been fixed. Corp #71 (Her Majesty's Arsenal) was affected — a one-time correction has already been applied.
- **Cross-country HQ relocation now converts treasury currency.** When moving your corporation's headquarters to a different country, all treasury funds, share price, and sector revenues are converted to the new currency at the current exchange rate. Open share orders are cancelled and refunded. Existing bonds retain their original currency.

**Financial Markets**

- **Share prices now display correctly for all currencies.** Buying shares from a corporation traded in JPY, GBP, or another foreign currency now shows the correct cost. Previously the displayed price was inflated by the exchange rate (≈132× for JPY corps), though the server always charged the correct amount.

### 🎨 UI

**Themes**

- **Three new themes added — Cloakroom, Broadsheet, Cold War** — `Cloakroom` is a warm dark theme (ivory on graphite) with oxblood and brass accents — a statesman mood for campaign/diplomacy surfaces. `Broadsheet` is an editorial day theme (cream paper, deep-ink text, crimson accent) that reads like a paper of record. `Cold War` is amber on near-black with salmon and slate-blue accents — a grown-up sit-room console aesthetic. All three are available in Settings → Appearance (now 11 themes across 3 carousel pages).
- **Default theme warmed up** — Background and card colors shifted from cold graphite to warmer tones. Separation between page and card is now more legible.
- **OLED theme hardened for true black** — Background pinned to pure black, card lifted slightly so edges register against the void. Foreground pushed to pure white, accents re-punched for high contrast.

**Navigation & Search**

- **Universal Search now available** — Search corporations, politicians, parties, and legislation from the navbar. Results appear in a dropdown as you type.

**Corporations**

- **New "Share History" tab under a corporation's Shares section.** Shows every share issuance, buy, sell, peer fill, private listing, and hostile-takeover payout — with timestamp, turn number, from/to parties, shares moved, price per share, and total. Paginated at 25 entries per page, newest first. The existing shares content moves to a "Market Overview" tab.
- **Share Purchase modal now scrolls on small mobile screens.** The Cancel/Buy buttons were previously off-screen on short mobile viewports. Fixed.
- **Sector market totals now display in the sector's home currency.** Previously, viewing a USD sector while preferring JPY/GBP made market sizes appear to shrink turn-over-turn due to forex fluctuations.

**Maps & Globe**

- **Germany is now visible on the world map** with economy data (stock market, central bank, forex, budget, metrics). Elections and politics remain admin-only while Germany is in economy-preview mode.

### 🔧 Platform

**Advertising**

- **Players can now buy banner ad slots** — visit `/player-ads` to upload a banner image and have it shown across the site. Cost is based on the current average character Liquid Capital. One ad per 24-hour window. Lowest-viewcount ads are prioritized to equalize exposure.
- **Adsterra removed.** The site now shows player-submitted banner ads only. The Patreon "all ads" option now means "player ads only."

**Germany**

- **EUR forex is now live.** The Euro exchange rate (EUR/₳) is now tracked and updated by the Forex system each turn.
- **Germany's central bank renamed to European Central Bank.**

### 🐛 Bug Fixes

**Corporations**

- **Your corporation's Liquid Capital now counts toward Portfolio Net Worth.** In the Portfolio & Wallet view, switching to the Corporation tab showed "Total Net Worth $0" for any corp whose cash was greater than its stock/bond holdings — the cash side was simply missing from the total. Liquid Capital is now its own stat tile, rail section, and chart series on the corp portfolio view, and is included in Net Worth. Historical net-worth charts will show a step-up on the turn this ships (old snapshots didn't record cash, new ones do).

- **Cost basis for limit-order fills during turn processing is now tracked.** Shares that arrive via a limit buy filling at the start of a turn now record the purchase price, so portfolio unrealized PnL displays correctly.
- **Shares held by a deleted CEO now return to the market.** A one-time cleanup released 51.4M previously-trapped shares across 12 corporations (including Corp #116) and vacated 6 ghost CEO seats.
- **`pricePerShareAnchor` was understated for non-₳ corporations.** Private listing offer accepts and turn-processor limit fills now correctly convert to anchor currency. Cost-basis records for shares filled since v0.2.6 may show slightly revised values going forward.

---

## v0.2.6 — 2026-04-20

### 🔧 Platform

**Forex**

- **Exchange-rate and central-bank charts now keep five in-game years of history, with quick range buttons (24h / 1y / 5y / All)** — Same idea as a stock chart: zoom out for the long trend or focus on the most recent day.

**Anti-abuse controls**

- **Admins can now close registration, ban specific IPs (with per-IP allowance caps for shared locations), and enable an automatic block when a new sign-up's IP matches an existing account.** The kill-switch closes all new-user paths (email, Google, Discord) simultaneously. IP allowances let verified shared locations (households, dorms, offices) sign up multiple accounts up to a cap.

- **New characters wait 24 real hours before they can run for or vote in party leadership or national committee elections.** The cooldown resets on party join, so freshly-joined members can't immediately swing leadership outcomes either.

### ⚙️ Mechanics

**Corporations**

- **CEOs can now bring their corporation along when they relocate from a region page.** The "Relocate here" button shows three options: Cancel, Relocate & Abandon Corporation, or Relocate & Move Corporation. The move option is paid from Liquid Capital or a new 7-year bond — whichever the corp can afford. Imperial CEO corps auto-move with the character at no cost.
- **Headquarters can now be moved to a different country** from CEO Office → Administration → Relocate Headquarters. Pick a country, then a destination state/region. Out-of-country moves cost double (14% of market cap instead of 7%).
- **A HQ move that leaves the CEO outside the new region will vacate the CEO seat.** Shareholders can then elect a new CEO who lives there, or the outgoing CEO can relocate into the new region themselves. The UI warns you before submission.

**Trade & Tariffs**

- **You can now propose trade bills with tariff provisions** from the Bills tab in every legislature (US Congress, UK Parliament, Canadian Parliament, German Bundestag, Japanese Diet). Pick `Category: trade` and add up to 3 tariffs per bill — **economy-wide** (applies to all foreign imports), **sector-targeted** (pick one industry to tariff), or **origin-country-targeted** (pick one foreign country whose imports you want to tariff). Rate is 0–100%. Rate 0 nullifies any existing tariff at that scope. Origin-country options are filtered to playable countries and exclude your own. Two in-flight bills can't target the same scope at the same time — the second will be rejected until the first resolves. Corporation-scoped tariffs remain admin-only for now.

**Parties**

- **National Party Player Whip** — National party Chairs and Vice Chairs can now Whip your party's actual players (not just NPPs) on bills, leadership elections, PM appointment votes, no-confidence motions, and cabinet nominations. The whip overrides every seated party player's vote in that chamber to the whipped direction once per bill/vote, sends each whipped player an in-game mail and notification, and lets them manually revert by re-voting. Primarily a tool to cover AFK players in close votes.

**Parliamentary countries**

- **Prime Ministers of the UK and Japan can now call snap elections** — A new "Call Snap Election" button on the Leadership tab dissolves the lower chamber (Commons / Shūgiin) and opens fresh elections immediately. Up to 2 per PM appointment, with a 2-real-week cooldown between uses. Dissolution cancels every active regular lower-chamber race, fails every bill in-progress, and collapses the government to pending.

- **96-hour PM-vacancy auto-snap** — If a parliamentary country sits without a confirmed Prime Minister for 96 real-time hours (any cause: post-election, post-no-confidence, admin vacate), an automatic snap election fires. The per-appointment limit is bypassed so this always takes effect. Captures the UK post-FTPA "try to form an alternative government, otherwise an election" convention and Japan's Article 69 resign-or-dissolve window.

- **Election clock shifts after a snap** — Once a snap election resolves, the LARP schedule slides forward: UK's next regular Commons is scheduled 5 game-years after the snap (not the original 2024 / 2029 / 2034 bootstrap); Japan's next Shūgiin is 4 game-years after. The admin recalibrate-timers tool applies the same shift.

- **Party organisation caps — regional bodies now count** — UK Regional Councils and Japan's Sangiin (House of Councillors) now contribute to their party's state-organisation cap. Previously, winning regionalCouncil or Sangiin seats built no party infrastructure — only commons/shugiin did. UK's 85-point cap allocation now splits commons (60) + Regional Council (25); JP's splits Shūgiin (60) + Sangiin (25). The overall cap ceiling is unchanged at 100; existing UK/JP parties will see their commons/shugiin cap contributions drift down over the next cycle as the new distribution takes effect.

### 🎨 UI

**Party page**

- **Whip tab restructured** — The Whip tab now has Players / NPPs sub-tabs (state parties show NPPs only), and each has Bills / Leadership / Cabinet sub-sub-tabs with chamber chips under Bills. The existing NPP whip mechanic is unchanged — it just lives under a new sub-tab. Bill voting pages show a "Whipped by Party" badge with a Revert button when you've been whipped, so you can flip back in one click.

**Corporation pages**

- **Corporate Tax history chart** — New option on the Charts tab plots per-turn Federal vs State/Regional corporate tax over time. Turns before this release render as zero (the data wasn't being saved until now); new turns onward show real values. Cross-border corps will see distinct lines for each jurisdiction via the breakdown stored on each snapshot.

### 🐛 Bug Fixes

**Presidential campaigns**

- **Campaigns can no longer bleed into unbounded negative balances.** Ground Game and Media Spending maintenance was being charged every turn with no balance check, so a campaign whose maintenance outran its Fundraising income would drain indefinitely (one presidential race hit −$3.4M before the fix). Now, when the upcoming turn's maintenance exceeds projected funds, the campaign automatically drops one level of its most expensive maintenance tier (Media Spending first on ties) and keeps dropping until solvent or both tiers hit zero. You don't get the money back — the levels you overspent on are gone. Existing campaigns that were already negative have been retro-demoted so they stop bleeding; the outstanding deficit is still on the books, but fundraising income will slowly pay it down.

**Banned players**

- **Banned players no longer appear on National Party Members lists, and their leadership/committee votes no longer count.** Previously, banning an account only withdrew their candidacies in governmental elections — their votes for chair, vice chair, treasurer, and National Committee, plus any active leadership candidacies, were left in place and continued to influence outcomes. Banning now also withdraws those candidacies, deletes those votes, and blocks banned accounts from voting or declaring candidacy in any party-internal election. National Party Members lists now hide banned characters (state party lists already did), so banned accounts no longer pad member counts or income projections. A one-time cleanup also runs against existing banned accounts.

- **Banned players are now removed from any party leadership seats and committee seats they were holding.** Previously a banned chair / vice chair / treasurer / committee member would only be hidden from display — the underlying record still pointed to their account, so any authorization or coalition lookup that read the seat directly would still resolve through them. Banning now vacates every national chair, vice chair, treasurer, state-party chair / vice chair / treasurer, and national-committee seat held by the banned account, and clears any coalition chair pointer that resolved through them. The same cleanup is applied to historically banned accounts via the one-time script.

**Payments — dividends, CEO salary, and bond income now pay the correct amount in your currency**

- **Dividends, CEO salary, bond coupons, and bond-maturity returns are now credited in your local currency at the live exchange rate.** Previously, every personal-income credit deposited the raw internal (anchor / USD-equivalent) number directly into your local-currency balance — so JP players were being paid roughly 1/96× the intended amount (a ¥22M/turn dividend was landing as ¥229k), UK players were being paid roughly 1.25× the intended amount (₳ deposited into GBP without conversion), and US players were short ~12% because the anchor↔USD rate isn't 1:1 after forex rollout. Every personal-income pathway now goes through the same anchor → local FX conversion that the corp-to-corp flows were already using. Affects: dividend payouts, CEO salary, bond coupon income, bond-maturity face-value returns, bond-default dissolution payouts, the user-triggered "pay off defaulted bonds from cash" flow, and parent-corp bond payoff. **Historical balances are NOT retroactively adjusted** — only payments from this release forward use the correct scale. If you're owed a historical correction, open a ticket.
- **Profile "Personal Cash" breakdown now shows correctly-converted income values.** The dividend income, CEO salary, bond coupon income, and portfolio value rows under your Personal Cash panel now apply the same FX conversion as the rest of the site (corporation Financials tab, status bar). Previously they slapped a currency symbol on the raw internal number, which is why a player seeing "¥229K/turn" on their profile was simultaneously seeing their corporation pay out "¥22M/turn" in dividends on the corp page — the profile wasn't converting, the corp page was. Same display fix applied to Donor Network and Campaign Cash breakdowns.

**Line of Credit**

- **Borrow → repay loop no longer prints free money for the central bank.** A refactor left the repay side crediting the full principal + interest back to the central bank's reserves while the borrow side no longer debited them — so every borrow-and-immediately-repay cycle silently inflated the bank's reserves (and, because the system-wide lending cap is 70% of deposits + reserves, the overall borrowing ceiling crept up with it). Repaying principal now correctly destroys money symmetrically to how borrowing creates it; only interest still flows back to the bank as revenue.

**Corporations — share price now does honest accounting**

- **Bond debt now properly counts against corporate share prices.** Previously, issuing a bond would inflate your corp's price even though the cash you received was offset by an obligation to pay it back — share price would jump up at issuance and then crash later when the bond matured or coupons drained your liquid capital. Now bond issuance is neutral on share price (cash up, debt up, net zero); the price only moves when you actually deploy the proceeds productively. Every levered corp will see its share price drop on the next turn by roughly `outstanding bond debt / total shares`. **State-owned national enterprises are exempt** — since the government already covers their bond interest, their principal is treated as sovereign-backed and won't drag the share price down.

- **Sovereign bond holdings now count toward your share price.** US Treasuries, gilts, JGBs — any sovereign bonds your corp holds now properly add to your balance-sheet equity for share-price purposes, matching what your corp page already showed in the portfolio view. Previously a corp parking cash in safe sovereign debt would see its share price tank because the math treated the bonds as if they didn't exist. (This was the proximate cause of Aurora Group's mysterious 38.4% drop on April 19th.)

- **Bond events now show up in your share price the same turn they happen.** Previously, when one of your held bonds matured, when a credit-spread move repriced a bond you owned, or when coupons hit your `liquid capital`, the share-price formula didn't see those changes until the _next_ turn. Now share prices recompute after the bond turn and reflect everything the same hour — no more "why didn't my matured Treasury settle into my price yet" weirdness.

- **Corporation page balance sheet equity now matches the share-price math.** The `totalEquity` figure on your corp's balance sheet is now computed the same way the share price uses internally (cash + sector NPV + portfolio − bond debt). Previously this number ignored debt entirely, making leveraged corps look richer on paper than the market actually valued them.

**Corporations — tax revenue in non-USD countries**

- **Japan & UK national and regional budgets now actually collect tax from corporations** — A forex-rollout regression made corporate tax-base contributions to non-USD budgets effectively invisible (Japan's JPY base was receiving anchor-denominated numbers ~150× too small, UK's GBP base ~25% too small). National and regional corporate-tax revenue figures on country/region pages now reflect real corporate activity at the right scale. US budgets are unchanged (anchor currency ≡ USD).

**Bonds — denomination is fixed at issuance**

- **A bond pays coupons and returns face value in the currency it was issued in, for life.** A JPY-denominated corporate bond pays JPY coupons; a GBP gilt repays GBP at maturity. That's always been the intent, but under the forex rollout admin-initiated cross-country HQ moves could silently re-denominate outstanding corporate bonds into the corp's new-country currency — e.g. a JP corp relocated to US would have its existing JPY bonds start paying USD coupons at the next coupon turn. Coupon payouts, maturity returns, buy/sell/buyback routes, net-worth math, and credit scoring now all resolve a bond's currency from `bond.currencyCode` (set at issuance) and never from the issuing corporation's current country. Matches real-world bond contracts and keeps the bond's denomination, coupon currency, and face value aligned for the entire life of the bond.

### 🎨 UI

**Legislation & bill lists (UK / Japan / international)**

- **UK Commons proposals support multiple provisions again** — Trade bills and other multi-part legislation use the same multi-row editor pattern as Japan (up to three provisions), instead of a single hardcoded row.

- **National legislature bill lists outside the US now show full bill context** — Sponsor, category, and provisions display consistently for Japan, Canada, Germany, and the United Kingdom.

- **Diet members no longer see vote buttons on bills they cannot vote on** — If you only sit in the House of Representatives, Sangiin-origin bills you are only browsing no longer offer an Aye/Nay control you could not legally use.

- **State policy records carry correct scope metadata when a state bill becomes law** — Prevents downstream lookups from attaching the wrong jurisdiction key.

**Parliamentary UI**

- **UK Parliament Leadership shows the Prime Minister and Opposition Leader again immediately after a general election** — The tab no longer goes blank while the government is in handover.

**Japan — dashboards & prefectures**

- **Japan national ("jp_national") metric pages load again** instead of erroring out.

- **Prefecture metric pages use Japan's national policies for tick-rate and "what affects this metric" context** — They no longer fall back to another country's federal policy row.

**Elections**

- **US presidential map summaries use real party colors** — The electoral-vote legend and popular-vote shading could render every candidate as the same default purple; they now match the map.

- **Election list cards prefer server-resolved party colors** — Primary and listing views no longer tint every candidate purple while party metadata is still loading.

- **County and constituency results maps no longer label late-entering candidates as "Unknown"** — If someone joined the race after vote tallies had already started, their votes were counted but their name could disappear from the results map and table until this release.

**Campaign Manager**

- **Upgrade bars respect each category's true maximum** — Fundraising tops out at 10; most other operations top out at 5. The UI no longer draws progress past what the server allows.

- **Fog-of-war estimates for opponents stay within the real caps** — Public and party-intel views could randomize above the true maximum so two candidates looked like they played by different rules; estimates now clamp to the same ceilings the engine uses.

---

## v0.2.5 — 2026-04-18

### ⚙️ Mechanics

**Corporations — taxation overhaul**

- **Corporate tax now applies per sector, not per headquarters** — Every sector your corporation operates is now taxed at that sector's country federal rate and state/regional rate. A US-HQ'd corp with a sector in the UK pays UK federal tax on its UK income and US federal tax on its US income — no more cross-taxation, no more freeriding on low-rate HQs. State tax is apportioned by revenue share across your sectors, so the state where your sector sits matters directly for what you pay.

- **State corporate tax bills finally do something** — State/regional tax-rate legislation (e.g. "State Corporate Tax Rate" bills) now updates the state budget's tax rate and feeds into the per-sector deduction next turn. Before this release, state tax bills updated legislative records but had no fiscal effect.

### 🐛 Bug Fixes

**Corporations**

- **Federal corporate tax was silently non-functional in production** — A long-standing seeding/projection bug meant the federal corporate tax deduction was never actually being applied to corporations. That's fixed: from the next turn after this release, profitable corps will start paying their due. Expect a visible contraction in corporation liquid capital and share prices as markets adjust.

### 🎨 UI

**Corporations**

- **Federal + State tax rows on Financials** — The single "Corporate Tax" line on the corp Financials tab is replaced by "Federal Tax" (with a per-country breakdown tooltip for cross-border corps) and "State / Regional Tax" rows.

- **Per-sector tax on sector detail page** — Each sector page now shows the federal and state rates that apply to that sector plus an approximate tax amount, so you can see at a glance which of your sectors are tax-advantaged by location.

---

## v0.2.4 — 2026-04-17

### ⚙️ Mechanics

**Central Bank**

- **Discord rate announcements** — Prime rate cuts and hikes post to each country’s Discord channel (US/UK/JP) plus the global game channel, with green/red styling and basis-point moves.

- **Chair selection — accept or decline** — When a chair term ends, you may be proposed as the next chair: accept to take the seat or decline so the next eligible candidate can be offered the role. Notifications cover nominations, pending selection, accept, and decline.

**Japan**

- **Diet members can propose bills** — Seated House of Representatives and House of Councillors members can propose national legislation from the Japan legislature page, with chamber-accurate procedure and Shūgiin supremacy rules.

- **House of Councillors staggered elections** — Sangiin classes no longer collide or disappear as false “duplicates”; resolving one class no longer wipes the wrong class’s seats; and the six-year cycle spacing is corrected (including after schedule recalibration).

**Elections & Campaigns**

- **US presidential primaries** — Expanded tooling for primaries: campaign branding and manager roles, richer maps and per-state flows, delegate-style primary allocation, home-state surge, and supporting API updates.

**Relocation**

- **Move without getting blocked** — Relocating withdraws you from every active race (general, primary, party, committee) instead of preventing the move.

- **Same-country moves are lighter** — Moving between states keeps your party and national/party influence; donor base, political influence, group favorability, and old-state party leadership still reset.

- **Cross-country moves stay heavy** — Changing countries resets party to Independent and clears national influence, with an accurate confirmation dialog before you confirm.

- **Career timeline** — Relocations appear on your profile as “Relocated …” entries.

**Corporations & Finance**

- **Share price vs holdings** — Listed price better reflects portfolios (stock in other companies, bonds, IMF positions), so holding companies track assets instead of sitting near floor value.

- **Corporate bonds** — New bond issues use updated spread and maturity rules.

- **HQ relocation** — Moving headquarters respects CEO residence and country rules.

- **IMF restructuring** — Corporations under an IMF program cannot refinance defaulted bonds until the program ends; the crisis UI explains why.

**Legislation**

- **Remove co-sponsorship** — Co-sponsors can withdraw support on bills that are still proposed or active.

**Parties**

- **Treasury stays in sync** — National and state party pages keep treasury and action pool figures aligned after influence actions; chair campaign donations debit the real party treasury.

**Foreign exchange**

- **Wallet totals** — Multi-currency wallet totals and hints sum and display correctly across balances.

- **Wires in any held currency** — Wire transfers can send USD, GBP, or JPY from whichever balance you choose, not only your home currency.

### 🎨 UI

**Portfolio**

- **Command-center layout** — Portfolio uses a sidebar rail on desktop and section navigation on mobile, with live section values and a clearer toggle between personal assets and your CEO corporation.

**Foreign exchange**

- **Forex page overhaul** — Rate chart scales fairly across currencies, cross-rate cells jump into trading with the pair selected, player search for direct trades, a real trade history tab, richer orders and order book, and a clearer market banner.

**Maps**

- **Election map tooltips** — Tooltips on US, UK, and Japan maps flip upward near the bottom of the map so southern regions stay readable.

**News**

- **News vs sponsored** — Separate posting flows for news and paid sponsored posts, with tabs and admin removal where appropriate.

**Corporation pages**

- **Shares tab — corporate shareholders** — When another company holds stock, its row shows that company’s logo instead of a generic placeholder.

**Site**

- **Cookie preferences** — First-visit cookie banner with accept/reject and a footer link; ads stay non-personalized until you choose.

### 🔧 Platform

**Admin**

- **Traffic analytics** — Hourly windows, unique-visitor toggle, geography and device breakdowns, slow-page insights, and busiest-time callouts.

- **IMF corporate bailout** — Admin tooling for distressed-corporation restructuring (operators: see internal design docs for full procedure).

- **Turn controls** — Forex and fast-mode toggles are grouped as dedicated feature toggles.

### 🐛 Bug Fixes

- **Parliamentary government** — No-confidence and PM appointment votes can resolve as soon as voting ends when you load the page; UK/JP hubs no longer show a deposed PM from stale data.

- **Forex correctness** — Broad fixes so personal and corporate money flows use the right currency units when forex is enabled (wallets, shares, bonds, founding, dissolution, central-bank wealth ranking, and more).

- **Auth & profile** — Expired sessions return a proper unauthorized response instead of a server error; Settings no longer flashes “logged out” after Profile; corporations with imperial shareholders no longer break profile or portfolio views.

- **National party treasury** — Send and transfer validation respects display currencies and formatted amounts.

- **Corporate bonds view** — Legacy sector data without country info no longer crashes the bonds screen.

---

## v0.2.3 — 2026-04-16

### ⚙️ Mechanics

**Commodity markets**

- **Richer sector demand** — Healthcare, logistics, entertainment venues, defense, and chemical sectors now pull on **food** and **vehicles** in line with their operating strategies, so those commodities better reflect the simulated economy.

- **Full regional price coverage** — Every state gets a commodity price each turn (blended from global and local supply/demand even when no corporation operates there), so commodity region maps stay complete instead of showing gaps.

- **Tariffs vs input costs** — When tariffs bite, commodity-driven margin math now shifts weight toward **national** supply/demand (not just your state vs the whole world), matching how national trade policy should affect domestic input prices.

**Corporations**

- **Forex-correct payouts** — Dissolving a corporation credits the CEO’s personal wallet in their **home currency** at the correct cross-rate. Buying shares in your own company (self-issue) debits your wallet using the same forex rules as other spend paths.

- **Sector page commodity margins** — The national “bucket” used for input-cost math on an individual sector now sums the whole country’s commodity picture, matching the corporation overview and the simulation.

### 🎨 UI

**Commodity pages**

- **Clearer economics** — Commodity country and region views show prices formatted the same way as the rest of the game when currency exchange is enabled.

**Foreign exchange**

- **Consistent exchange screens** — The main currency exchange page and per-currency pages use the same volume formatting and trade entry patterns as the dedicated pair view; the world menu includes a quick link to currency exchange.

## v0.2.2 — 2026-04-13

### ⚙️ Mechanics

**Foreign Exchange** _(not yet enabled for players)_

- **Multi-currency trading** — The game now features a foreign exchange system with floating rates for USD, GBP, and JPY. Each country's currency moves based on its own economic performance: prime rate, inflation, GDP growth, and trade balance all push rates around. Player trading volume also shifts rates - large buys push prices up, large sells push them down.
- **Market maker & limit orders** — Trade currencies instantly at market rate (with a spread fee) or place limit orders that trigger when your target rate is reached. Limit orders escrow your funds until filled or cancelled.
- **Direct player-to-player trades** — Propose a currency swap directly to another player at a custom rate. The counterparty can accept or reject.
- **Auto-convert** — When you buy something priced in a foreign currency, the system can automatically convert from your home currency at the current market rate. Toggle this per-character in your profile.
- **Spread fees** — Every trade pays a small spread: half is permanently destroyed (deflationary sink for the economy) and half goes to the central bank's forex revenue. Market orders pay 0.275%, limit orders 0.175%, and direct trades 0.10%.
- **Feature-gated** — The forex system is behind an admin toggle. Until enabled, all existing fund mechanics work exactly as before.

**Corporations**

- **Vacant CEO decay** — Corporations without an active CEO now lose 10% of each sector's revenue and workers per turn. The lost output returns to the state's unowned sector pool. Find a CEO or watch your company bleed.
- **Tariff display** — Corporation sector panels now show "Foreign tariff" and "Tariff friction" line items when tariffs affect margins. Sectors with active tariff effects show a warning badge.

**Commodity Markets**

- **Advertising demand is hungrier** — Corporate marketing budgets now generate 3× more demand for the advertising commodity (20% → 60% conversion rate). Expect upward pressure on advertising prices and better margins for sectors that produce advertising.
- **Financial services demand restored for Japan, Canada, Germany** — Latent financial services demand (driven by bond issuance) was silently zero for countries whose sovereign bonds were all issued at game start. The demand window now covers one full game year instead of 12 turns, so long-lived sovereign bonds keep generating financial services demand until they mature. Expect higher financial services prices in JP/CA/DE state markets.

**Corporations**

- **Bond refinance reworked: no more phantom cash + 2-refi lifetime cap** — When a corporation defaults on a bond, the CEO has three options: pay the defaulted principal in cash, **refinance**, or dissolve. Previously, refinancing silently credited the corporation with the full face value of the new bond in liquid capital, treating it as if the new bond had been sold to fresh investors. But the existing defaulted bondholders are just being rolled into the new bond at par — no new money is coming in. That cash was phantom, and it enabled an exploit where a CEO could default → refinance (free cash) → pay dividends → default again in a loop. **What refinance does now:** it's a debt-for-debt swap. Existing holders get their claim restored from $0.10 back to face value in the form of units in the new bond, the default is cleared, and the corporation keeps operating — but no cash is added to the treasury. The new bond carries a higher (CCC-floored) coupon so debt service gets more expensive. **Also:** refinancing is capped at **2 times per corporation over its lifetime** as a guardrail against indefinite debt rolls. After the cap is reached, the refinance button is disabled and dissolution becomes the only remaining option for the defaulted debt. The crisis modal shows "Used X of 2 lifetime refinances" so you can see where you stand. The existing 2× equity limit, CCC credit floor, and 96-turn penalty window all still apply.

**Elections**

- **Seat projections** — Multi-seat races (House, state senate, Commons, etc.) now track projected seat counts over time. A new "Seat projection" tab in election trends shows how the seat allocation evolves as votes come in.
- **Party colors** — Election charts and vote tallies now use each party's official color instead of generic chart colors.
- **Banned candidate withdrawal** — Elections now automatically withdraw banned players from active candidacies.

### 📚 Content

**Japan**

- **Region maps** — Japan's 47 prefectures are now mapped to 8 economic regions (Hokkaido, Tohoku, Kanto, Chubu, Kansai, Chugoku, Shikoku, Kyushu) with interactive maps on commodity pages. Each region is clickable and shows local commodity production data.

### 🎨 UI

**Navigation**

- **Guides** — A new Guides section is accessible from the Help menu in the navbar. Beginner guides are available for Corporations, Running for Office (US and UK/Japan), Investing, Bonds, Commodities, and Currency Exchange.
- **Currency Exchange links** — The world dropdown and mobile menu now include direct links to the currency exchange page for your country.

**Status Bar**

- **Status bar layouts** — The bottom status bar now has three switchable layouts, selectable from Settings > Appearance:
  - **Standard** — Actions, funds, cash, political influence, favorability, and game clock.
  - **Corporate** — Share price sparkline, market cap, liquid capital, and recent price trend for your corporation.
  - **Elections** — Live vote share, seat projection, and favorability for your active election.
- **Political influence display** — The status bar now shows political influence as a clean integer with a `%` symbol (e.g. `47%` instead of `47.1`). Updated tooltip explains what political influence actually does.

**Profile**

- **Currency wallet** — Your profile's financial overview now shows a multi-currency balance breakdown when the forex system is active, displaying how much you hold in each currency.
- **Corporate investment portfolio** — Corporation portfolio moved to its own page at `/portfolio/corporation/[id]`. CEOs can toggle between personal and corporate assets from the Budget tab.

**Commodities**

- **Better stat card buttons** — Commodity country stat cards now lead with "View Nation Map" as the primary action when a map is available, with "View Country Page" as a secondary link. Click-outside behavior also fixed for desktop and mobile.

### 🐛 Bug Fixes

- **Wire service election results** — Election results in the wire ticker now correctly show party names instead of raw party IDs.
- **Character profile redirect** — Visiting an old-format character URL now correctly redirects to the sequential URL instead of dropping you on the map.
- **Achievement awarding** — Fixed a race condition where rapid concurrent actions could trigger the same achievement simultaneously.
- **Election trends chart** — The trends chart on election detail pages no longer disappears when switching between vote share and cumulative vote tabs on elections with limited snapshot data. Tabs are now properly disabled when insufficient data exists.

## v0.2.1 — 2026-04-12

### ⚙️ Mechanics

**Corporations**

- **Government bond subsidy** — State-owned enterprises now have their bond interest costs covered by the government. A new "Government Bond Subsidy" line appears on the Financials tab showing the offset. Sovereign corporations can no longer default on bonds.

### 🎨 UI

**Navigation**

- **Stable signed-in navbar** — The top navigation should no longer briefly look logged out or show the loading skeleton on top of the page when moving between routes or when the network hiccups; session state is only cleared when the server actually reports a guest.

**Onboarding**

- **Faster path to your politician** — After you create an account, you are sent straight into character creation instead of the settings hub first.
- **Fresh header after creating a character** — When you finish making your first character, the site refreshes server state before opening the dashboard so menus and profile data line up with your new character.

**Profile**

- **Home region link** — Profiles for older characters that were missing a stored country now pick up the country from the page you are viewing, so the home region link and labels stay correct.

**State parties**

- **Party logos** — State party pages now pass the page country into party logos so the correct party mark shows for that country.

### 🐛 Bug Fixes

- **Stock and corporation charts restored** — Historical chart data that was lost during a turn processor outage has been backfilled. Market cap history and per-corporation charts now show continuous data.
- **Settings page load** — The settings screen is wrapped in a proper loading boundary so it behaves reliably with Next.js client navigation.

## v0.2.0 — 2026-04-10

> **A House Divided is now in Beta.** Thank you to everyone who played during Alpha — your feedback shaped the game. Beta opens the doors wider: more countries, more players, and a more polished experience. Japan joins the US and UK as a fully playable nation, and the game is now stable enough for public play. There will be bugs, but there will also be real politics.

### ⚙️ Mechanics

**Corporations**

- **Private Share Listings** — Shareholders can list shares for private sale. Buyers place competing offers between 50% and 200% of the listed market price. The seller reviews all offers and accepts any in full or in part. Unaccepted escrow is refunded automatically. Listings expire after 24 hours if not accepted.

### 🎨 UI

**New Players**

- **Getting Started Suggestions** — New players now see a "Getting Started" section on the action suggestions page guiding them through key first steps: joining a party, setting demographics, voting on a bill, and running for office. Each suggestion disappears automatically once completed.

**Cabinet**

- **Cabinet Avatars** — Cabinet pages now show character avatars with Patreon supporter frames alongside each minister's name.

- **Party Chips & Profile Links** — Cabinet members now display their party affiliation and link directly to their character profile.

**Avatars**

- **GIF Avatars for Supporters** — Patreon Supporter and Supporter+ tiers can now upload animated GIF profile pictures.

### 🔧 Platform

**Security**

- **Name Moderation** — Character and display names are now checked against an expanded list of blocked terms including stronger profanity and common evasion patterns.

**Admin**

- **Activity Log** — Admins can now view a full paginated event log of player activity: AP spend, fund transfers, donations, campaign contributions, and login/logout events. Filterable by type, country, date range, and text search.

- **Suspicious Activity Detection** — The game now automatically flags characters exhibiting suspicious patterns (IP sharing, fund concentration, AP dump targeting, and more) and surfaces them in a dedicated admin tab with one-click dismiss and 30-day suppression.

- **Player Transfer Pause** — Admins can now freeze all player-to-player, party, coalition, and campaign fund transfers with a single toggle — useful during incidents or investigations.

- **Admin Registration Toggle** — Admins can disable self-registration with the admin key from the admin dashboard, preventing new admin accounts from being created once the team is set.

### 🐛 Bug Fixes

- **GOTV Action Link** — The "Get Out the Vote" action suggestion now correctly links to the party treasury tab.
- **Government Vote Whips** — Whip directives for government votes (PM appointment, no-confidence) now target the correct chamber.
- **Mobile Nav Help Links** — Help dropdown links are now mirrored in the mobile menu.

---

### ~~Alpha~~ — Final release: v0.1.10

---

## v0.1.10 — 2026-04-10

### ⚙️ Mechanics

**Countries & Expansion**

- **Japan is now playable** — Japan joins as the third fully playable country. Play as a politician in the National Diet with 8 regions, 6 political parties, and a bicameral legislature (465-seat House of Representatives and 248-seat House of Councillors). Japan features a parliamentary system where the Prime Minister is appointed via confidence vote, snap elections can dissolve the lower house, and cabinet-origin bills follow a unique bicameral process with a 2/3 override mechanic. Japan-specific legislation types and policy effects are coming in a future update.

- **Japan Map** — An interactive map of Japan with 8 clickable regions, mode filters, and region overview links. Prefecture boundaries are visible on hover.

- **Country Management** — Admins can now enable or disable countries for player access. When a country is disabled, character creation and relocation are blocked, and API routes filter results accordingly. Admins bypass all restrictions.

**Economy**

- **Dynamic Unemployment** — Unemployment now responds to GDP growth through Okun's law, creating a more realistic economic feedback loop.

**Stock Market**

- **Multi-Exchange Support** — Stock exchanges are now fully generalized. Any country with a configured exchange automatically gets market pages, snapshots, and wealth rankings. Japan launches with the Nikkei exchange alongside NYSE and FTSE.

- **Wealth Tracking** — The wealth list now updates hourly, showing 24-hour wealth changes and rank movement for all players.

### 🎨 UI

**World & Globe**

- **World Page Redesign** — The nation selection page now separates playable countries from planned/coming-soon nations with distinct card styles.

- **Globe Coloring** — The interactive globe now reflects live country status from the database instead of using hardcoded colors.

**Elections**

- **Election Card Redesign** — General election cards have been redesigned with improved layout and pagination.

- **Party Logos on Declarations** — Candidate declaration badges now show the candidate's party logo.

**Avatars**

- **Square Avatars** — All player avatars now use square images with rounded edges for a cleaner look. Patreon supporter borders display across all areas. A fullscreen image viewer has been added.

### 📚 Content

**Countries & Regions**

- **Japan Seed Data** — Full launch data for Japan: 8 regions, 6 parties, 10 voter archetypes, regional demographics, budgets, metrics, and 15 cabinet positions with ministerial orders.

### 🔧 Platform

**Performance**

- **Serverless Optimization** — Reduced serverless function invocations through improved caching and polling intervals.

**Admin**

- **Country Toggle Panel** — New admin Countries tab for enabling/disabling countries with player count display and confirmation dialogs.

- **Discord Account Heal** — Admin tool to fix broken Discord-linked user accounts.

### 🐛 Bug Fixes

- **Campaign Songs** — Fixed campaign songs cutting out after ~1 second.
- **Market Share Display** — Market share percentages no longer exceed 100%.
- **Coalition Duplicates** — Fixed a bug where parties could appear multiple times in a coalition's member list.
- **Coalition Leadership** — Coalition chair now updates correctly when the chair party elects new leadership.
- **GDP Values** — Fixed corrupted GDP growth values across states.
- **UK Government Stability** — PM now survives elections instead of being cleared. Government auto-collapses gracefully if the PM character is deleted.

## v0.1.9 — 2026-04-07

### ⚙️ Mechanics

**Government**

- **Player-Driven PM Appointment** — The UK Prime Minister is now appointed by players, not automatically. After a Commons election, the Party Chair of the majority party (or Coalition Chair if a coalition holds 326+ seats) can nominate any player character from their party for PM. The nomination goes to a Commons-wide vote lasting 24 hours. NPPs from the governing party automatically vote in favor.

- **Coalition Government Formation** — When no single party holds a majority, coalitions can form a government. If a coalition's combined seats reach 326+, the Coalition Chair can nominate any player from any coalition member party for PM. NPPs from all coalition parties vote in favor.

- **Minority Government** — When no party or coalition reaches 326 seats, any Party Chair with 130+ seats can attempt to form a minority government through the same nomination and vote process.

- **No-Confidence Votes** — Any elected Commons MP can propose a motion of no confidence against a sitting Prime Minister. All Commons MPs vote over a 24-hour window. If passed, the PM is removed, the cabinet is cleared, and the government returns to a pending state for fresh formation. A 48-turn cooldown prevents spam.

- **Lost Majority Detection** — If a governing party or coalition loses seats below the 326 majority threshold (through by-elections, party switches, or coalition changes), the Executive page flags "Formed (Lost Majority)" as a signal that a no-confidence vote may be warranted. The PM stays in office until removed.

- **Whip Integration** — Party leaders can whip their MPs on PM appointment votes and no-confidence motions. NPPs comply with whip directives at 100%.

**Cabinet**

- **Cabinet Office System** — All 15 US and 15 UK Cabinet positions now have dedicated mechanics with national and regional metric targets. US positions range from Secretary of State to Secretary of Homeland Security. UK positions include Chancellor of the Exchequer, Foreign Secretary, Home Secretary, and all Secretaries of State through to the devolved nation offices (Northern Ireland, Scotland, Wales). Each position influences specific policy areas relevant to its portfolio.

- **Ministerial Orders** — Cabinet members can issue executive orders that apply targeted metric bonuses for 24 turns (one half-year). Each position has 2 unique orders — for example, the US Secretary of Treasury can launch a "Fiscal Stimulus" to reduce unemployment, while the UK Chancellor can trigger an "Emergency Budget Review" for fiscal adjustment. The Home Secretary can issue an "Enhanced Policing Directive" and the Health Secretary can deploy "NHS Emergency Funding". Cabinet members have an action pool of 2, regenerating 1 action every 24 turns.

**Economy**

- **GDP Growth from Real Output** — GDP growth is now calculated from actual sector revenue changes rather than manually set growth rates. Every state gets meaningful GDP data, even those without player-owned corporations.

- **Labor Market Unemployment** — Unemployment is now derived from labor supply vs. filled jobs instead of being directly set by policy. New targetable metrics: labor participation rate and structural friction.

- **Inflation Responsiveness** — Interest rate changes now have 30% immediate effect on inflation (up from ~8%), with the remaining 70% propagating over 12 turns. Rate decisions are felt much faster.

- **Growth Cost Fix** — Corporation growth costs were ~3x too expensive due to a raw rate multiplier. Now properly normalized.

### 🎨 UI

**Executive & Parliament**

- **Executive Page Overhaul** — The Downing Street Hub now shows dynamic government status across five states: Awaiting Formation, Formed, Formed via Coalition, Formed via Minority, and Formed (Lost Majority). Coalition governments display their coalition name and combined seat count. Cabinet section is always visible with vacant slots when no PM exists.

- **Commons Leadership Tab** — New "Appoint Prime Minister" button for qualifying chairs, "Propose No-Confidence" button for any Commons MP (greyed out during cooldown with tooltip), and a unified vote panel showing tallies and countdown timer.

### 🐛 Bug Fixes

- **Share order fill amount** — Share order fills were incorrectly sending zero shares instead of the actual amount.

- **Cabinet page loading** — US cabinet page no longer endlessly loads when the API returns an error.

- **Concurrent turn processing** — Added a lock to prevent duplicate cron invocations from double-processing economic calculations.

- **Coalition duplicate members** — Fixed a bug where parties could appear multiple times in a coalition. Each party now appears only once.

- **Coalition leadership display** — Coalition chairs now correctly update when party leadership changes. Previously, coalitions showed stale leadership after party elections.

## v0.1.8 — 2026-04-07

### 🔧 Platform

**SEO & Discovery**

- **Multi-country metadata** — Site description, Open Graph, and Twitter cards now mention all playable countries (US, UK, Canada, Germany). Wiki and News pages have dedicated metadata for search indexing.

- **Footer links** — Landing page footer now includes About and Contact links alongside existing Privacy and Terms.

### 🎨 UI

**Profiles**

- **Country-aware office titles** — Office labels now display correctly for each country. US executives show "President of the United States"; UK executives show "Prime Minister of the United Kingdom". Legislative labels use country-specific terminology: Bundestag members, Commons MPs, Regional Councillors. Career history correctly records appointed events for players entering executive offices through succession or appointment.

**News**

- **Server-rendered news page** — News page now renders server-side with descriptive intro text for search crawlers. Client-side interactivity unchanged.

**Politicians**

- **Directory intro text** — Country politicians page now shows a brief server-rendered explanation of what the directory contains.

### 🐛 Bug Fixes

- **Career history for executives** — Presidential and vice-presidential winners, losing player candidates, and UK Prime Ministers now correctly record career events. Players entering office through succession (VP → President) or appointment (UK PM) have proper `appointed` events in their career timeline.

- **UK bill country resolution** — Bills in UK legislature pages now correctly resolve their country using `resolveBillCountryId()` instead of fragile `uk_` prefix heuristics. Legacy bills without `countryId` are handled until migration backfills the field. Bill detail responses include `countryId` for client-side filtering.

## v0.1.7 — 2026-04-06

### ⚙️ Mechanics

**Legislation**

- **UK Legislation Overhaul — 55 Bill Types** — The UK now has a complete set of realistic legislation covering 16 policy categories. Parliament handles 34 national types including NHS funding, education standards, defence spending, Universal Credit, immigration, and more. Regional Councils handle 14 local types covering transport, policing, housing, emergency services, and environmental services. Every bill type has 7 uniquely named policy options ranging from maximum government intervention to full privatisation, with realistic per-capita costs in GBP.

- **UK Tax System — 7 Tax Types** — Five national taxes (Income Tax, National Insurance, VAT, Corporation Tax, Excise & Customs) and two regional taxes (Council Tax, Business Rates), each with 11 brackets and distinctive policy titles.

- **Regional Budget Constraint** — UK Regional Councils must balance their budgets. Revenue comes from Council Tax, Business Rates, and a Westminster grant set by Parliament. If a council overspends, forced austerity automatically downgrades the most expensive programme each turn until the budget is balanced. This creates real fiscal trade-offs at the regional level.

- **Dynamic Regional Economy** — Regional property and commercial values drift over time based on investment decisions. Higher spending attracts residents and businesses (raising the tax base), while austerity drives them away (shrinking it). This creates a virtuous or vicious investment cycle visible in the regional metrics.

**Government**

- **Local Government Funding** — Parliament controls how much money flows from Westminster to the 12 UK regions. A future Chancellor of the Exchequer position will be able to allocate this funding unevenly across regions.

### 📚 Content

**Countries & Regions**

- **14 UK-Specific Metrics** — New metrics unique to British politics: NHS Waiting Time, Mental Health Access, Social Care Quality, GCSE Attainment, University Enrollment, Apprenticeship Rate, Anti-Social Behaviour Rate, Knife Crime Rate, Flood Risk, Child Poverty, Housing Affordability, Rough Sleeping, Devolution Satisfaction, and BBC Trust. Each region starts with calibrated values reflecting real UK economic geography.

### 🎨 UI

**Page Redesigns**

- **Sector Page Redesign** — Corporation sector detail pages have a new two-column layout with a hero stats strip at the top. The margins panel is collapsed by default with costs grouped by category. CEO controls are in a collapsible management panel. The market actions card is now hidden when no actions are available.

- **UK Regional Budget Panel** — UK regional pages now show a budget summary with revenue breakdown (Council Tax, Business Rates, Westminster Grant), total spending, and surplus/deficit status with colour-coded indicators.

- **UK Economic Metrics** — Property Value Index and Commercial Value Index now appear in the Economy section of UK regional metrics, giving players visible feedback on how their investment decisions affect the region.

### 🔧 Platform

**Notifications**

- **Coalition Invite Links** — Coalition membership invite notifications now include a direct link to the coalition page.

**Admin**

- **UK Legislation Seeder** — New "UK Legislation" button in the admin Universal Seeder refreshes UK legislation types independently of US types.

- **Split Budget Seeding** — US and UK budget seeds are now separate buttons instead of being linked together. UK-related seeder buttons renamed from "State" to "Region" for consistency.

### 🐛 Bug Fixes

- **UK budgets missing after reset** — UK regional budget data is now correctly re-seeded when the game is reset, preventing blank budget panels on regional pages.
- **Settings page sections hidden** — A styling issue caused sections of the settings page to be invisible. This is now fixed.
- **Appointment notifications** — Notifications for admin-issued appointments now correctly say "by an admin" instead of showing blank attribution.

## v0.1.6 — 2026-04-05

### ⚙️ Mechanics

**Economy**

- **Sector subsidies** — Legislatures can now pass industry bills to grant or end sector subsidies. Active subsidies give a flat +15% margin bonus to qualifying corporate sectors. Federal and state subsidies stack (up to +30%). Subsidies can target an entire economy, a specific sector, corporations using a particular operating strategy, or domestic corps only. A new `end_subsidy` bill type removes an existing subsidy. Active national subsidies are listed on a new Subsidies tab on the Congress page. Corporation pages show a panel listing subsidies that benefit them.

**Corporations**

- **Attack and split from sector pages** — When viewing another corporation's sector, you can now both attack their market share and split the unowned portion of that sector without navigating away. Both actions are available from a unified Market Actions panel.

### 🎨 UI

**Actions**

- **Action Suggestions dashboard** — A new Suggestions page shows personalized action recommendations grouped by priority (Critical → High → Medium → Low). Covers low stats, market opportunities, competitive gaps, party treasury, and vacant positions. Each card shows what to do and why, with direct links to the relevant page or one-click execution where applicable. Party org-building is now flagged as High priority.

- **Suggestions strip** — The Actions page now shows a compact suggestions strip with color-coded priority indicators and a link to the full dashboard.

**Corporations**

- **Commodity page redesign** — The commodity detail page has been rebuilt with a hero price panel, supply/demand bar, demand driver highlights, production flow visualization, regional breakdown, and interactive world maps.

**Profile**

- **Political Compass colors** — The four quadrants of the political compass now use distinct colors: red (authoritarian-left), blue (authoritarian-right), green (libertarian-left), and purple (libertarian-right).

### 🔧 Platform

**Security**

- **Privacy Policy & Terms of Service** — New legal pages at `/privacy` and `/terms`. Registration now requires accepting these policies.
- **Rate limiting** — Player-facing action endpoints now have consistent, uniform rate limits to protect against abuse.

**Performance**

- **Politicians page** — Now server-rendered for faster initial load and better search engine visibility.

**Navigation**

- **Site footer** — A footer with links to Privacy Policy, Terms of Service, About, and Contact is now visible on all pages.
- **About & Contact pages** — New `/about` and `/contact` pages.

**Patreon**

- **Patreon supporter integration** — Link your Patreon account in Settings to unlock in-game cosmetic benefits. Benefits apply automatically and stay active for 30 days after a lapsed pledge.

- **Profile borders** — Supporters can choose from 24 border styles that appear around your avatar across the entire site. Styles are grouped into Static, Animated, and Frame categories. Many borders are tintable — they blend with a custom highlight color you pick. Supporter Plus unlocks all animated styles (Comet Ring, Aurora Ribbon, Ion Storm, Starlight Orbit, and more) plus decorative frame styles.

- **Supporter badge** — An "S" or "S+" badge appears on your profile showing your tier and how long you've been a supporter.

- **Animated GIF avatars** — Supporter Plus subscribers can upload animated GIF profile pictures.

- **Custom highlight color** — Choose an accent color that tints your border and other cosmetic elements.

### 🐛 Bug Fixes

- **Party organization display rounding** — Fixed floating point precision issues showing values like `53.791000000000002` instead of `53.79`. All organization, cap, and momentum values now display cleanly rounded to 2 decimal places.

- **Info tooltips not tappable on mobile** — Tapping info icons on mobile could trigger double-tap zoom or fail to open. Tooltips now respond reliably to touch with a proper tap target size.

- **State officials card names truncated** — Politician names in the House/Senate officials sections could be cut off or overlap with party badges. Names now wrap cleanly and party badges stack correctly.

### ⚙️ Mechanics

**Elections**

- **Turnout actions now affect elections** — Canvassing, GOTV spending, and voter suppression finally have a measurable impact on election outcomes. These actions modify turnout rates per demographic group, and those modified rates now flow through to both poll projections and actual vote accumulation.
- **Presidential election influence fixed** — Presidential candidates were getting their influence score counted twice (once for reach/recognition, once for appeal). This has been corrected so that a candidate's ideological alignment matters more than their raw fame score.

---

## v0.1.5 — 2026-04-04

### ⚙️ Mechanics

**Economy**

- **Persistent unowned sectors** — Unowned sector revenue is now stored in the database instead of being calculated as a gap from GDP. Each state×sector combination has a persistent document that grows at the average corporate growth rate for that sector (or 1% if no corporations exist). This means unowned sectors naturally regenerate over time instead of being permanently drained by corporate splits.

**Financial Markets**

- **Corporation portfolios** — Corporations can now buy and sell stocks and bonds. A new Portfolio tab on each corporation page shows current holdings, cost basis, and unrealized gains/losses. CEOs can toggle between buying as themselves or as their corporation when trading in the stock market.

**Government**

- **Tariffs** — Legislatures can now pass trade bills to impose tariffs on foreign corporations operating within their borders. Tariffs can be economy-wide, sector-specific, origin-country, or targeted at a specific corporation, and stack up to 100%. Foreign corps face a direct margin penalty equal to the tariff rate. Domestic corps see a smaller supply-chain cost but gain a competitive advantage when splitting into tariffed sectors. Commodity prices also shift slightly toward local supply as tariff coverage increases. A Trade Restrictions panel on each corporation page shows active tariffs affecting it.

### 🎨 UI

**Financial Markets**

- **Portfolio Avg Cost & Unrealized P&L** — Your portfolio now shows average cost per share and unrealized profit or loss for each stock position.

### 🐛 Bug Fixes

- **County map showing all one color** — County-level election maps were ignoring Cook PVI data and showing every county in the same uniform color. Counties now correctly reflect local lean, producing a realistic gradient from deep partisan strongholds to competitive swing counties.
- **Whip directives not overriding existing NPP votes** — If an NPP had already voted on a bill or confidence vote, a whip directive had no effect. Whips now correctly override conflicting existing votes.
- **National budget surplus calculation using stale data** — Bond issuance calculations could use an outdated spending figure, producing incorrect deficit values. Spending is now recalculated fresh before surplus is determined.
- **Central bank lobbying couldn't fund new candidates** — Once any contributions existed, only already-funded candidates appeared in the picker. The full candidate list is now always available.

## v0.1.4 — 2026-04-03

### ⚙️ Mechanics

**Character**

- **Account-Character Separation** — Your account and character are now independent. Registration creates your account first, then you create your character separately. You can retire a character while keeping your account, achievements, and a full archived profile of your past career.
- **Character Retirement** — Retire your character from Settings > Character Danger Zone. Your character's profile is preserved as a read-only archive you can revisit anytime under Retired Characters in Account Settings.
- **Account-Bound Achievements** — Achievements now stay with your account, even if you retire a character. Your earned badges carry over to new characters.

### 🎨 UI

**Settings**

- **Account Settings Redesign** — Settings are now organized into Account sections (always visible) and Character sections. Account settings include profile, connected accounts, appearance, referrals, achievements, retired characters, and security.
- **Create Character Page** — New standalone character creation page with branded experience, accessible from Account Settings when you don't have an active character.
- **Retired Character Profiles** — View full archived profiles of retired characters including career history, policy positions, stats, and demographics.
- **Navigation Guard** — Players without a character can only access Settings and Help until they create one.

### 🔧 Platform

**Admin**

- **Migration Tool** — New one-time migration under Admin > Support > Migrations to transition existing accounts to the separated model.
- **User Management** — Admins can now retire a user's character or delete their account separately, and view retired character history.

**Government**

- **UK Regional Council** — Every UK region now has an elected Regional Council, a sub-national legislature with seats based on real-world local government council counts (364 total across 12 regions). Elections run on proportional multi-seat allocation, synchronized with the Commons election cycle. Regional Councillors can propose and vote on regional bills that take effect without governor approval. NPPs fill council seats using region-appropriate party distribution. Holding a Regional Council seat is mutually exclusive with a Commons seat.

### 📚 Content

**Countries & Regions**

- **Northern Ireland parties** — DUP (Democratic Unionist Party) and Sinn Féin can now be seeded independently via the admin panel, enabling proper NI party representation in Regional Council elections.

### 🔧 Platform

**Admin**

- **UK Regional Council seeder** — New admin seed target creates Regional Council elections synced to current Commons timing and populates NPP officials for all 12 UK regions.
- **NI Parties seeder** — Separate seed target for DUP and Sinn Féin, allowing NI parties to be added to the live game without touching other parties.

### 🐛 Bug Fixes

- **Chamber chart tie display** — When two or more parties hold equal seats in a legislature, the chart now correctly shows them as tied rather than arbitrarily declaring one the leader.
- **UK party logos in legislature** — Party logos in the legislature composition chart now correctly show UK party logos instead of US ones.
- **Election vote share chart cramped** — When candidates had similar vote shares, the chart compressed everything into a flat band at the top of the graph. It now zooms in to the actual data range so differences between candidates are visible.
- **Corporation production policy revenue not calculating correctly** — Revenue multipliers from production policy levels were not being applied during turn processing, causing affected corporations to earn the wrong revenue.

### ⚙️ Mechanics

**Financial Markets**

- **Portfolio tracking charts** — View your investment portfolio performance over time with interactive line charts on your profile and other character pages. Toggle between Total, Stocks, Bonds, and Cash views to see how each asset class has performed, or use Breakdown view to see all three together. Requires at least 2 turns of history — new portfolios will show "Not enough data yet" until the turn processor captures snapshot data.

### 🎨 UI

**Profile & Portfolio**

- **Portfolio value over time** — Line charts on `/profile` and `/character/[id]` pages show portfolio value history with interactive hover tooltips. Choose between single-series views (Total, Stocks, Bonds, Cash) or a Breakdown view showing all three asset classes together.
- **Series color coding** — Charts use consistent colors: Total (indigo), Stocks (green), Bonds (amber), Cash (blue) for easy recognition across pages.

### 🔧 Platform

**Performance & Data**

- **Portfolio history breakdown** — The turn processor now captures stock, bond, and cash values separately each turn, enabling detailed portfolio analytics. Historical data includes per-turn breakdown for retroactive chart display.
- **Portfolio API enhanced** — Both `/api/character/portfolio` and `/api/character/[id]/portfolio` now return detailed history with `stockValue`, `bondValue`, and `cashValue` fields per turn.

**Performance Improvements**

- **General performance optimizations** — Various under-the-hood improvements to reduce page load times and improve responsiveness across the application.

### 🎨 UI

**Navigation**

- **Consistent URLs across all countries** — All pages now use a clean `/country/us/...` and `/country/uk/...` URL structure. State pages, party pages, elections, legislature, executive, budget, policy, metrics, and more — everything lives under a unified country path. Old bookmarks and links still work via automatic redirects.
- **"National" page renamed to "Metrics"** — The national overview page is now called "Metrics" and lives at `/country/us/metrics` (or `/country/uk/metrics`).
- **Politicians moved to Nation menu** — The Politicians link has moved from the World dropdown to the Nation dropdown, since politicians are now browsed per country.

## v0.1.3 — 2026-04-02

### ⚙️ Mechanics

**Parties**

- **Coalitions** — National party chairs can now form coalitions with other parties in the same country. Create a coalition (costs 25 actions), invite other parties, or request to join an existing one. Coalition chairs can kick members, transfer leadership, or initiate a 24-hour disband vote that requires a majority of all member parties to pass. Coalitions are currently organizational — gameplay effects coming in a future update.
- **Coalition chair succession** — If the coalition chair's party leaves or is removed, leadership automatically passes to the most senior remaining member (earliest join date). Chairs can also voluntarily transfer leadership to another member party's national chair.
- **Leave coalition** — Member party chairs can now leave a coalition directly from the coalition stats strip without visiting the Chair's Office tab.

**Mail**

- **Player mail** — You can now send direct messages to other characters. Open the mail composer from any character's profile page, write your message with bold and italic formatting, and hit send. A 1-per-minute rate limit applies.
- **Mail inbox** — The Notifications page now has a Mail tab. View your inbox and sent messages, expand conversations, and delete mail you no longer need.
- **Report mail** — If you receive a message that violates the rules, you can report it directly from your inbox. Admins review all reports and can warn or ban senders.
- **Shareholder address** — CEOs can now broadcast a formatted message to all current shareholders from the CEO Office tab. Shareholders receive it as a system notification. 12-hour cooldown between addresses.

**Corporations**

- **Attack sector** — You can now attack a sector directly from its detail page, making hostile takeover actions quicker to find.
- **Sector transition countdown** — When switching a sector's operating strategy, a countdown badge now appears on the sector card showing how long until the transition completes.

**Government**

- **Cabinet nomination whips** — Party whips can now issue directives on cabinet nominations. NPPs comply at 100%, just like with confidence votes and leadership elections.
- **Instant whip compliance** — NPP bill whip votes now take effect immediately instead of waiting until the next turn. Leadership election and confidence vote whips are also instant.
- **UK confidence vote whipping** — Confidence votes in the UK Parliament can now be whipped, with NPPs following the party line.
- **Vote two-phase pattern** — Votes and cabinet nominations now start in a "proposed" state with a visible countdown before becoming active and accepting votes, so nothing catches you off guard.

**Central Bank**

- **Chair resignation** — Central bank chairs can now resign directly from the central bank page.
- **Auto-resign on relocation** — If you relocate to a different country while holding a central bank chair position, you automatically resign from it.

### 🎨 UI

**Profile**

- **Achievements redesign** — Achievements now display as large labeled tiles showing the icon, name, and rarity. Locked achievements show a lock overlay instead of fading out. The expanded view groups achievements by category with a progress bar per category.
- **Political compass markers** — Your compass now shows your party's position and your home state's lean as labeled reference points, with a dashed line and delta labels (e.g. +3 / −2) so you can see at a glance how you compare.
- **Party-colored compass dot** — Your dot on the political compass uses your party's color.
- **Campaign Funds on profile** — Campaign Funds now appears in the stat grid on your profile page alongside your other resources.
- **Campaign Office link** — The Actions card on your profile now links directly to your Campaign Office.

**Parties**

- **Coalitions tab** — The Political Parties page now has a Parties/Coalitions tab switcher. The Coalitions tab shows all coalitions in the country with member counts, party chips, and chair names.
- **Coalition detail page** — Each coalition has its own page with Overview (averaged policy positions, leadership list), Parties (member list), and Chair's Office (manage invites, requests, membership, and disband votes). Admins have an Admin tab for manual management.
- **Create Coalition button** — National party chairs see a "Create Coalition" button on the parties page. Non-chairs see a grayed-out button with a tooltip explaining the requirement.
- **Coalition invites** — When your party is invited to a coalition, you'll see an acceptance banner at the top of the coalition page (similar to CEO offers). Accept or decline with one click.

**Legislation**

- **UK bill processing unified** — UK Commons bills now go through the same lifecycle as US bills, so deadlines, enrollment, and expiry behave consistently across both countries.

**Maps & Globe**

- **UK lean colors corrected** — UK constituency map now shows Labour-leaning areas in red and Conservative-leaning areas in blue (were previously swapped).

### 📚 Content

**Countries & Regions**

- **DUP and Sinn Féin** — The Democratic Unionist Party and Sinn Féin are now included in the default UK party lineup with official logos.

### 🔧 Platform

**Notifications**

- **Coalition notifications** — 10 new notification types keep you informed about coalition invites, join requests, kicks, disband votes, and leadership changes.
- **Party election notifications consolidated** — When multiple party leadership positions open at the same time, you now receive one notification instead of one per position.

**Discord**

- **Game event feeds** — Major events like election results, government formation, and confidence votes are now posted to country-specific Discord channels automatically.
- **Stock chart command** — The Discord bot can now show price history charts for individual corporations or the whole market.
- **Government command** — New Discord bot commands for checking government status and looking up players and parties.
- **Changelog posts** — New changelog entries are automatically posted to Discord.

**Performance**

- **Faster turns** — Turn processing is now significantly faster thanks to shared data between phases and parallel execution of independent steps.
- **Faster Discord bot** — Stock exchange and investor data is pre-computed each turn instead of calculated on demand, making bot responses snappier.

**Admin**

- **Leadership elections panel** — Admins can view, pass, fail, or cancel active leadership elections from a new dedicated tab.
- **Legislation browser** — The admin legislation tab now has country tabs, sub-tabs, and pagination for easier navigation.
- **Reset movement cooldown** — Admins can clear a player's relocation cooldown without resetting their password.
- **Heal stale campaigns** — New heal tool finds and cleans up campaign records that should have been deleted (finished elections, withdrawn candidates, country mismatches).
- **Budget heal tools** — New heal tools for fixing federal and state budget calculation errors.

### ⚙️ Mechanics

**Parties**

- **Faster party org growth** — The cost to build party organization has been reduced from $100k to $75k per org point, making it ~33% faster to grow your ground game.

### 🎨 UI

**Profile**

- **Actions breakdown** — The actions display on your profile now shows the total including party influence bonus actions (e.g. "+4/turn" instead of "+3/turn" if you're earning +1 from party influence). The tooltip breaks it down: base + office + party.
- **Party Influence details** — The Party Influence tooltip now shows your current bonus actions per turn, max possible bonus, and your share of the party's total influence pool. The sub-label shows your net influence gain/loss per turn.

### 🔧 Platform

**Wiki & Docs**

- **Wiki updated** — All game guide pages on the wiki have been refreshed to cover the latest features. New wiki pages for Player Mail and Coalitions. Updated pages for elections (travel mechanic), corporations (production modes, HQ relocation, shareholder address), achievements (tile grid redesign), and more.

### 🐛 Bug Fixes

- **Fixed: party org NaN in London & Wales** — Party organization values in London (7 parties) and Wales (1 party) were corrupted to NaN, causing the "No parties have active organization" message. Values restored and a guard added to prevent recurrence.
- **Fixed: stock purchase error** — Buying shares no longer shows a 404 error. Alerts replaced with toast popups.
- **Fixed: invisible candlestick chart** — The market index candlestick chart bodies were invisible; now properly filled and at higher resolution.
- **Fixed: cross-country relocation leftovers** — Moving between countries now properly removes your party roles and membership instead of leaving stale data behind.
- **Fixed: UK confidence vote math** — All UK confidence and no-confidence votes now weight MPs by seats held, correctly reflecting multi-seat holders.
- **Fixed: UK NPP voting** — NPP vote counts, party names, and chamber switching now work correctly on UK bill pages. NPPs also vote correctly on confidence and minority government attempts.
- **Fixed: election percentages** — Vote percentages on state election lists now match the numbers on election detail pages.
- **Fixed: position badges** — Policy position badges no longer show for axes that don't apply to a given piece of legislation.
- **Fixed: UK MP party names** — The UK Parliament member list now shows party names instead of internal ID numbers.
- **Fixed: national bills in state legislature** — Defense, foreign policy, and immigration bills no longer appear in the state legislature proposal dropdown.

## v0.1.2 — 2026-03-27

### 🎨 UI

**Page Redesigns**

- **Unified legislature composition layout** — The US Congress, UK Parliament, and State Legislature pages now all share the same composition design: a hemicycle seat chart at the top with a seat bar, party legend, and majority banner, followed by a searchable, sortable, paginated member list. Previously each page had its own different layout.
- **NPP indicators** — All legislature member lists now show an "NPP" badge next to non-player politicians, making it easy to tell players apart from NPPs at a glance.
- **State Legislature streamlined** — State Legislature pages now show the full hemicycle chart with search and sorting. The separate "Members" tab has been merged into the Composition tab.

### 📚 Content

**Countries & Regions**

- **Canada Parliament page** — Canada now has a full Parliament page at `/legislature/ca` with a Commons/Senate chamber switcher, hemicycle seat chart, Bills tab, and Leadership tab. All tabs are ready and will populate once Canadian elections run.
- **Germany Bundestag page** — Germany now has a full Bundestag page at `/legislature/de` with a Bundestag/Bundesrat chamber switcher, hemicycle seat chart, Bills tab, and Leadership tab. Ready for when German elections are activated.

### 🎨 UI

**Legislation**

- **Bill list layout toggle** — Both US Congress and UK Parliament bill pages now have a Cards/Compact view switcher. Toggle between the detailed card layout (with vote donuts, timelines, and policy badges) and a compact list view. Your preference is saved between sessions.
- **Inline bill voting** — Vote Aye, Nay, or Abstain directly from the bill list without opening the bill detail page. Your current vote is shown on each bill.
- **Vote status filter** — Filter the bill list by All, Voted, or Not Voted to quickly find bills you haven't weighed in on yet.
- **Individual voter breakdown** — Bill detail pages now have a Votes tab showing every individual voter's name, party, and vote direction. Filter by party, player/NPP, or vote direction.

### ⚙️ Mechanics

**Elections & Campaigns**

- **Fundraising overhaul** — The fundraising upgrade track now has 10 levels instead of 5, ranging from $20k/turn at level 0 to $5M/turn at level 10. Campaign income is now entirely determined by your fundraising level — candidate stats no longer factor in. Upgrade costs scale steeply, especially at high levels.
- **Campaign donations** — Any player can now donate their personal Cash on Hand directly to any active campaign. Party chairs can also donate from the party treasury. All donations appear in a public donation log on the campaign page.
- **Opposition research retargeting** — If you have opposition research purchased, you can now change who you're targeting at any time — with a 6-hour cooldown between retargets.
- **Campaign season surge** — In the final 4 hours before an election closes, media spending and opposition research effects automatically double. No setup required.
- **Action floor** — Every campaign now generates at least 1 action per turn, even with zero endorsements.
- **General election cost surge** — Once an election moves into the general phase, all campaign upgrade costs increase by 50%.

**Parties**

- **Party org is now a bonus, not a penalty** — Party organization now acts as a pure multiplier bonus on vote totals, ranging from 1.0× (no org) to 1.6× (max org). Previously low organization penalized parties heavily (as low as 0.05×). Building org now rewards you rather than merely avoiding punishment.

**Presidential**

- **Candidate travel** — Presidential candidates (primary and general) can now spend 5 action points to travel to any US state. While there, they earn a passive +1% favorability bonus per turn. Their current state shows as a 📍 badge on the electoral map and candidate list — so everyone can see where candidates are focused.
- **Fixed: VP never assigned for computer-controlled presidents** — When a computer-controlled politician (NPP) won the presidency, their vice president was silently never assigned. Fixed — the most influential same-party NPC is now auto-selected as VP.
- **Fixed: Vacant presidency never filled** — If the sitting president's office became vacant, the VP was never promoted to fill it. The VP now automatically succeeds to the presidency each turn when the office is empty.

**Parties**

- **Party influence** — Characters now build party influence over time based on how closely their policy positions match their party, plus bonuses for holding leadership roles (Chair, Vice Chair, Treasurer, National Committee). Higher influence earns extra action points each turn, proportional to your share of total party influence. Infamy reduces the benefit.

**Legislation**

- **Budget costs on all bills** — Every piece of legislation now has a budget impact. Expansive policies cost money; cuts and deregulation save money. This affects federal and state budgets when bills pass.
- **Immigration policy redesign** — Immigration is now split into two distinct policy areas: Border Security & Enforcement (border patrol, detention, deportation) and Legal Immigration & Visas (visa caps, pathways to citizenship). Each has different effects and appeals to different voter groups.
- **Formal bill names** — All legislation now uses official-sounding names like "Federal Education Investment Act" and "National Defense Authorization Act" instead of generic labels.
- **Extreme positions matter more** — Passing extreme legislation (far left or far right) now has a stronger effect on how voter groups feel about politicians who supported it. Moderate and centrist positions have smaller impacts.
- **Legislation overhaul v3** — All US legislation types overhauled with 11-bracket tax systems, LARP-style bill names, absolute budget costs, and dual-axis political scoring. Federal bills now apply proportional effects per state (1/50th per state). Metrics naturally decay toward baseline when policies change, preventing permanent drift.

### 📚 Content

**New Legislation**

- **State Economic Recovery Act** — New state-level economic stimulus spending legislation (`state_spending_stimulus`).
- **State Housing and Development Act** — New state-level housing and development legislation (`state_housing`).
- **Minimum wage $/hour rates** — Minimum wage bills now display the actual dollars-per-hour rate for each option alongside the standard political scoring.

**UK Government**

- **Minority government formation** — After a UK election with no majority, the largest party (if they hold at least 130 seats) now gets an "Attempt Minority Government" button on the UK Government page. NPPs always vote yes. Player MPs across all parties can vote. If the vote reaches 130 yes votes, a PM is appointed and the government is formed. If it falls short, the status resets and you wait for the next election.
- **UK Government hub** — The full UK government experience (Commons hemicycle, minority/confidence panels, executive PM card, seat tables) is now consolidated at `/executive/uk`. The old `/uk/government` link redirects there automatically.

### 🔧 Platform

**Admin**

- **Change home state** — Admins can now change any character's home state from the Players → Characters tab: type a username, pick a state from the dropdown, done.

### 🐛 Bug Fixes

- **Fixed: stale campaign tab** — Players who left a presidential race or switched countries would sometimes still see the campaign tab. This data is now cleaned up correctly.
- **Fixed: PM never appointed after majority win** — After a majority election with no current PM, a confidence vote is now correctly triggered so a PM is actually selected.
- **Fixed: organization showing "gone"** — A data formatting issue caused party organization values to display as 0 or "gone" on the state party page. Fixed.

---

## v0.1.1 — 2026-02-25

### ⚙️ Mechanics

**Character & Campaign**

- **Favorability decay** — Public approval now eases toward **30%** instead of 40%, and the per-turn drift when you’re above that level is **gentler** than before.

**Parties**

- **Simplified organization building** — Investing in organization now directly grows your party’s presence instead of going through momentum. Every $100k spent adds +1.0 organization per turn. Organization decays at -0.25 per turn when you stop investing, making growth more predictable and less punishing.

**Corporations**

- **Stock splits and reverse splits** — CEOs can now run a stock split or reverse split from the Shares tab. All shareholders and the public float scale proportionally; the share price adjusts so the total market cap stays the same. A 48-turn cooldown applies after each restructure.
- **Peer-to-peer share trading** — Share buy and sell orders are now listed separately and matched against each other when prices overlap, creating a proper order book.
- **Sector production policy** — CEOs can now view and change the production policy for each sector from the sector detail page.
- **Clearer type-switch cooldown** — When changing your corporation’s primary or secondary type, the CEO screen now compares the cooldown to the live game turn and shows how many turns are left, instead of a confusing fixed number.
- **Type-switch cooldown shortened** — Total lockout for switching corporation type reduced from 96 hours to 72 hours (24-hour penalty + 48-hour cooldown, down from 24 + 72).

### 🎨 UI

**Stock Market**

- **Tabs and Stats** — The exchange hub tabs are reordered (Stocks, Bonds, Commodities, Wealth List) and there is a new **Stats** tab with sector breakdowns, a global sector market-cap-over-time chart, and bond and commodity summaries. Bookmarked `?tab=listings` links still open the stock list.
- **Stats charts** — The Stats tab adds a market-cap mix pie by sector, per-sector company bar charts with one shared metric control (revenue, profit, market cap, share price, or dividend rate), top companies per sector, and consistent colors from your corporate brand color when set.
- **Timeframe selector** — The market index chart now has **24h / 48h / 5y / All** buttons. Shorter views show real timestamps on the x-axis; longer views show game years with real dates.
- **Chart transition animation** — Switching between timeframes now animates: shorter views compress in, longer views expand out.

**Elections**

- **Primary results on state page** — Primary standings on the state elections tab now show candidate avatars, linked names, live vote percentages (including 0% for newly entered candidates), and an “Uncontested” label — matching the detail found on the election page itself.

**Campaign Operations**

- **Batch actions (×5 / ×10)** — You can now run the same campaign action 5 or 10 times in a row from a single button press. A confirmation dialog shows the total cost and net funds impact before you commit. Action point costs scale with each repeat so batching is efficient but not free.
- **Poll vs last election comparison** — The election comparison panel on poll results now shows actual vote shares from the most recent completed election cycle, so the numbers match reality.
- **Compact layout fix** — Confirming ×5 or ×10 actions in compact view now shows the full confirmation dialog correctly (no more clipped overlay).

**Corporations**

- **Company page header** — Corporation pages now have a wide banner area like Campaign Operations. CEOs can upload a custom banner; everyone sees key numbers (share price, market cap, dividend rate) in the strip below.

**Changelog**

- **Banner image** — The What’s New page uses a classic terminal photo in the page header.

### 📚 Content

**Countries & Regions**

- **United States overview** — The nation overview page now shows a Mount Rushmore photo in the header banner (your flag still appears in the corner and on the world map).

### 🔧 Platform

- **Faster landing globe** — The spinning globe on the home page now renders with the same optimized pipeline as the world map, so it loads faster and uses less CPU.

### 🐛 Bug Fixes

- **Wire and news display** — State and region IDs in wire headlines and news posts now show proper place names instead of raw codes like `CA` or `UK_EOE`. Sector names also show correctly (e.g. “Real Estate” instead of `real_estate`).
- **Wealth leaderboard photos** — Player profile photos now appear on the wealth leaderboard, falling back through uploaded → Google → Discord avatars.
- **Fed chair lobby form** — The lobby form on the Central Bank page no longer disappears after selecting a candidate from the dropdown.
- **State economy commodity links** — “View Commodity Prices” links on Canadian and German state pages now route to the correct country’s stock market instead of always landing on the US page.
- **Independent presidential candidates** — Independents can now enter the general phase of a presidential election from the UI; previously the button was hidden even though the server allowed it.
- **UK Parliament seat count** — Fixed the House of Commons total from 652 to the correct 650 seats (South East England and East of England each had one extra).
- **UK Commons elections** — Fixed rare duplicate-key errors when multiple UK regions resolved elections in the same turn, and fixed a bug where election recovery could accidentally delete sitting officials.
- **Cross-country whip directives** — UK party chairs can no longer accidentally issue whip directives on US bills.

### 🔧 Platform

**Discord**

- **Market share command** — The Discord bot can now show sector market share breakdowns — globally, by country, or by state — so you can check the competitive landscape without leaving chat.

**Admin**

- **Corporation timer heal** — Admins can diagnose and clean up stale corporation type-switch timer fields from the System → Heal tools.

**General**

- **0.1.1** — App version is now **0.1.1**.

---

## v0.1.0 — 2026-02-24

### ⚙️ Mechanics

**Demographics & polling**

- **More reliable internal polls** — Under the hood, voter-group makeup and lean calculations used for your campaign poll were corrected and retuned (including composition fixes), so poll readouts should better match the simulation.

**Corporations**

- **Smoother CEO transitions** — When a CEO steps down, the next leadership election no longer inherits stale votes from the previous race. CEO-only corporation actions also respect when the CEO seat is vacant.

### 🎨 UI

**Campaign Operations**

- **Card or compact actions** — On the Actions page you can switch between full cards and a denser compact layout; your choice syncs to your account when logged in and falls back to this device otherwise.
- **Compact row polish** — Compact view uses subtle image treatment and alignment so busy action lists are easier to scan.
- **Poll results refresh** — The internal poll screen has been redesigned with clearer breakdowns, policy positioning context, and practical recommendations.

**Parties**

- **Leadership faces** — National and state party leadership sections now show each leader’s avatar (when they have one), with a clear empty state when a seat is vacant.

**Changelog**

- **Alpha countdown presentation** — The Iteration Alpha banner on the changelog uses a stylized “NEXT FRIDAY” reveal toward the April 1 end date instead of a ticking clock.

### 🔧 Platform

**Admin**

- **Test mode toggle** — Admins can turn test mode on or off from the dashboard to restrict open registration during closed testing (email signups can require a secret; new Discord registrations are paused while test mode is on).
- **Party appointments vs elections** — Appointing someone to national party leadership no longer wipes an in-progress party election; the election can still run to completion.

**General**

- **0.1.0** — The game version is now **0.1.0** (visible in settings and anywhere the app version is shown).

---

## v0.0.39 — 2026-02-22

### ⚙️ Mechanics

**Parties**

- **NPP recruitment for third parties** — When you create a custom party, NPPs are now automatically spawned in your selected states to give your party an immediate political presence. In the US, select 4 states plus your locked home state to spawn 10 NPPs (2 per state). In the UK, select 2 regions to spawn 2 NPPs (1 per region).
- **Ongoing NPP recruitment** — Party leadership can now recruit additional NPPs through the party Actions tab. State Chairs recruit in their state using state party resources; National Chairs can recruit in states without active state leadership using national funds.
- **Recruitment costs scale with size** — Recruiting gets more expensive as your party grows. Base cost starts at 5 actions + $100K for your first NPP in a state, scaling up to 25 actions + $1M for states with 4+ NPPs. Party-wide costs also increase as total NPP count grows.
- **Recruitment slots based on organization** — How many NPPs you can have per state depends on your state party organization level. Low org (0-24%) allows 2 slots; max org (75-100%) allows 5 slots. Build your party organization to unlock more recruitment capacity.
- **24-hour recruitment cooldown** — After recruiting an NPP, your entire party must wait 24 hours before recruiting again. Plan your recruitment strategy carefully.

### 🎨 UI

**Parties**

- **Two-step party creation** — Creating a party now has a second step where you select your starting states/regions. Each state shows an alignment indicator (good/neutral/poor fit) based on how your party's positions match the state's political lean.

### 🐛 Bug Fixes

- **Cabinet now shows party names** — Cabinet members and nominees now display their party name and color correctly instead of raw party IDs.
- **Party membership syncs properly** — Your party affiliation now updates correctly across all systems when you join, leave, or create a party.
- **Cross-country party fixes** — Fixed several issues where party operations could incorrectly affect or display data from a different country's parties.

## v0.0.39 — 2026-02-23

### ⚙️ Mechanics

**Character**

- **Relocate while holding office** — You can now relocate to a new state even while holding elected office. A warning popup will appear explaining that you'll automatically resign from your current position. CEOs will also be removed from their corporation upon relocation. Only active campaign candidacies still block relocation.

**Elections & Campaigns**

- **Personal Campaign Donation** — You can now funnel your personal cash on hand into your campaign war chest. Choose how much to convert — only 50% makes it through, and the more you convert the more infamy you gain. A modest $100K donation barely raises eyebrows (+4 infamy), but dumping $10M into your campaign will draw serious scrutiny (+55 infamy). Quick-select buttons (25%, 50%, Max) and a live preview make it easy to find your comfort zone.

---

## v0.0.38 — 2026-02-22

### ⚙️ Mechanics

**Corporations**

- **Extraction & Mining sector** — New sector type that produces raw materials: Iron Ore, Coal, Crude Oil, and Rare Earth Minerals. These feed into manufacturing, technology, energy, and defense sectors. Choose from four operating strategies like Deep Extraction or Precision Mining.
- **Logistics sector** — New sector type producing Freight & Transportation and Consulting Services. Three strategies available: Standard Logistics, Express Freight, and Supply Chain Consulting.
- **Sector operating strategies** — Every sector can now switch between 3–4 production strategies that change what commodities it produces and consumes. Switching costs 25% of daily revenue and takes 12 turns to transition with a -5% margin penalty. Choose the right strategy based on current market conditions.
- **Secondary sector focus** — From the CEO page, you can now declare a secondary corporation type. Sectors matching your secondary type get a +2.5% margin bonus (half of primary's +5%), but your sprawl penalty doubles if you exceed 15 sectors. Invest in logistics to offset the extra sprawl.
- **Switchable corporation type** — You can now change your primary or secondary corporation type from the CEO page. Switching incurs a -10% margin penalty on all sectors for 24 hours, followed by a 72-hour cooldown before you can switch again.
- **Electricity commodity rename** — "Energy & Fuel" has been renamed to "Electricity" for clarity.

**NPP Economy**

- **NPPs now earn and spend money** — Non-Player Politicians now generate campaign funds and spend action points just like players. They earn at 50% of player rates, with diminishing returns as they accumulate wealth. NPPs use their funds and action points to build donor networks, run campaigns, advertise, and donate to their party.
- **NPP AI decision making** — NPPs make spending decisions based on their situation and personality. Office holders focus on campaigning and advertising; non-office holders prioritize building their donor base. Loyal NPPs donate more to their party; ambitious NPPs invest more in their own growth.
- **NPP party contributions** — NPPs now pay party tax on their earnings, contributing to state and national party treasuries just like players do.

**Elections & Campaigns**

- **Incumbents defend their seats first** — NPP incumbents now properly enter primaries before other NPPs. Previously, a random NPP could sometimes fill a race slot before the incumbent had a chance to defend their seat.

### 🎨 UI

**NPP Profiles**

- **NPP profile pages** — NPPs now have full profile pages showing their funds, donor base level, action points, personality traits, and political stats. Find them at `/politicians/npp/[id]`.

**Corporations**

- **Strategy switch confirmation** — When switching sector strategies, a confirmation panel shows a commodity-by-commodity comparison of output and input rates, current market status (surplus/balanced/shortage), and an estimated commodity margin impact before and after the switch.

### 🔧 Platform

**Admin**

- **NPP economy controls** — Admins can enable/disable the NPP economy system and view stats from the NPPs management page.
- **NPP economy migration** — New migration in Admin > Support > Migrations to initialize NPP economy fields on existing NPPs.

### 🎨 UI

**Legislation**

- **UK Parliament bills show party info** — Bills in UK Parliament now display sponsor party name and color, matching the US Congress bills display.

### 🐛 Bug Fixes

- **Cross-country party leadership fixed** — Fixed a bug where party leadership could incorrectly be assigned across countries.
- **Cross-country party display fixed** — Fixed a bug where party information could incorrectly display data from a different country's party when parties shared the same ID number across countries.

## v0.0.37 — 2026-02-21

### ⚙️ Mechanics

**Corporations**

- **Inflation affects margins** — Corporate profit margins now respond to national inflation rates. High inflation squeezes margins; deflation provides a slight boost.
- **Debt-to-GDP margin modifier** — Corporations in countries with high national debt face margin pressure, reflecting macroeconomic instability.
- **Deficit-to-GDP margin modifier** — Running large fiscal deficits now creates headwinds for corporate profitability in that country.
- **Commodity margin tuning** — Commodity supply/demand effects on corporate margins have been softened slightly, reducing extreme profit swings from market imbalances.
- **Defaulted bond buyback** — CEOs can now retire defaulted bond units at face value from the bond detail page, gradually reducing outstanding debt without gaming the discount.
- **Distressed debt trading** — You can now buy defaulted bonds from other corporations. CEOs can't buy their own defaulted bonds to prevent self-dealing.

**Financial Markets**

- **Commodity world map** — Commodity pages now have an interactive world map showing supply or demand intensity by country. Click a country to see its stats, then drill into state/region-level breakdowns. Toggle between supply and demand views with a color-coded legend.
- **Commodity hero images** — Each commodity page now has a distinctive banner image, giving the market a more polished look.
- **Combined commodity charts** — Price history and supply/demand charts are merged into one card with a toggle, so you see the data you want without scrolling past two separate charts.
- **Commodity stats strip** — Key stats (price, supply, demand, balance) are pulled into a compact strip at the top of the commodity page for quick reference.

**Central Bank**

- **Inflation responds to conditions** — All economic drivers (GDP growth, unemployment, debt levels, commodity prices, money supply) now push inflation both up and down. Monetary policy changes take effect with a 12-turn trailing lag, making rate decisions feel more realistic.

**Elections & Campaigns**

- **Multi-seat allocation fixed** — Multi-seat elections now correctly distribute seats among the top candidates instead of awarding all seats to the winner.

### 🎨 UI

**Mobile**

- **Mobile profile layout** — Profile pages are more compact on mobile — your name and info sit beside your avatar instead of stacking below it.

**Page Redesigns**

- **Stock market tabs remember your spot** — Switching between Stocks, Bonds, and Commodities tabs now persists in the URL, so browser back and shared links work as expected.

### 🐛 Bug Fixes

- **Wealth bonus fix** — Starting wealth bonus from character creation now correctly goes to your personal cash instead of campaign funds.
- **Landing page performance** — The spinning globe animation is now much lighter on your browser, fixing unresponsive buttons on the landing page.

## v0.0.36 — 2026-02-21

### ⚙️ Mechanics

**Corporations**

- **Commodity markets matter now** — Commodity supply and demand shortages are now a real factor in corporate profits. A moderate steel shortage will compress margins for sectors that depend on it, while steel producers benefit from premium pricing. Local state-level shortages feed through too. Sectors in terrible commodity markets can now lose money, draining corporate cash reserves.
- **Corporate credit ratings expanded** — The credit rating tab now shows a full composite gauge (0–100), weighted subscore breakdown, balance sheet context, a what-if debt slider to preview how borrowing would affect your rating, and peer comparisons against other companies in your country and sector. Credit rating changes now appear in the wire feed and notify the CEO.
- **Sector specialization matters** — Sectors that match your corporation's type (e.g., a tech sector in a tech company) get a +5% margin bonus. Mismatched sectors suffer a -15% penalty. Focus your corporation or pay the cost.
- **Logistical sprawl** — Corporations with more than 15 sectors start losing efficiency: -0.5% margin for every 2 sectors over the limit.
- **Bond defaults have consequences** — Corporations that default on bonds now face a 96-hour credit penalty, making fiscal responsibility matter.
- **CEO offers can be declined** — Players offered a CEO position can now formally decline it, leaving the seat vacant for someone else.

**Financial Markets**

- **Commodity page shows demand sources** — The commodity detail page now shows where non-corporate demand comes from, including "Base Economic Demand" and "GDP-Scaled Retail Demand" as system entries in the Top Consumers list.
- **Bonds page split** — The bonds tab on the stock market page now has a Corporate/Sovereign toggle (defaults to Corporate). Sovereign bonds display the issuing country's flag as their logo.
- **Building materials demand** — Building materials now have construction demand driven by state GDP and economic growth. Real estate companies also consume building materials for development, balancing a previously oversupplied market.

**Character**

- **National influence on profiles** — National influence (NPI) is visible on character profiles, politician cards, and election candidates. The politicians list can sort by national influence correctly.

### 🎨 UI

**Page Redesigns**

- **Corporation sectors redesigned** — The sectors tab now uses responsive cards instead of a wide table, with sorting by any metric. Much easier to use on mobile.
- **Public profiles match self-view detail** — Other players' profiles now show the same political standing cards (with hover tooltips and per-turn rates), career history timeline, and finances section layout you're used to on your own profile.
- **Profile banner image** — Upload an optional wide header image in Settings; it appears on your profile and when others open your character page.
- **Settings image previews** — Profile picture and banner upload controls on Settings use smaller previews so the page stays scannable.
- **Updated central bank photos** — The Federal Reserve and Bank of England pages now feature higher-quality building photographs.

### 🔧 Platform

**Performance**

- **Major performance improvements** — Faster page loads, parallelized database queries, smarter caching, and reduced data transfer across auth, notifications, elections, campaigns, wiki, and profile routes.

**Admin**

- **Maintenance mode** — Admins can enable maintenance mode that blocks all non-admin access with a countdown timer, so game updates can happen without disrupting play.

### 🐛 Bug Fixes

- **State party offices fixed** — Vice chair and treasurer positions on state party pages are now correctly shown as elected, not appointable.
- **Bond refinancing fixed** — Refinance previews and cleanup for defaulted bonds now work correctly.
- **Party whip screen fixed** — The NPP whip tab on national party pages now correctly loads bills and leadership elections for both US and UK parties.

## v0.0.35 — 2026-02-20

### ⚙️ Mechanics

**Government**

- **National budgets and treasury** — The US and UK now have full treasury panels showing government revenue, spending categories, and fiscal health. See how healthcare, education, defence, and other programs are funded and what they cost.
- **UK public healthcare** — The UK now has an NHS-style public healthcare corporation that appears in budget and sector views, reflecting real public-sector economics.
- **Sovereign bonds** — Governments can now issue sovereign debt instruments. Bond demand is driven by national debt levels, adding a new layer to the financial system.

**Financial Markets**

- **Commodity flow details** — Sector pages now show exactly how each input commodity affects your profit margins, with weight percentages and margin impact numbers.
- **Commodity markets rebalanced** — Price caps have been loosened so commodity prices move more naturally. Commodity pages now show rolling annual price changes and explain where financial demand comes from.

**Elections & Campaigns**

- **Polling accuracy improved** — Election polls now use the same spoiler detection and archetype appeal calculations as the actual election engine. Poll results should much more closely match real outcomes.

**Parties**

- **UK party organization** — The party organization system now supports UK House of Commons constituencies, bringing parity with the US state-level org system.
- **Party country isolation** — Party elections, committee votes, NPP influence, and admin tools are all properly scoped by country. No more cross-country party collisions.

**Corporations**

- **National corporation fixes** — National corporations now display correctly on sector and corporation pages, have proper sequential IDs, and can't be attacked by players. Market share is capped at 100%.

### 🎨 UI

**Page Redesigns**

- **News page restored** — The Post button, compose modal, wire ticker, and post ticker are all back after a brief regression. Creating news posts is smoother than before.

### 🔧 Platform

**Performance**

- **Performance improvements** — Batch database queries for party org lookups, election entry, demographics seeding, and admin operations. Pages load faster, especially for UK regions.

**Admin**

- **One-click server setup** — Admins can now set up the entire game database from a single Setup page. The server also auto-seeds itself on first startup if the database is empty.
- **Seed reliability improved** — Re-seeding the database no longer causes duplicate key or immutable field errors. Budgets, demographics, and party orgs all seed cleanly.
- **Error tracking** — Game errors are now reported to Sentry across the turn processor, API routes, UI, and cron jobs for faster bug detection.

**Discord**

- **Discord bot enriched** — The corporation command now shows bonds, shareholders, and full financials. Party lookups no longer mix up US and UK parties.

### 🐛 Bug Fixes

- **Election entry fixed** — Entering and withdrawing from elections no longer fails due to seat ID resolution errors.
- **Stock market links fixed** — Corporation links on the stock market page no longer break for companies without sequential IDs.

## v0.0.34 — 2026-02-18

### ⚙️ Mechanics

**Corporations**

- **CEO voting overhauled** — CEO votes are now weighted by shares held. If you own 500 shares, your vote counts as 500. Self-voting is now allowed. CEO candidates must reside in the corporation's headquarters state.
- **CEO must reside at HQ** — To accept a CEO position, your character must live in the corporation's headquarters state. Relocating while serving as CEO will automatically remove you from the position.
- **Corporations start stronger** — New corporations now begin with 10 marketing strength instead of 0, giving them a head start on visibility.

**Financial Markets**

- **Bond purchasing** — You can now buy bonds directly from the bond detail page. Enter the number of units, see the total cost, and purchase. If you're a CEO, you'll be prompted to choose whether to buy personally or through your corporation.
- **Corporation bond holdings** — The Bonds tab on corporation pages now shows bonds your company holds in other corporations, with current market values and a total portfolio value.
- **Dividend summary** — When a corporation has dividends enabled, the Bonds tab displays a summary card showing the payout rate, per-turn and annual payouts, and per-share earnings.
- **Sector commodity links** — Commodity icons on the sector detail page are now clickable links to the commodity detail page.

**Character**

- **Relocation cooldown** — Relocating to a new state now has a 48-hour cooldown. Plan your moves carefully.

### 🎨 UI

**Page Redesigns**

- **Corporation page redesigned** — The corporation page now uses a proper tab system with icons, matching the state page design. Tabs are URL-driven — you can share links to specific tabs like `/corporation/1?tab=shares` and browser back/forward works.
- **Shareholder pie chart** — The Shares tab now shows a visual ownership distribution chart, including the public float.
- **Stock market redesigned** — The NYSE and FTSE stock exchange pages have been redesigned with a new hero image, scrolling LED-style stock ticker, and cleaner table layouts for stocks, bonds, commodities, and the wealth list.
- **Footer bar redesigned** — The bottom status bar now uses compact colored chips for actions (red), campaign funds (green), and personal cash (amber). Numbers show in K/M format for readability. Your personal cash balance is now always visible.
- **Election cards improved** — Election listings now use a consistent card design with properly resolved party names and colors.
- **News post ticker** — The news page now has a scrolling ticker showing recent player posts in a compact format.
- **News composer moved to modal** — Creating a news post is now done via a "Post" button on the hero image that opens a focused compose modal.
- **State Economy shortcut** — The navigation sidebar and state dropdown now include a direct link to the State Economy tab.

**Mobile**

- **Mobile dropdown positioning fixed** — Filter dropdowns on the Elections page now appear centered on mobile devices, even when the keyboard is open.
- **Delete account modal fixed** — The delete account confirmation dialog now appears correctly on mobile devices. Previously it was hidden behind the blur overlay.

### 📚 Content

**Countries & Regions**

- **UK region Players/NPPs lists added** — UK region Politics tabs now display Players and NPPs lists, matching the layout of US state pages.

**Wiki**

- **Wiki pages added** — New wiki guides for Corporations, Commodities, and Relocation are now available in the wiki, covering shares, bonds, dividends, CEO management, commodity markets, and relocation mechanics.

### 🐛 Bug Fixes

- **Admin NPP party selection fixed** — Admins spawning NPPs no longer see US and UK parties mixed together when they share the same ID number.
- **State NPP party names fixed** — NPP listings on state Politics tabs now show the correct party name and color instead of just the logo.
- **National Committee voting fixed** — Voting in National Committee elections no longer fails with an "Invalid candidate ID" error.
- **UK party display fixed** — UK region pages were incorrectly showing US party names (e.g., "Democratic Party" instead of "Labour Party"). Fixed across all UK region pages.
- **Plaid Cymru restored** — Plaid Cymru was missing from the Wales region party list. It's now properly included.
- **Navbar party link fixed** — The state party link in the navigation sidebar was not appearing for players in UK parties or newer US parties. Fixed.

## v0.0.33 — 2026-02-18

### ⚙️ Mechanics

**Parties**

- **Organization building improved** — Treasury investment in party organization is now more effective. Removed hidden decay that was counteracting your spending. The drift rate when not investing has also been halved, so your org decays more slowly when you stop building.
- **Create Party country restriction** — The "Create Party" button now only appears when you're viewing parties for your own country. US players can't accidentally try to create UK parties.

### 🎨 UI

- **Party URLs simplified** — Party pages now use simple numeric IDs (like `/parties/1?country=us`) instead of slug-based URLs. Bookmarks to old party URLs will need to be updated.

### 🔧 Platform

**Admin**

- **Game reset presets** — Admins can now choose from three starting condition presets when resetting the game: full historical start (default), no NPPs, or no parties at all.

## v0.0.32 — 2026-02-17

### ⚙️ Mechanics

**Corporations**

- **Share trading** — You can now buy and sell corporation shares from the Shares tab on any corporation page. Trade at market price instantly, or place limit orders that fill automatically when the price is right. Your money is held in escrow until the order fills.
- **CEO share issuance** — CEOs can issue new shares to raise capital. Issue up to 50% of outstanding shares to the public market, or self-issue at a 15% premium to inject funds directly into the company.
- **Dividends** — CEOs can set a dividend rate (0–100% of income) to distribute profits to shareholders each turn. Payouts are proportional to share ownership.
- **Shareholder register** — See who owns shares in any corporation, with ownership percentages displayed on the Shares tab.
- **Splits now cost marketing strength** — Each sector split costs marketing strength in addition to cash. The first split costs 1 MS, the second 2, then 4, 8, 16, and so on. The cost halves each turn, so you can split aggressively if you've built up MS reserves, but rapid-fire splitting gets expensive fast.
- **Marketing strength gains increased** — Marketing budgets are now ~23× more effective at building marketing strength. A $100K/day budget earns about 0.5 MS per day. The per-turn gain rate is now displayed next to your MS value on the corporation page.
- **Home location margin bonuses** — Sectors in your corporation's headquarters state get +10% profit margin. Sectors in the same country (different state) get +5%. International sectors get no bonus. The margin breakdown on corporation and sector pages now shows the home location modifier.

**Financial Markets**

- **Share price rebalanced** — Share prices now blend last trade price (20%), balance sheet value (40%), and earnings-based valuation (40%). Prices are less volatile and more reflective of actual company performance.
- **Consumer Goods commodity** — Retail is now tracked as a commodity ("Consumer Goods") on the stock exchange commodities panel and commodity detail pages. Retail sectors supply it, and demand is driven by GDP growth — when the economy grows, consumer demand rises and retail commands premium prices. When GDP shrinks, retail faces oversupply pressure.
- **Retail absorbs supply chain shocks** — Retail sectors now face only 25% of the negative penalties from commodity input shortages, reflecting their ability to substitute or absorb supply chain disruptions more easily than heavy industry.
- **Commodity market rebalanced** — Commodity shortage and surplus effects on corporate profit margins now use a logarithmic curve instead of the old quadratic/linear system. This prevents extreme runaway effects while keeping shortages meaningful. A commodity at 2× demand gives roughly +5.5% margin bonus to sellers and a matching penalty to buyers. The curve is self-balancing: the 10th unit of shortage pressure matters less than the 1st.

**Legislation**

- **UK legislation types no longer appear in US bill proposals** — When proposing bills in US Congress or state legislatures, you'll now only see legislation types for the US. UK-specific legislation (like NHS bills or Scottish Devolution) no longer appears in the dropdown.

**Parties**

- **Organization building simplified** — The org building slider now shows org growth directly instead of momentum. Spend $100k/turn to grow your organization by +1.0/turn at equilibrium. The "Momentum" display in the party header now shows your actual org growth rate.
- **Org building budget increased** — You can now allocate up to 75% of party revenue to organization building (up from 25%).

### 🎨 UI

**Page Redesigns**

- **Commodity shortage badges** — When viewing a sector's details, input commodities now show shortage severity badges (Mild, Moderate, Severe, Critical) so you can quickly see which supply chains are under pressure.
- **Sector commodity modifier improved** — The profit margin breakdown on sector detail pages now shows the combined effect of both input costs and output demand under "Commodity markets" with green/red coloring based on whether it helps or hurts your margins.
- **Stock market ticker by 24h change** — The scrolling ticker on the stock market page now shows corps and commodities ordered by 24-hour price change: gainers first, then losers. Each item displays current price and 24h % change.
- **Commodity prices color-coded correctly** — On commodity detail pages and the stock exchange, price increases now show in red (indicating shortage) and decreases in green (indicating healthy supply). Previously the colors were reversed.

### 🐛 Bug Fixes

- **Profit margin display fixed** — The corporation page now correctly shows all profit margin modifiers including commodity market effects. Previously, commodity shortages and surpluses were affecting your margins behind the scenes but weren't visible in the margin breakdown.
- **Party momentum calculations fixed** — Fixed an issue where momentum was being processed twice per turn, causing org growth to be unpredictable. The displayed equilibrium values now match actual gameplay.
- **Presidential election results fixed** — Completed presidential elections were showing "Unknown" for all candidates instead of their actual names and parties. Results now display correctly.
- **President/VP office transitions fixed** — When a Senator or other office holder wins the presidency, they are now properly removed from their prior office instead of appearing to hold both positions.
- **State party tax rate saving fixed** — Saving the tax rate from the Treasury tab on state party pages now works correctly. Previously, the save could fail due to a missing variable.

## v0.0.31 — 2026-02-16

### ⚙️ Mechanics

**Corporations**

- **Corporations** — You can now found a corporation for $1M, choose from 13 industry sectors (Technology, Energy, Healthcare, Finance, and more), and expand into state markets. Manage growth rates, marketing budgets, and CEO salary. Your corporation generates revenue each turn based on market share.
- **Stock Exchange** — Browse all listed corporations on the NYSE (US) or FTSE (UK) stock exchange pages. See market caps, revenue, income, and who runs each company.
- **Corporate GDP growth** — State GDP growth is now driven by corporate activity. States with thriving corporations see higher GDP growth; states with no corporate presence show N/A.
- **Unemployment affects corporations** — State unemployment rates now affect corporate profit margins. Low unemployment (tight labor market) squeezes margins, while high unemployment means cheaper labor and higher margins.

**Parties**

- **Party organization rework** — Party organization caps are now dynamic and based on election performance. Winning elections in a state increases your party's organization potential. Parties with no players and no elected officials can no longer build organization.
- **Org building cost increased** — Building party organization now costs $100,000 per momentum point instead of $10,000.
- **Abandoned party org now decays** — Parties with no members in a state now have their organization decay toward zero over time.

**Legislation**

- **Legislation updates apply faster** — After game admins update legislation types, changes take effect immediately instead of being delayed by caching.

### 🎨 UI

**Maps & Globe**

- **Corporate intensity map** — The world map now has a corporate intensity view showing where corporations are concentrated.

**Page Redesigns**

- **National Budget link restored** — The "National Budget" link is back in the "The Nation" dropdown menu.
- **UK National Budget page** — UK players can now access the National Budget page from the navbar with a preview of planned features.

### 🔧 Platform

**Discord**

- **Race tracking for Discord bots** — Elections now have stable identifiers (like `US-senate-PA-1`) that persist across cycles.

### 🐛 Bug Fixes

- **Bill proposals fixed** — Bills now correctly track which policy option was selected when proposed. Previously, the wrong policy option could be stored and displayed.
- **Presidential election link fixed** — The "Presidential Election" link in the Nation dropdown now works correctly.
- **Running mate selection fixed** — Presidential candidates can now select running mates properly, with a new search bar and party filter.
- **Party org cap display fixed** — State party pages now show the correct dynamic organization cap.
- **Cross-country party org fixed** — US parties no longer appear in UK regions and vice versa.
- **Character profile links fixed** — Fixed broken profile links across the entire game.
- **Multiple seat bug fixed** — Players who won a new Senate seat while holding a different Senate seat (e.g., Class 1 to Class 2) no longer appear in both seats simultaneously. The old seat is now properly vacated when winning a new one.

## v0.0.30 — 2026-02-13

### 🎨 UI

- **More stat tooltips** - Hovering over Influence, National Influence, Donor Network, and all items in your Financial Statement now shows a tooltip explaining what each metric means and how it works.

### 🐛 Bug Fixes

- **Discord re-linking fixed** - If your Discord account became unlinked and you couldn't re-link it, an admin can now reset the connection so you can link again.
- **National party whips work** - National Party Chairs and Vice Chairs can now properly issue whip directives on federal bills. Previously this showed "State party organization not found".
- **National Vice Chair NPP influence** - National Party Vice Chairs can now use the NPP Influence panel on the National Party page. Previously only the Chair could access it.
- **State party elections display fixed** - State party leadership elections no longer show "NaN turns remaining". The countdown now displays correctly.
- **Tax bills can be proposed** - Fixed an issue where proposing bills in the Tax category would fail with a validation error.

## v0.0.29 — 2026-02-12

### ⚙️ Mechanics

**Legislation**

- **Vote on state bills** - State senators can now vote Aye, Nay, or Abstain on bills directly from the state legislature page. Your current vote is highlighted so you can see what you've already voted on.

**Government**

- **PM succession works for all countries** - When a Prime Minister loses a no-confidence vote, the system now automatically triggers a confidence vote to select a successor. This works for all parliamentary countries, not just the UK.

**Character**

- **New player onboarding** - First-time players see a checklist on their profile: join a party, set your background, cast your first vote, and check out the wiki. A progress bar tracks your completion, and you can dismiss it whenever you're ready.

### 🎨 UI

- **Stat tooltips** - Hovering over Actions, Favorability, and Infamy on your profile now shows a tooltip explaining what each stat does and how to improve it.

### 🔧 Platform

**Notifications**

- **More notifications coming** - Added support for turn advance, resource income, and election opened notifications. These events were previously silent.
- **Error tracking** - The game now uses Sentry for real-time error monitoring. When something breaks, we know about it immediately instead of relying on player reports.

**Security**

- **Security scanning** - Added automated security scanning (CodeQL) and dependency auditing to catch vulnerabilities early.
- **Visual regression testing** - Key pages now capture screenshots during testing to catch unintended visual changes.

### 🐛 Bug Fixes

- **Dashboard no longer 404s** - New players who get redirected to `/dashboard` after registering now land on their profile instead of a broken page.

## v0.0.28 — 2026-02-10

### ⚙️ Mechanics

**Elections & Campaigns**

- **Incumbents defend their seats** - NPP politicians who already hold an office now get priority to re-enter that same seat's primary on the next election cycle. An NPP Senator from Texas will automatically re-run for Texas Senate before other Texas NPPs from the same party.

**Parties**

- **Party whip system** - Party Chairs and Vice Chairs can now issue whip directives to NPP legislators, telling them how to vote on bills and leadership elections. Switch between Senate, House, and State Legislature tabs to see available targets. After issuing a whip, you'll see how many NPPs fell in line and how many ignored your directive. Maximum 2 whip attempts per bill.
- **Party Actions reorganized** - The Actions tab on State and National Party pages now has sub-tabs for NPP Influence (existing feature), Whip (new), and NPP Recruitment (coming soon). National party leadership can influence NPPs in states without active player members.

### 🎨 UI

**Maps & Globe**

- **World map filters** - The world map now has interactive filters for population, GDP, GDP per capita, and political party colors. Use the new zoom buttons for easier navigation.
- **Globe works on mobile** - The 3D globe and flat world map now respond to touch gestures. Drag to rotate or pan, pinch to zoom, and tap countries to navigate.

**Mobile**

- **Mobile layout fixes** - Fixed horizontal scrolling issues across 15+ pages. Content now stays within the screen on all devices.

### 🔧 Platform

**Discord**

- **Log in with Discord** - You can now log in or create an account using your Discord account. Click "Continue with Discord" on the login or register page. If you've already linked Discord in settings, you'll be signed in automatically. New players get an account created from their Discord profile.
- **Public leaderboard API** - A public leaderboard endpoint is now available for Discord bots and external tools. Query top players by influence, favorability, or funds with optional country and player-only filters.

**Admin**

- **Desktop app focused mode** - The desktop app can now hide the site's navbar when running in focused display mode, using its own navigation controls instead.

### 🐛 Bug Fixes

- **NPP politicians stay in their region** - Fixed a bug where NPP politicians could occasionally enter primary elections in the wrong country or region. US NPPs now only run in US elections, and UK NPPs only run for seats in their home region.

## v0.0.27 — 2026-02-10

### ⚙️ Mechanics

**Elections & Campaigns**

- **Voter archetypes track your voting record** - The 12 voter archetypes (Young Renters, Evangelicals, Rural Traditionalists, Union Workers, Soccer Moms, College Liberals, Small Business Owners, Public Sector Workers, Retirees, Libertarians, New Immigrants, Secular Professionals) now remember how you vote on legislation. Vote for a bill that helps unions, and union workers will like you more. Vote against environmental protection, and college liberals will remember.
- **Approval fades over time** - Your archetype approval ratings decay 0.5% per turn toward neutral. Recent votes matter most, but old positions gradually fade. You can't coast on one good vote forever.
- **Polls show archetype approval** - When you commission a poll, you now see your approval rating with each voter archetype alongside their population share and estimated votes.
- **Different groups care about different issues** - Voter archetypes now react differently depending on the policy area. Evangelicals strongly support school choice but barely care about defense spending. Public sector workers fiercely oppose education privatization.
- **Policy changes matter, not absolute positions** - Archetype approval changes now depend on how far you're shifting policy, not where it ends up. Double arrows show major impacts, single arrows show minor ones.
- **Approvals apply when bills become law** - Your archetype approval only changes when a bill is actually enacted. Voting for a bill that fails has no lasting impact on your standing with voter groups.

**Legislation**

- **Bill proposals show accurate previews** - The approval indicators when proposing a bill now show what would happen if THIS bill passes, based on the current policy and the change you're proposing.
- **Voting shifts your policy positions** - When you vote on a bill, your personal policy position shifts slightly toward the stance you voted for. Vote consistently in one direction and your political identity will drift to match.

**Government**

- **Cabinets resign on government transitions** - When a new President is inaugurated, a new UK Prime Minister is appointed, or a PM loses a confidence vote, the entire cabinet is automatically cleared. The incoming leader starts fresh with an empty cabinet to fill.

### 🎨 UI

**Maps & Globe**

- **Interactive world globe** - The world map now features a true 3D globe view. Click the toggle to watch the flat map morph into a spinning globe with smooth geographic projection interpolation. Drag to rotate or pan, scroll to zoom, and the globe gently auto-rotates when idle.
- **Ukraine shown on the map** - Ukraine is now highlighted in amber on both the world map and globe, reflecting its status as a country under active conflict.
- **Drag the flat map** - The flat world map can now be clicked and dragged to pan, just like the globe.

### 🔧 Platform

- **Link previews** - Sharing game links on Discord, Twitter, or other platforms now shows rich embed previews with page titles, descriptions, and preview images.

### 🐛 Bug Fixes

- **Profile picture uploads fixed** - Changing your profile picture now correctly shows the new image immediately instead of showing the old cached version.
- **NPP candidates now enter primaries** - Non-player politicians were failing to enter primary elections due to a timing bug. They now correctly file to run in active primaries across all race types.
- **All parties can field NPP candidates** - Third-party NPPs were being blocked from entering primaries due to a party organization requirement. NPPs from all parties can now enter races regardless of their party's local organization level.

## v0.0.26 — 2026-02-08

### ⚙️ Mechanics

**Elections & Campaigns**

- **UK House of Commons elections** - UK regions now hold parliamentary elections every 10 game-years. Commons elections use multi-seat proportional allocation, so parties win seats based on their vote share. After elections complete, the largest party forms a government and nominates a Prime Minister, who must win a confidence vote from all 650 MPs.
- **Senate vacancy appointments** - When a US Senator resigns or is removed from office, the state's Governor can appoint a replacement who serves until the next regular Class election.

**Government**

- **UK Prime Minister confidence votes** - Ruling party MPs can propose a motion of no confidence against the Prime Minister. Only members of the ruling party vote on these motions. If a majority votes yes, the PM is removed from office. 48-turn cooldown between votes.

**Character**

- **News post titles** - You can now add an optional title (up to 100 characters) when posting to the news feed.
- **News post cost** - Posting to the news feed now costs 5 actions and $75,000 CF.
- **News post cooldown** - You can post to the news feed once every 30 minutes per character.
- **Referral system** - Share your User ID as a referral code with friends. Referred players start with a 10% bonus to all core stats and 30 extra starting actions.

### 📚 Content

**Wiki**

- **Wiki editor** - Authenticated players can now create and edit wiki pages using a full toolbar with formatting options. Drafts auto-save every 30 seconds. Templates are available for common page types.

### 🔧 Platform

**Discord**

- **Discord integration** - Game events (election results, bill signings, government changes) and news feed posts now broadcast to a configurable Discord server.

### 🐛 Bug Fixes

- UK Parliament seat counts now correctly reflect multi-seat NPP blocs.
- Party names now display properly in the news feed (no more raw slugs like "uk_labour").

## v0.0.25 — 2026-02-07

### ⚙️ Mechanics

**Legislation**

- **UK Parliament legislation** - 19 new UK-specific bill types are now available for UK Parliament members to propose: NHS funding, social care reform, Brexit trade policy, net zero climate targets, North Sea energy, housing & planning, leasehold reform, education standards, university tuition fees, fiscal policy, corporation tax, Universal Credit, Trident & defence, policing & knife crime, BBC licence fee, Scottish devolution, HS2 & rail, and local government/levelling up.
- **Policy effects are now option-specific** - Each policy option now drives its primary metric in a specific direction per turn - left options improve social metrics, right options move them the other way.

**Government**

- **More approval conditions** - Government approval now reflects 58 named conditions (up from 32). Labels describe what's actually happening rather than abstract consequences. No single factor dominates the score.

### 🎨 UI

- **Approval over time** - The National Metrics page now shows a line chart of government approval across the last 20 turns.

### 🔧 Platform

**Security**

- **Security improvements** - Several backend security issues were identified and fixed.

### 🐛 Bug Fixes

- **National statistics corrected** - Regional and national metric figures now correctly reflect population-weighted averages within each country. Previously US and UK figures were mixed together.

## v0.0.24 — 2026-02-06

### ⚙️ Mechanics

**Legislation**

- **Committee chairs matter** - The Speaker of the House and Senate Majority Leader can now appoint committee chairs from the Committees tab. Committee chairs can delay bills in their policy area by 24 hours, giving them real power to shape the legislative agenda.

**Character**

- **Career history** - Your profile now shows a chronological timeline of elections won, elections lost, appointments, and removals.

### 🔧 Platform

**Notifications**

- **Live updates** - A banner appears when a new turn is processed, so you always know when fresh results are in.
- **Automated news** - Election results and bill signings/vetoes now automatically generate news posts on the National News page.

### 🐛 Bug Fixes

- Federal vote weighting now correctly counts multi-seat members, veto override votes work properly, and voting deadlines are enforced.

## v0.0.23 — 2026-02-05

### ⚙️ Mechanics

**Character**

- **Political Influence now has a flavor badge** - Your PI stat on the profile page now shows a descriptive label (Newcomer, Local Presence, Contender, Power Player, Regional Boss, Iron Grip) just like every other stat.
- **Rankings are NPI-only** - The #1 rank badge now only appears on your National Political Influence - it's the one stat worth competing over.
- **Country-specific NPI rankings** - The NPI bar and #1 reference now compare you only against players in your own country.

## v0.0.22 — 2026-02-05

### 🎨 UI

**Themes & Styling**

- **All 6 themes now render correctly** - fixed ~50 color values across 54 files that were hardcoded for dark mode only. Light, Pastel, USA, OLED, and Dark Pastel themes now display properly everywhere.
- **Election badges and warnings themed** - phase badges and warning banners now adapt to your theme.
- **Character profile pages themed** - favorability meters and all text/borders adapt to your chosen theme.
- **Election charts themed** - vote trend graphs, polling bars, and map fill colors respect your theme.
- **Consistent page spacing** - hero pages and content pages now use standardized vertical padding.
- **Buttons are consistent** - all button sizes unified.

**Page Redesigns**

- **Loading screens improved** - Actions, Parties, Politicians, and Congress pages now show shaped skeleton placeholders instead of a blank "Loading" message.
- **Actions page fonts cleaned up** - removed one-off font imports; uses the same design system fonts as the rest of the game.

**Mobile**

- **Stats strips no longer break on small screens** - the stat bars below hero headers now scroll horizontally instead of wrapping with broken dividers.

### 🔧 Platform

**Performance**

- **Politicians page loads faster** - server-side filtering replaces loading all data and filtering in the browser.
- **Election maps load on demand** - heavy map components now lazy-load only when needed, reducing initial page load time.
- **Accessibility improvements** - improved text contrast, keyboard navigation for dropdowns/modals, proper form labels, screen reader announcements, and corrected heading hierarchy.
- **SEO improvements** - search engines can now discover and index public pages; social media previews show proper titles and descriptions.

## v0.0.21 — 2026-02-04

### ⚙️ Mechanics

**Elections & Campaigns**

- **Leadership elections now automatic** - Speaker, House Leaders, and Senate Leaders are elected automatically in a 12-hour window right after every US House or Senate election concludes.

**Legislation**

- **Propose a bill** - seated MPs and admins can now propose Commons legislation directly from the Parliament page.

### 🎨 UI

**Page Redesigns**

- **Primary results redesigned** - Each party's primary section now uses an AP/NYT-style bar chart: candidate names with proportional bars showing projected vote share.
- **House of Commons page is live** - party composition with seat counts, a full MP list, bills tracking, and PM/Opposition Leader display.

### 🔧 Platform

**Performance**

- Campaign turn processing is faster - candidate lookups during turn resolution now use bulk queries instead of per-campaign database calls.

## v0.0.20 — 2026-02-03

### 🎨 UI

- Elections page redesigned with stats tab and hero image
- Elections page now defaults to your home country
- Navigation consolidated - Executive and Legislature merged into "The Nation" dropdown
- Version and commit info now shown in the Settings dropdown

### 📚 Content

**Countries & Regions**

- UK elections, Parliament views, and region pages now fully functional
- UK party organizations now reflect realistic 2020 regional polling data
- Canada and Germany added to the world map with seed data
- Politicians and Parties pages now scoped by country

**Wiki**

- Added roadmap page to the wiki - track what's planned and in progress

## v0.0.19 — 2026-02-03

### 📚 Content

**Countries & Regions**

- Multi-country expansion - Canada and Germany added as new countries
- World page now shows all 4 countries
- UK regions display MPs with party colors
- UK elections seeding and snap election support
- Country-scoped navigation across all major pages

## v0.0.18 — 2026-02-24

### ⚙️ Mechanics

**Elections & Campaigns**

- Presidential elections with Electoral College, primaries, and general election flow
- 12 voter archetypes replacing previous demographic categories

### 🎨 UI

**Maps & Globe**

- Governor map mode - states shaded by governor's party on the map screen

**Themes & Styling**

- Theme system - Light, Default, OLED Black, USA, Pastel, and Dark Pastel themes
- LARP date display on status bar (Week X, YYYY)

### 📚 Content

**Wiki**

- In-app wiki system with 11 design docs and special pages

## v0.0.17 — 2026-02-21

### 🎨 UI

- Skeleton loading states, toast notifications, and empty state components
- Color token system and design improvements across all pages

### 🔧 Platform

**Security**

- Rate limiting on Congress, elections, and feedback endpoints

## v0.0.16 — 2026-02-22

### 🎨 UI

- Bug report and suggestion modal - submit feedback directly from the game
- Error boundaries and loading states on all major pages
- Accessibility improvements - skip links, ARIA labels, keyboard navigation

## v0.0.15 — 2026-02-21

### 🔧 Platform

**Performance**

- Major component refactors for better performance and maintainability
- Congress, Elections, and State pages split into focused sub-components

## v0.0.14 — 2026-02-21

### ⚙️ Mechanics

**Character**

- Party action generation system (5 actions/hour, cap 100)

**Government**

- The White House page showing President, VP, and Cabinet positions

### 🎨 UI

- NPP profile pictures from real politician portraits
- State party member lists redesigned with avatars and NPP badges
- Political lean restored on state and map pages
- Alpha warning banner on landing page

### 🔧 Platform

**Discord**

- Discord integration - link your Discord tag on your profile

## v0.0.13 — 2026-02-21

### ⚙️ Mechanics

**Legislation**

- Policies now scored on both economic and social axes

**Elections & Campaigns**

- Governor elections bootstrap - every state gets an initial governor race
- Party strength now affects election vote allocation based on state approval

## v0.0.12 — 2026-02-21

### ⚙️ Mechanics

**Legislation**

- Congress leadership elections - Speaker, House and Senate leadership with 12-hour voting
- Senate leadership - President Pro Tempore, Majority Leader, Minority Leader
- Leadership candidacy limits - one active race at a time

### 🎨 UI

- Bill detail page with parliament chart and vote tally by chamber
- Leader badges shown on Congress composition tab

## v0.0.11 — 2026-02-20

### ⚙️ Mechanics

**Legislation**

- Full bill lifecycle - bills move through both chambers, enrollment, and presidential action
- NPP auto-voting on bills based on ideology

**Parties**

- Full party leadership elections - Chair, Vice Chair, Treasurer for all state parties
- Speaker of the House redesigned with multi-candidacy and majority wins

### 🎨 UI

**Page Redesigns**

- Bill detail page with timeline, vote bars, and presidential action panel
- Actions page redesigned as "Campaign HQ" with hero cards and category filters
- Profile page redesigned with hero card, political standing, and policy compass

**Maps & Globe**

- USA Map with real geographic state shapes

### 🔧 Platform

**Admin**

- Player bios on profile pages
- Admin tab on state pages for manual seat assignments

## v0.0.10 — 2026-02-19

### ⚙️ Mechanics

- State metrics system - 9 categories across all 50 states
- National overview page with population-weighted averages and state rankings

## v0.0.9 — 2026-02-19

### ⚙️ Mechanics

**Elections & Campaigns**

- Ideology demographic category with 7 ideological voter groups
- Poll action - see your demographic appeal breakdown across voter groups
- State Senate and Governor election types added

### 🎨 UI

- Profile pictures and avatars across all pages
- Elections page with USA map view and live polling bars

## v0.0.8 — 2026-02-19

### ⚙️ Mechanics

**Elections & Campaigns**

- NPP influence floor - NPPs maintain minimum 10% political influence
- State Senate and Governor elections with full NPP support

### 🎨 UI

- Turn timer moved from navbar to status bar

## v0.0.7 — 2026-02-16

### ⚙️ Mechanics

**Character**

- State adjacency system - geographic cost modifiers for actions
- Political influence decay over time
- Attack failure mechanic based on infamy

### 🎨 UI

- Global navbar and status bar with actions/funds display

## v0.0.6 — 2026-02-15

### ⚙️ Mechanics

**Elections & Campaigns**

- NPP (Non-Player Politician) system - AI politicians that hold office and run in elections
- NPP influence actions - endorse, oppose, support leadership
- Party-level NPP influence for state and national chairs
- Office holder fund bonuses (House through President)
- Donor base passive income based on state population

## v0.0.5 — 2026-02-14

### ⚙️ Mechanics

**Parties**

- Campaign fund generation with hourly passive income
- Party treasury management - tax rates, fund transfers, send to members
- State party organization system with org strength and momentum
- State party pages and leadership elections

## v0.0.4 — 2025-02-08

### ⚙️ Mechanics

**Parties**

- Party detail pages with join/leave functionality

**Elections & Campaigns**

- State demographics system - 5 categories, 17 groups
- Game reset party handling

## v0.0.3 — 2025-02-04

### ⚙️ Mechanics

**Elections & Campaigns**

- Elections system - Senate and House races with timers

### 🎨 UI

- Elections page and state elections components
- Politicians page and settings page

### 🔧 Platform

**Admin**

- Admin panel with user management, IP tracking, and ban/delete

## v0.0.2 — 2025-02-03

### ⚙️ Mechanics

- Simplified policy system - Economic and Social on -5 to +5 scale

### 🎨 UI

- Public character profiles

### 🔧 Platform

**Admin**

- Tabbed admin panel with officials manager
- Senate (100) and House (435) seat initialization

## v0.0.1 — 2025-02-02

- Initial launch - authentication, character creation, turn-based actions, dashboard
