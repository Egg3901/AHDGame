# PostHog Phase 2 event contract

This contract expands the Phase 1 mutation and outcome instrumentation into party,
corporation, market, battle, diplomacy and crisis depth. All events carry
`iteration_id`, `turn_number` and, for a single playable nation, `nation_id`.
World outcomes use `system:turn-processor` with person profiles disabled. Player
mutation events continue through the existing consent gate.

## Committed world outcomes

`captureWorldDepthPosthog` reads existing persisted results after a turn commits.
It does not calculate or change game outcomes. Every query has an explicit
projection. There is one query per source collection and one combined corporation
nation lookup, regardless of the number of rows. Display names, descriptions,
notes, trade parties, battle verdict text and crisis decision text are not read.

| Event                               | Properties beyond the shared envelope                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `party_snapshot`                    | party_id, organization, player_members, npc_members, total_members                                                                                                                              |
| `party_membership_changed`          | from_party_id, to_party_id, transition_type (join/leave/purge/create_party), selection_method (self/chair/system/unknown)                                                                       |
| `corporation_snapshot`              | corporation_id, currency_code, share_price, market_cap, liquid_capital, revenue, operating_costs, income, dividend_paid, corporate_tax_paid                                                     |
| `corporation_structure_changed`     | corporation_id, transition_type (issuance/takeover_buyout/stock_split/reverse_split), share_count, total_anchor                                                                                 |
| `corporation_vote_resolved`         | corporation_id, vote_id, vote_type, outcome; yes_share_pct/no_share_pct for votes, failure_code=voting_structure_changed for structural cancellation                                            |
| `market_snapshot`                   | global_market_cap, global_market_index, us_market_cap, uk_market_cap, listing_universe (public_only/legacy)                                                                                     |
| `share_trade_settled`               | corporation_id, transition_type (market_buy/market_sell/limit_fill/peer_fill/listing_fill), share_count, total_anchor                                                                           |
| `currency_trade_settled`            | from_currency, to_currency, execution_source, trade_count, total_amount, mean_spread                                                                                                            |
| `battle_resolved`                   | battle_id, outcome (attacker_won/defender_won/unopposed_advance/no_contact/unknown), margin, attacker_casualties, defender_casualties, control_before, control_after, defender_nation_id        |
| `crisis_started`, `crisis_resolved` | crisis_id, scope, origin (manual/automatic/disaster/condition/random), duration_turns                                                                                                           |
| `diplomacy_resolved`                | proposal_id, organization_id, action_type (membership/leadership_election or persisted legislation enum), outcome (membership terminal status, leadership terminal status, enacted or rejected) |
| `diplomacy_status_changed`          | organization_id, action_type, from_status, to_status, transition_type (withdrawal/expiry); proposal_id for expiring resolutions                                                                 |

Currency trades are aggregated by currency pair and execution source, so different
currencies are never summed together. The event describes the preceding completed
action turn; this includes fills and automatic income conversions. Share trades
use individual persisted movement records, including automatic limit fills.
Correction/admin share rows and maintenance/admin party membership rows are omitted.

Party membership, share movements, crisis lifecycle and diplomacy records use a
bounded two-turn action window. Player actions performed after turn t commits are
therefore collected when t+1 commits, retaining t as their event turn. Stable event
identities suppress replayed records across that window. Party, corporation and
market snapshots and battle reports use the exact committed turn.

Corporation vote outcomes emit only for the caller that wins the existing atomic
open-to-terminal claim. This records the board decision, not completion of its
subsequent effects. Request callers flush; turn callers join the end-turn batch.

## Economy snapshot expansion

Existing `economy_snapshot` properties and semantics are retained. Additional
properties come from the same projected `federalBudget` read:

- gdp, gdp_growth_pct, wage_growth_pct, trade_growth_pct
- debt_principal, debt_interest_rate, debt_to_gdp_ratio
- fiscal_revenue, fiscal_spending, fiscal_surplus
- player_wealth_sample_count

The wealth sample is the existing wealth-list snapshot, not a full census. Monetary
values retain their source denomination; corporation snapshots explicitly include
currency_code and share movements use anchor currency. Missing numeric historical
fields use zero, and unavailable historical battle control uses `unknown`.

## Coverage boundaries

The source records determine server coverage: membership proposals need a
resolvedOnTurn stamp, and international legislation needs enactedOnTurn. Historical
records without these stamps cannot be assigned an invented transition turn.
Rejected international legislation does not have a resolution-turn field in the
existing schema. A direct resolver hook records its automatic rejection without
adding a schema field. Sanction, directive, joint statement and agency programme
expiry also emit directly after the actual terminal status write. Organization
withdrawal tombstones and resolved leadership ballots supply further outcomes.

Snapshot and history telemetry is best effort. A telemetry read failure cannot
change the committed world. No database migration, rules change, or dependency is
required.
