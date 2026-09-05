"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CampaignData } from "@/lib/campaigns/dto/campaignView";
import type { UpgradeCategory } from "@/lib/campaigns/upgradeCosts";
import { BLEND, FONT } from "@/components/blend/tokens";
import { BlendShell, BlendHeader } from "@/components/blend/BlendShell";
import { BlendRail, BlendChipRail } from "@/components/blend/BlendRail";
import { BlendTicker } from "@/components/blend/BlendTicker";
import { BlendVitals } from "@/components/blend/BlendVitals";
import {
  buildCampaignBlendViewModel,
  OPS_TOTAL_CAP,
  type CampaignRail,
  type ViewerResources,
} from "./campaignBlendViewModel";
import { BlendOpsSection } from "./BlendOpsSection";
import { BlendMoneySection } from "./BlendMoneySection";
import { BlendLedger } from "./BlendLedger";
import { BlendSidebar, SupportBlock } from "./BlendSidebar";
import { BlendScopeInline } from "@/components/blend/BlendScope";
import { StatePresencePanel } from "../components/StatePresencePanel";
import { StateOperationsSection } from "../components/StateOperationsSection";
import type { StateOperationsView } from "@/lib/elections/dto/stateOperations";
import type { PrimaryStateActionKind } from "@/lib/db/types";
import type { PickerResult } from "./BlendCharacterPicker";

export interface CampaignBlendClientProps {
  campaign: CampaignData;
  me: ViewerResources;
  currentTurn: number | null;
  wire: string[];
  /** Full ops board and every manage control. */
  canManage: boolean;
  /** Running-mate surrogate: rally, tour, and the fundraising lane only. */
  canSurrogate: boolean;
  onRefresh: () => void;
  onRefreshMe: () => void;
  /** Change the opposition-research target. Manager/nominee only. */
  onRetarget?: (targetId: string) => void;
}

/**
 * The Blend campaign manager (Proposal D).
 *
 * Owns the screen's UI state (which pane, which lever is expanded, which ledger
 * page) and the mutation calls; every displayed value comes from
 * `buildCampaignBlendViewModel`.
 */
export function CampaignBlendClient({
  campaign,
  me,
  currentTurn,
  wire,
  canManage,
  canSurrogate,
  onRefresh,
  onRefreshMe,
  onRetarget,
}: CampaignBlendClientProps) {
  const [rail, setRail] = useState<CampaignRail>("overview");
  const [expanded, setExpanded] = useState<UpgradeCategory | null>(null);
  const [ledgerPage, setLedgerPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [personalAmount, setPersonalAmount] = useState("");
  const [treasuryAmount, setTreasuryAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ops, setOps] = useState<{ key: string; view: StateOperationsView } | null>(null);
  const [reloadOps, setReloadOps] = useState(0);

  const vm = useMemo(
    () =>
      buildCampaignBlendViewModel({
        campaign,
        me,
        currentTurn,
        wire,
        runningMateName: campaign.runningMateName ?? null,
        rail,
        ledgerPage,
        expandedCategory: expanded,
      }),
    [campaign, me, currentTurn, wire, rail, ledgerPage, expanded]
  );

  // A pane switch should never leave the reader parked on a ledger page that
  // no longer exists.
  useEffect(() => setLedgerPage(0), [rail]);

  // The state operations hub. Fetched here rather than served with the page so
  // an attack can refresh it without a full round trip. Keyed by election and
  // read back through a match, so a response for a race the viewer has left
  // cannot paint over the one they are looking at.
  const opsKey = campaign.electionId ?? "";
  const opsView = ops && ops.key === opsKey ? ops.view : null;

  useEffect(() => {
    if (!opsKey) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/elections/${opsKey}/state-operations`);
        // 404 is the ordinary answer for a race with nothing to act on (a
        // general election, a non-US seat, a viewer who is not a candidate).
        if (!res.ok) return;
        const payload = (await res.json()) as StateOperationsView | null;
        // A 200 carrying something else is not the hub. Rendering it would
        // throw inside the section and take the whole manager down with it.
        if (!payload?.positives?.camp) return;
        if (!cancelled) setOps({ key: opsKey, view: payload });
      } catch {
        // Non-critical: the section stays hidden and the rest of the page stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opsKey, reloadOps]);

  const post = useCallback(
    async (key: string, url: string, body?: unknown) => {
      setBusy(key);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          ...(body
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
            : {}),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "That did not work. Try again.");
          return false;
        }
        onRefresh();
        onRefreshMe();
        return true;
      } catch {
        setError("Network error. Try again.");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onRefresh, onRefreshMe]
  );

  const canAct = canManage || canSurrogate;
  // A surrogate may only act on the fundraising lane; every other lever stays
  // manager/nominee-only, exactly as the server gate enforces.
  const opsRows = canManage ? vm.ops : vm.ops.filter((o) => o.key === "fundraising");

  const contributionsOpen = !campaign.isArchived && !campaign.campaignSuspended;

  const handleAttack = async (
    targetCandidateId: string,
    kind: PrimaryStateActionKind,
    stateId: string
  ) => {
    const ok = await post(
      `${targetCandidateId}:${kind}`,
      `/api/elections/${campaign.electionId}/state-attack`,
      { targetCandidateId, kind, stateId }
    );
    if (ok) setReloadOps((n) => n + 1);
  };

  // Camping and the home-state surge now live in the hub, so the standalone
  // presence panel would duplicate them. Travel has no hub, so the general
  // phase keeps it, and the primary keeps it too until the hub has loaded:
  // dropping it outright would put a working action back out of reach, which
  // is the bug this branch has already fixed three times.
  const presencePanel =
    campaign.statePresence && (campaign.statePresence.phase === "general" || !opsView)
      ? campaign.statePresence
      : null;

  const handleContribute = async (source: "personal" | "treasury") => {
    const raw = source === "personal" ? personalAmount : treasuryAmount;
    // The endpoint takes a whole number of local units; a party contribution is
    // distinguished by carrying the party id, not by a source flag.
    const parsed = Math.floor(Number(String(raw).replace(/[^0-9.]/g, "")));
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Enter an amount to contribute.");
      return;
    }
    const partyId = campaign.partyTreasuryAccess?.partyId;
    if (source === "treasury" && partyId == null) {
      setError("You do not have access to a party treasury.");
      return;
    }
    const ok = await post("contribute", `/api/campaigns/${campaign.id}/donate`, {
      amount: parsed,
      ...(source === "treasury" ? { partyId: String(partyId) } : {}),
    });
    if (ok) {
      if (source === "personal") setPersonalAmount("");
      else setTreasuryAmount("");
    }
  };

  const showOps = rail === "overview" || rail === "ops";
  const showMoney = rail === "overview" || rail === "money";
  const showLog = rail === "overview" || rail === "log";

  const body = (
    <>
      <BlendTicker tag="WIRE" items={vm.wire} />
      <BlendVitals cells={vm.vitals} />

      {error ? (
        <div
          style={{
            padding: "10px 26px",
            borderBottom: `1px solid ${BLEND.hairlineStrong}`,
            fontFamily: FONT.serif,
            fontSize: 14,
            color: BLEND.negative,
          }}
        >
          {error}
        </div>
      ) : null}

      {showOps && opsRows.length > 0 ? (
        <BlendOpsSection
          rows={opsRows}
          investedLine={`${vm.railItems.find((i) => i.id === "ops")?.badge ?? `0/${OPS_TOTAL_CAP}`} invested · starter plus three branches per lever`}
          canAct={canAct}
          pending={busy}
          onToggle={(c) => setExpanded((v) => (v === c ? null : c))}
          onUnlock={(c) =>
            post(c, `/api/campaigns/${campaign.id}/upgrade`, { category: c, branch: null })
          }
          onUpgrade={(c, b) =>
            post(`${c}:${b}`, `/api/campaigns/${campaign.id}/upgrade`, {
              category: c,
              branch: b,
            })
          }
          onRetarget={onRetarget}
        />
      ) : null}

      {showOps && opsView ? (
        <StateOperationsSection
          view={opsView}
          busy={busy}
          onAttack={handleAttack}
          onChanged={() => {
            onRefresh();
            onRefreshMe();
            setReloadOps((n) => n + 1);
          }}
        />
      ) : null}

      {showMoney && vm.money ? (
        <BlendMoneySection
          money={vm.money}
          canContribute={contributionsOpen}
          contribution={{
            personalAmount,
            treasuryAmount,
            busy: busy === "contribute",
            error: null,
          }}
          onPersonalAmount={setPersonalAmount}
          onTreasuryAmount={setTreasuryAmount}
          onContributePersonal={() => handleContribute("personal")}
          onContributeTreasury={() => handleContribute("treasury")}
        />
      ) : null}

      {showLog ? (
        <BlendLedger
          ledger={vm.ledger}
          onPrev={() => setLedgerPage((p) => Math.max(0, p - 1))}
          onNext={() => setLedgerPage((p) => Math.min(vm.ledger.pageCount - 1, p + 1))}
        />
      ) : null}
    </>
  );

  return (
    <>
      {/* Mobile: sticky masthead with a scrolling chip rail, then the stacked body. */}
      <div className="lg:hidden">
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 5,
            background: BLEND.rail,
            borderBottom: `1px solid ${BLEND.hairline}`,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              paddingBottom: 9,
              borderBottom: `1px solid ${BLEND.hairline}`,
              fontFamily: FONT.serif,
              fontSize: 10,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: BLEND.muted,
            }}
          >
            <span>Campaign Desk</span>
            <span style={{ fontFamily: FONT.mono, letterSpacing: ".06em" }}>
              {currentTurn != null ? `T${currentTurn}` : ""}
            </span>
          </div>
          <div
            style={{
              marginTop: 11,
              fontFamily: FONT.serif,
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            {vm.railTitle}
          </div>
          <BlendChipRail
            items={vm.railItems}
            selectedId={rail}
            onSelect={(id) => setRail(id as CampaignRail)}
          />
        </div>
        <BlendTicker tag="WIRE" items={vm.wire} />
        <BlendVitals cells={vm.vitals} variant="mobile" />
        {/* Every failed action sets `error`, but the banner that shows it lives
            in `body`, which only the desktop shell renders. Without this copy a
            refused upgrade, rally or attack failed silently on a phone. */}
        {error ? (
          <div
            data-testid="campaign-error"
            style={{
              padding: "10px 16px",
              borderBottom: `1px solid ${BLEND.hairlineStrong}`,
              fontFamily: FONT.serif,
              fontSize: 14,
              color: BLEND.negative,
            }}
          >
            {error}
          </div>
        ) : null}
        {/* The rail these live in on desktop is `hidden lg:block`, so mobile
            needs its own copy or the only way to rally, camp, surge or travel
            disappears below the breakpoint. */}
        {vm.support ? (
          <div style={{ padding: "18px 16px 0" }}>
            <div
              style={{
                paddingBottom: 4,
                fontFamily: FONT.mono,
                fontSize: 9.5,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: BLEND.mutedDimmer,
              }}
            >
              National support
            </div>
            <SupportBlock
              vm={vm}
              canAct={canAct}
              busy={busy}
              onFireRally={() => post("rally", `/api/campaigns/${campaign.id}/rally`)}
              onToggleTour={() =>
                post("tour", `/api/campaigns/${campaign.id}/rally-tour`, {
                  active: !(vm.support?.tourActive ?? false),
                })
              }
            />
          </div>
        ) : null}

        {presencePanel ? (
          <div style={{ padding: "18px 16px 0" }}>
            <div
              style={{
                paddingBottom: 10,
                fontFamily: FONT.mono,
                fontSize: 9.5,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: BLEND.mutedDimmer,
              }}
            >
              Where you are campaigning
            </div>
            <BlendScopeInline>
              <StatePresencePanel
                presence={presencePanel}
                onChanged={() => {
                  onRefresh();
                  onRefreshMe();
                }}
              />
            </BlendScopeInline>
          </div>
        ) : null}
        {showOps && opsRows.length > 0 ? (
          <BlendOpsSection
            rows={opsRows}
            investedLine=""
            canAct={canAct}
            pending={busy}
            variant="mobile"
            onToggle={(c) => setExpanded((v) => (v === c ? null : c))}
            onUnlock={(c) =>
              post(c, `/api/campaigns/${campaign.id}/upgrade`, { category: c, branch: null })
            }
            onUpgrade={(c, b) =>
              post(`${c}:${b}`, `/api/campaigns/${campaign.id}/upgrade`, { category: c, branch: b })
            }
            onRetarget={onRetarget}
          />
        ) : null}
        {showOps && opsView ? (
          <StateOperationsSection
            view={opsView}
            busy={busy}
            variant="mobile"
            onAttack={handleAttack}
            onChanged={() => {
              onRefresh();
              onRefreshMe();
              setReloadOps((n) => n + 1);
            }}
          />
        ) : null}
        {showMoney && vm.money ? (
          <BlendMoneySection
            money={vm.money}
            canContribute={contributionsOpen}
            contribution={{
              personalAmount,
              treasuryAmount,
              busy: busy === "contribute",
              // The mobile banner above carries `error` now. Repeating it here
              // put a refused rally or attack inside the money section, which
              // is not where it happened.
              error: null,
            }}
            variant="mobile"
            onPersonalAmount={setPersonalAmount}
            onTreasuryAmount={setTreasuryAmount}
            onContributePersonal={() => handleContribute("personal")}
            onContributeTreasury={() => handleContribute("treasury")}
          />
        ) : null}
        {showLog ? (
          <BlendLedger
            ledger={vm.ledger}
            variant="mobile"
            onPrev={() => setLedgerPage((p) => Math.max(0, p - 1))}
            onNext={() => setLedgerPage((p) => Math.min(vm.ledger.pageCount - 1, p + 1))}
          />
        ) : null}
      </div>

      {/* Desktop: the three-column Blend shell. */}
      <div className="hidden lg:block">
        <BlendShell
          left={
            <BlendRail
              eyebrow="Campaign"
              title={vm.railTitle}
              subtitle={vm.railSubtitle}
              items={vm.railItems}
              selectedId={rail}
              onSelect={(id) => setRail(id as CampaignRail)}
              footnote={vm.fogFootnote ?? undefined}
            />
          }
          right={
            <BlendSidebar
              vm={vm}
              candidateId={campaign.candidateId}
              canManageTicket={canManage}
              canAct={canAct}
              busy={busy}
              presence={presencePanel}
              onPresenceChanged={() => {
                onRefresh();
                onRefreshMe();
              }}
              onFireRally={() => post("rally", `/api/campaigns/${campaign.id}/rally`)}
              onToggleTour={() =>
                post("tour", `/api/campaigns/${campaign.id}/rally-tour`, {
                  active: !(vm.support?.tourActive ?? false),
                })
              }
              onContributeStrength={() =>
                post("strength", `/api/campaigns/${campaign.id}/campaign-strength`)
              }
              onNameRunningMate={(r: PickerResult) =>
                post("runningMate", `/api/elections/${campaign.electionId}/running-mate`, {
                  runningMateId: r.id,
                })
              }
              onAppointManager={(r: PickerResult) =>
                post(`manager:${r.id}`, `/api/campaigns/${campaign.id}/manager`, {
                  managerCharacterId: r.id,
                })
              }
              onRemoveManager={(characterId) =>
                post(`manager:${characterId}`, `/api/campaigns/${campaign.id}/manager`, {
                  managerCharacterId: characterId,
                })
              }
            />
          }
        >
          <BlendHeader
            kicker="The Campaign Desk"
            readout={vm.turnReadout}
            headline={vm.paneTitle}
            standfirst={vm.standfirst}
          />
          {body}
        </BlendShell>
      </div>
    </>
  );
}
