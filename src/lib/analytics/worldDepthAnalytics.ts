import type { Db } from "mongodb";
import type { GameIteration } from "@/lib/db/types/gameState";
import type { PartyHistorySnapshot } from "@/lib/db/types/partyHistory";
import type { PartyMembershipEvent } from "@/lib/db/types/partyMembershipEvent";
import type { Corporation } from "@/lib/db/types/corporation";
import type { CorporationHistory } from "@/lib/db/types/corporationHistory";
import type { MarketCapHistory } from "@/lib/db/types/marketCapHistory";
import type { ShareTradeHistory } from "@/lib/db/types/shareTradeHistory";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import type { BattleReportDoc } from "@/lib/db/types/battleReport";
import type { Crisis } from "@/lib/db/types/crisis";
import { getOrganizationLeadershipElectionsCollection } from "@/lib/db/collections/organizationLeadershipElections";
import { getOrganizationWithdrawalsCollection } from "@/lib/db/collections/organizationWithdrawals";
import { getOrganizationProposalsCollection } from "@/lib/db/collections/organizationProposals";
import { getOrganizationLegislationCollection } from "@/lib/db/collections/organizationLegislation";
import { captureServerGameEvent, getServerPosthogClient } from "./serverPosthog";

type Properties = Record<string, string | number | boolean>;
const finite = (value: number | undefined) => (Number.isFinite(value) ? value! : 0);
const id = (value: { toString(): string }) => value.toString();
const currency = (value: string | undefined) =>
  value && /^[A-Z]{3}$/.test(value) ? value : "unknown";

/** Read persisted outcomes after commit, never player-authored display fields.
 * Every read is projected and bounded to the committed/current action window. One query per
 * collection, independent of the number of parties, corporations or battles.
 */
export async function captureWorldDepthPosthog(input: {
  db: Db;
  turn: number;
  iteration?: GameIteration | null;
}): Promise<void> {
  if (!getServerPosthogClient()) return;
  try {
    const { db, turn } = input;
    const actionWindow = { $gte: Math.max(0, turn - 1), $lte: turn };
    const [
      proposalsCollection,
      legislationCollection,
      leadershipCollection,
      withdrawalsCollection,
    ] = await Promise.all([
      getOrganizationProposalsCollection(db),
      getOrganizationLegislationCollection(db),
      getOrganizationLeadershipElectionsCollection(db),
      getOrganizationWithdrawalsCollection(db),
    ]);
    const [
      parties,
      memberships,
      corporations,
      markets,
      trades,
      battles,
      crises,
      proposals,
      laws,
      shareTrades,
      leadership,
      withdrawals,
    ] = await Promise.all([
      db
        .collection<PartyHistorySnapshot>("partyHistory")
        .find(
          { turn },
          {
            projection: {
              countryId: 1,
              partyId: 1,
              organization: 1,
              playerCount: 1,
              nppCount: 1,
              memberCount: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<PartyMembershipEvent>("partyMembershipEvents")
        .find(
          { turn: actionWindow },
          {
            projection: {
              turn: 1,
              countryId: 1,
              oldPartyId: 1,
              newPartyId: 1,
              reason: 1,
              actorRole: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<CorporationHistory>("corporationHistory")
        .find(
          { turn },
          {
            projection: {
              corporationId: 1,
              currencyCode: 1,
              sharePrice: 1,
              marketCap: 1,
              liquidCapital: 1,
              revenue: 1,
              totalCosts: 1,
              income: 1,
              dividendPaidPerTurn: 1,
              corporateTaxPaid: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<MarketCapHistory>("marketCapHistory")
        .find(
          { turn },
          {
            projection: {
              globalMarketCap: 1,
              globalMarketIndex: 1,
              nyseMarketCap: 1,
              ftseMarketCap: 1,
              listingUniverse: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<TradeHistoryEntry>("tradeHistory")
        .find(
          { turn: Math.max(0, turn - 1) },
          {
            projection: {
              turn: 1,
              fromCurrency: 1,
              toCurrency: 1,
              amount: 1,
              spread: 1,
              source: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<BattleReportDoc>("battleReports")
        .find(
          { turn },
          {
            projection: {
              declarerCountry: 1,
              targetCountry: 1,
              noContact: 1,
              unopposedAdvance: 1,
              controlBefore: 1,
              controlAfter: 1,
              "result.win": 1,
              "result.margin": 1,
              "result.attacker.loss": 1,
              "result.defender.loss": 1,
            },
          }
        )
        .toArray(),
      db
        .collection<Crisis>("crises")
        .find(
          { $or: [{ startTurn: actionWindow }, { endTurn: actionWindow, status: "resolved" }] },
          {
            projection: {
              scope: 1,
              countryIds: 1,
              status: 1,
              startTurn: 1,
              endTurn: 1,
              autoSource: 1,
              autoGenerated: 1,
            },
          }
        )
        .toArray(),
      proposalsCollection
        .find(
          { resolvedOnTurn: actionWindow },
          {
            projection: {
              resolvedOnTurn: 1,
              organizationId: 1,
              proposingCountryId: 1,
              status: 1,
            },
          }
        )
        .toArray(),
      legislationCollection
        .find(
          { enactedOnTurn: actionWindow },
          {
            projection: {
              enactedOnTurn: 1,
              organizationId: 1,
              proposingCountryId: 1,
              type: 1,
              status: 1,
            },
          }
        )
        .toArray(),
      db
        .collection<ShareTradeHistory>("shareTradeHistory")
        .find(
          { turn: actionWindow, kind: { $ne: "correction" } },
          { projection: { corporationId: 1, turn: 1, kind: 1, shares: 1, totalAnchor: 1 } }
        )
        .toArray(),
      leadershipCollection
        .find(
          { resolvedOnTurn: actionWindow },
          { projection: { organizationId: 1, candidateCountryId: 1, status: 1, resolvedOnTurn: 1 } }
        )
        .toArray(),
      withdrawalsCollection
        .find(
          { withdrawnTurn: actionWindow },
          { projection: { organizationId: 1, countryId: 1, withdrawnTurn: 1 } }
        )
        .toArray(),
    ]);
    const corporateIds = [
      ...corporations.map((row) => row.corporationId),
      ...shareTrades.map((row) => row.corporationId),
    ];
    const corporateNations = corporateIds.length
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corporateIds } }, { projection: { countryId: 1 } })
          .toArray()
      : [];
    const nationByCorporation = new Map(
      corporateNations.map((row) => [id(row._id), row.countryId])
    );
    const emit = (
      event: string,
      key: string,
      properties: Properties,
      nationId?: string,
      eventTurn = turn
    ) =>
      captureServerGameEvent({
        ...input,
        event,
        turn: eventTurn,
        distinctId: "system:turn-processor",
        insertId: `${event}:${key}:${eventTurn}`,
        nationId,
        properties,
      });
    for (const row of parties)
      await emit(
        "party_snapshot",
        id(row._id),
        {
          party_id: row.partyId,
          organization: finite(row.organization),
          player_members: finite(row.playerCount),
          npc_members: finite(row.nppCount),
          total_members: finite(row.memberCount),
        },
        row.countryId
      );
    for (const row of memberships) {
      if (!["join", "leave", "purge", "create_party"].includes(row.reason)) continue;
      await emit(
        "party_membership_changed",
        id(row._id),
        {
          from_party_id: row.oldPartyId ?? "independent",
          to_party_id: row.newPartyId ?? "independent",
          transition_type: row.reason,
          selection_method:
            row.actorRole && ["self", "chair", "system"].includes(row.actorRole)
              ? row.actorRole
              : "unknown",
        },
        row.countryId,
        row.turn ?? turn
      );
    }
    for (const row of corporations)
      await emit(
        "corporation_snapshot",
        id(row._id),
        {
          corporation_id: id(row.corporationId),
          currency_code: currency(row.currencyCode),
          share_price: finite(row.sharePrice),
          market_cap: finite(row.marketCap),
          liquid_capital: finite(row.liquidCapital),
          revenue: finite(row.revenue),
          operating_costs: finite(row.totalCosts),
          income: finite(row.income),
          dividend_paid: finite(row.dividendPaidPerTurn),
          corporate_tax_paid: finite(row.corporateTaxPaid),
        },
        nationByCorporation.get(id(row.corporationId))
      );
    for (const row of shareTrades) {
      if (
        ![
          "issuance",
          "market_buy",
          "market_sell",
          "limit_fill",
          "peer_fill",
          "listing_fill",
          "takeover_buyout",
          "stock_split",
          "reverse_split",
        ].includes(row.kind)
      )
        continue;
      const structureChange = [
        "issuance",
        "takeover_buyout",
        "stock_split",
        "reverse_split",
      ].includes(row.kind);
      await emit(
        structureChange ? "corporation_structure_changed" : "share_trade_settled",
        id(row._id),
        {
          corporation_id: id(row.corporationId),
          transition_type: row.kind,
          share_count: finite(row.shares),
          total_anchor: finite(row.totalAnchor),
        },
        nationByCorporation.get(id(row.corporationId)),
        row.turn ?? turn
      );
    }
    for (const row of markets)
      await emit("market_snapshot", "global", {
        global_market_cap: finite(row.globalMarketCap),
        global_market_index: finite(row.globalMarketIndex),
        us_market_cap: finite(row.nyseMarketCap),
        uk_market_cap: finite(row.ftseMarketCap),
        listing_universe: row.listingUniverse === "public-only" ? "public_only" : "legacy",
      });
    const tradeGroups = new Map<
      string,
      { from: string; to: string; source: string; count: number; amount: number; spread: number }
    >();
    for (const row of trades) {
      const source = [
        "manual",
        "direct",
        "limit_order",
        "auto_purchase",
        "auto_dividend",
        "auto_coupon",
        "api",
      ].includes(row.source ?? "manual")
        ? (row.source ?? "manual")
        : "unknown";
      const from = currency(row.fromCurrency),
        to = currency(row.toCurrency);
      const key = `${from}:${to}:${source}`;
      const group = tradeGroups.get(key) ?? { from, to, source, count: 0, amount: 0, spread: 0 };
      group.count++;
      group.amount += finite(row.amount);
      group.spread += finite(row.spread);
      tradeGroups.set(key, group);
    }
    for (const [key, group] of tradeGroups)
      await emit(
        "currency_trade_settled",
        key,
        {
          from_currency: group.from,
          to_currency: group.to,
          execution_source: group.source,
          trade_count: group.count,
          total_amount: group.amount,
          mean_spread: group.spread / group.count,
        },
        undefined,
        Math.max(0, turn - 1)
      );
    for (const row of battles)
      await emit(
        "battle_resolved",
        id(row._id),
        {
          battle_id: id(row._id),
          outcome: row.noContact
            ? row.unopposedAdvance
              ? "unopposed_advance"
              : "no_contact"
            : row.result
              ? row.result.win
                ? "attacker_won"
                : "defender_won"
              : "unknown",
          margin: finite(row.result?.margin),
          attacker_casualties: finite(row.result?.attacker.loss),
          defender_casualties: finite(row.result?.defender.loss),
          control_before: row.controlBefore ?? "unknown",
          control_after: row.controlAfter ?? "unknown",
          defender_nation_id: /^[A-Z]{2,3}$/.test(row.targetCountry)
            ? row.targetCountry
            : "world_entity",
        },
        row.declarerCountry
      );
    for (const row of crises) {
      const props = {
        crisis_id: id(row._id),
        scope: row.scope,
        origin: row.autoGenerated ? (row.autoSource ?? "automatic") : "manual",
        duration_turns: row.endTurn == null ? 0 : Math.max(0, row.endTurn - row.startTurn),
      };
      const nationId = row.countryIds.length === 1 ? row.countryIds[0] : undefined;
      if (row.startTurn >= Math.max(0, turn - 1) && row.startTurn <= turn)
        await emit("crisis_started", id(row._id), props, nationId, row.startTurn);
      if (
        row.status === "resolved" &&
        row.endTurn != null &&
        row.endTurn >= Math.max(0, turn - 1) &&
        row.endTurn <= turn
      )
        await emit("crisis_resolved", id(row._id), props, nationId, row.endTurn);
    }
    for (const row of proposals)
      await emit(
        "diplomacy_resolved",
        id(row._id),
        {
          proposal_id: id(row._id),
          organization_id: row.organizationId,
          action_type: "membership",
          outcome: row.status,
        },
        row.proposingCountryId,
        row.resolvedOnTurn ?? turn
      );
    for (const row of laws)
      await emit(
        "diplomacy_resolved",
        id(row._id),
        {
          proposal_id: id(row._id),
          organization_id: row.organizationId,
          action_type: row.type,
          outcome: "enacted",
        },
        row.proposingCountryId,
        row.enactedOnTurn ?? turn
      );
    for (const row of leadership)
      await emit(
        "diplomacy_resolved",
        id(row._id),
        {
          proposal_id: id(row._id),
          organization_id: row.organizationId,
          action_type: "leadership_election",
          outcome: row.status,
        },
        row.candidateCountryId,
        row.resolvedOnTurn ?? turn
      );
    for (const row of withdrawals)
      await emit(
        "diplomacy_status_changed",
        id(row._id),
        {
          organization_id: row.organizationId,
          action_type: "membership",
          from_status: "active",
          to_status: "withdrawn",
          transition_type: "withdrawal",
        },
        row.countryId,
        row.withdrawnTurn
      );
  } catch {
    // Post-commit telemetry is best effort and cannot affect game outcomes.
  }
}
