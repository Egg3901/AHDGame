# Government contract bidding

Implementation tracker: [#4109](https://github.com/Egg3901/AHDGame/issues/4109).

## Country scope and contract types

Each registered country has one board at `/country/[code]/government-contracts`.
The page, commands and components are shared across countries. Every lookup and
mutation matches the country in the URL as well as the tender id. There is no
global cross-country supplier or currency exception.

Defence procurement buys a fixed number of equipment lots of a specified
component and required grade. The government publishes its maximum local-currency
price per lot; corporations quote their price and nominate a certified domestic
plant. Current price bands, currency checks, quarterly allocations, private
supplier concentration limits and self-dealing costs still apply. The required
grade cannot be silently reduced to match an incapable bidder.

Extraction tenders grant a fixed state/resource capacity share, contract term
and royalty rate. Corporations bid the signing fee in anchor units. Fixed
non-price terms make bids comparable. Signing fees use the existing settlement
journal in both Treasury modes and activate capacity only after completion.
The government's recorded native currency is authoritative. Forms accept local
currency equivalents and convert back to the same canonical anchor value.
Publishers use government currency; bidders use the selected corporation's liquid
currency. Public comparisons use government currency. These are current-rate
estimates, including historical bids: the local debit can change before award.
Missing conversion disables publication/bids while retaining withdrawal.

Capacity percentages apply to total state capacity of the named resource, not
current mining output. The board and publishing form show the current nominal
allocation in daily commodity units, the same basis as extraction rationing.
This is a ceiling, not a government purchase or guaranteed production. Operating
constraints and deposit depletion can lower output. Recurring royalties use
capacity share times resource price, even when production or sales are lower.
Existing royalty
and default mechanisms apply after award.

## Lifecycle

1. Publishing persists a recoverable tender before reserving resources.
   Defence holds maximum value in the appropriation and quarterly allocation;
   extraction counts its share against the 75% cap once, irrespective of bids.
2. An open tender accepts one current bid per corporation. The CEO may replace
   or withdraw it before the closing turn. Bid revision checks reject stale
   submissions. A submitted bid authorizes activation on award.
3. At the closing turn, bidding ends. Only the bidder's own values are visible
   beforehand, including its withdrawn revision. Governments cannot inspect
   sealed rival bids early. After closing, non-withdrawn bids become public.
4. An authorized official selects a bid with a public reason before the award
   deadline. There is no automatic winner: defence comparisons sort cheapest
   first, extraction comparisons sort highest fee first, with deterministic
   tie ordering. The government may choose another qualifying bid.
5. The winning corporation, terms and contract id freeze during award recovery.
   The winner is revalidated before claiming the award. Budget conversion,
   signing payments and factory allocation must finish before the tender is
   marked awarded. Retries use the same contract and financial identity.
6. Unawarded tenders may be canceled with a public reason. At the award deadline,
   open or abandoned publishing tenders expire into Canceled. Interrupted
   awards remain in Bidding Closed for recovery, without losing committed money.

New tenders allow 6 to 48 bidding turns (default 24), followed by a separate
24-turn award window. Existing tenders retain their stored deadlines. Defence
tenders may cross quarter boundaries; their appropriation hold and quota remain
in the original publication window until award, cancellation or expiry. An open
tender therefore holds resources for at most 72 turns. No money is charged
merely for bidding. No bid deposit, automatic late-bid extension,
foreign arms purchase, performance guarantee or new delivery penalty is added.

Existing active contracts retain their signed price, delivery, royalty,
termination and grandfathered economics. New player-directed offers are retired.
The cutover migration withdraws unanswered direct offers and releases their
reservations using per-offer markers; it does not reprice signed contracts.
Administrative setup grants remain an admin-only correction tool.

## Authorities and office layout

| Surface                | Contract responsibility                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defence Cabinet Office | Government Contracts tab defaults to defence. Publish requirements, compare closed bids, award or cancel tenders. Arsenal retains existing orders, stock and termination controls. |
| Finance Cabinet Office | Tab defaults to extraction. Publish concessions and award signing-fee bids when licensing law permits national issuance. Treasury and monetary controls remain separate.           |
| Other Cabinet Offices  | Read the shared country board; the office gains no new contracting authority. A player who separately holds a qualifying role is still checked against that role by the API.       |
| National executive     | May publish and award extraction tenders under national or concurrent licensing, through the country board.                                                                        |
| Regional executive     | May publish and award concessions for its own region under regional or concurrent licensing, including existing permitted office proxies.                                          |
| Corporation            | Existing Contracts and Defence tabs retain obligations and link to the country board for bidding.                                                                                  |

Authority follows the institution, not the original author's identity.
Successors may manage outstanding tenders. Acting ministers use the current
shared cabinet authority policy. Authority, licensing laws and procurement
pauses are checked again at mutation time.

State-owned and true NPP defence suppliers submit an initial suggested-price bid
through the tender pipeline. Player corporations with NPP caretaker CEOs are not
automatically committed.

## Discovery

Publishing sends one idempotent inbox alert per eligible player CEO, grouping
multiple matching corporations. Eligibility uses the existing industry,
operations, domestic supplier, grade, price band and supplier concentration
rules. Reads are projected and batched; notification delivery is a non-fatal
side effect after publication. Inbox preferences can mute the new notification
type. No hourly scanning is added.

CEO corporation overviews include a compact link to active tenders. An inbox
link carries the tender id so the shared board opens its details even if the
tender is not on the selected list page. Bidding and award eligibility are still
checked again when players act.

## Board and UI

The four tabs are **Active Bidding**, **Bidding Closed**, **Awarded**, **Canceled**.
Each uses server-side pagination with exactly 10 results per page and a type
filter: All types, Defence Procurement, Resource Extraction. Changing tabs or
type resets the page to 1. Country, tab, type and page remain in the URL.

Lists show public requirements and deadlines. Expanding a tender loads its terms
and viewer-appropriate bids. Corporate bid forms use owned corporations and
plants, not raw ids. Government controls require a public reason. Errors are
shown as errors, not as empty contract boards. Chrome uses the English catalog
with the application's established translation fallback.

## Storage and recovery

`governmentTenders` contains one current bid per corporation on the tender
document, so bid revisions, closing and winner selection share an atomic
document. Accepted bid revisions and withdrawals are appended atomically to the tender history.
History is sealed until closing, with the same owner-only exception as current bids.
The tender and awarded contract retain public award provenance.

Defence reservation markers live on the appropriation and quarterly allocation.
They transition from held to converted or released using guarded updates.
A stable plant owner coordinates awards and CEO factory assignments. Interrupted
financial work retains its plant lock for the same tender to resume. A short
award processing lease limits concurrent requests; stable contract ids and
financial markers provide replay protection independently of that lease.

Expiration uses projected reads and bulk releases, without queries per tender.
The collection belongs to world reset; bootstrap and the existing-world migration
both create its indexes. There is no new GameState field or new dependency.

## Qualification

Required evidence includes rule/deadline/visibility tests, server pagination and
country isolation, API authority/body validation, standalone Mongo reservation
races and replay, cutover migration replay, award/payment recovery, production
line contention, UI actions, architecture contracts, verify, build and Semgrep.
Existing extraction ledger and defence delivery tests remain relevant.
Turn measurements must report bytes and commands; local wall time alone is not
qualification of the new expiration phase.

## Viewer capability filter and balance comparison

The optional `supplier=mine` query matches any currently managed corporation;
`supplier=<corporation ObjectId>` selects one of those corporations. Ownership is
resolved from the signed-in user on every request, never trusted from the URL.
Candidate terms are projected without bids, evaluated against batched corporation,
sector, price, budget, allocation and existing-order inputs, then applied before
counting and ten-row pagination. The public board remains available without login.

Defence matches require existing bid eligibility plus positive current projected
output and free factory slots, including legacy order allocations. Procurement
pauses/restrictions and the original publication-window supplier quota apply.
There is no promised delivery deadline, cash-affordability check or award guarantee.
Extraction matches use the existing corporation-type and state-operation rules,
because a concession grants extraction rights rather than ordering deliveries.
Closed and historical tabs compare with the viewer's capabilities today.

`scripts/sim/governmentContractCapacityComparison.ts` compares current capacity
shares with fixed recent-output baselines using synthetic utilization and shock
scenarios. It changes no production rules. At 10% utilization, 10% of capacity
equals all current state output, while 10% of recent output equals one tenth.
An idle state gets zero under an output-only baseline. Royalty bases, startup
fallbacks, averaging windows and resistance to deliberate output suppression
need design and calibrated world evidence before changing new contracts.
