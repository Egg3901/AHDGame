"use client";

import Link from "next/link";
import { StatePartyLeadershipElections } from "@/components/StatePartyLeadershipElections";
import { WhipTabs } from "@/components/party/WhipTabs";
import { NppRecruitmentPanel } from "@/components/party/NppRecruitmentPanel";
import { PsStrengthCard } from "@/components/party-hub/PsStrengthCard";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/ui";
import { DiscussionTab } from "@/components/party/DiscussionTab";
import { BuildOrgPanel } from "@/components/state/politics/orgActions/BuildOrgPanel";
import {
  STATE_PS_CAP_DEFAULT,
  STATE_PASSIVE_PS_PER_TURN,
} from "@/lib/politicalStrength/strengthConstants";
import { getOfficeLabel } from "@/lib/utils/politics";
import { regionPartyApiUrl } from "@/lib/urls";
import { SlateTab } from "@/app/country/[code]/parties/[id]/components/SlateTab";
import { StatePartyLeadershipPanel } from "./StatePartyLeadershipPanel";
import { StatePartyMetricsPanel } from "./StatePartyMetricsPanel";
import { StatePartyFundraisingPanel } from "./StatePartyFundraisingPanel";
import { StatePartyAdminTab } from "./StatePartyAdminTab";
import { StatePartyInfluencePanel } from "./StatePartyInfluencePanel";
import { StatePartyAnalyticsTab } from "./StatePartyAnalyticsTab";
import { fmt } from "./helpers";
import type { MainTab, StatePartyData, UserData } from "./types";
import type { StatePartyAnalyticsPayload } from "@/lib/partyAnalytics";
import type { useStatePartyTreasuryActions } from "./useStatePartyTreasuryActions";

type TreasuryActions = ReturnType<typeof useStatePartyTreasuryActions>;

interface StatePartyHubBodyProps {
  countryCode: string;
  stateId: string;
  partyId: string;
  activeTab: MainTab;
  nppSubtab: "recruitment" | "management";
  setNppSubtab: (v: "recruitment" | "management") => void;
  stateParty: StatePartyData;
  user: UserData | null;
  currentTurn: number;
  analyticsData: StatePartyAnalyticsPayload | null;
  fetchStateParty: () => void;
  treasury: TreasuryActions;
  msg: string;
  canInfluence: boolean;
  canViewExtendedTabs: boolean;
  canBuildOrg: boolean;
  canAssignCampaigner: boolean;
  canManageLead: boolean;
  canManageTreas: boolean;
  canManageTreasuryPlan: boolean;
  canChangeTax: boolean;
  canManageSlate: boolean;
  isMember: boolean;
  taxRate: number;
  setTaxRate: (v: number) => void;
  gotvPercent: number;
  setGotvPercent: (v: number) => void;
  gotvCategory: string;
  setGotvCategory: (v: string) => void;
  gotvGroup: string;
  setGotvGroup: (v: string) => void;
  suppressionPercent: number;
  setSuppressionPercent: (v: number) => void;
  suppressionCategory: string;
  setSuppressionCategory: (v: string) => void;
  suppressionGroup: string;
  setSuppressionGroup: (v: string) => void;
  transferReserveAmount: string;
  setTransferReserveAmount: (v: string) => void;
  memberSupportReserveAmount: string;
  setMemberSupportReserveAmount: (v: string) => void;
  nppRecruitmentReserveAmount: string;
  setNppRecruitmentReserveAmount: (v: string) => void;
  treasuryPreset: import("@/lib/treasury/partyTreasuryPresets").TreasuryPresetId;
  setTreasuryPreset: (v: import("@/lib/treasury/partyTreasuryPresets").TreasuryPresetId) => void;
  psInvestmentBudget: string;
  setPsInvestmentBudget: (v: string) => void;
}

export function StatePartyHubBody({
  countryCode,
  stateId,
  partyId,
  activeTab,
  nppSubtab,
  setNppSubtab,
  stateParty,
  user,
  currentTurn,
  analyticsData,
  fetchStateParty,
  treasury,
  msg,
  canInfluence,
  canViewExtendedTabs,
  canBuildOrg,
  canAssignCampaigner,
  canManageLead,
  canManageTreas,
  canManageTreasuryPlan,
  canChangeTax,
  canManageSlate,
  isMember,
  taxRate,
  setTaxRate,
  gotvPercent,
  setGotvPercent,
  gotvCategory,
  setGotvCategory,
  gotvGroup,
  setGotvGroup,
  suppressionPercent,
  setSuppressionPercent,
  suppressionCategory,
  setSuppressionCategory,
  suppressionGroup,
  setSuppressionGroup,
  transferReserveAmount,
  setTransferReserveAmount,
  memberSupportReserveAmount,
  setMemberSupportReserveAmount,
  nppRecruitmentReserveAmount,
  setNppRecruitmentReserveAmount,
  treasuryPreset,
  setTreasuryPreset,
  psInvestmentBudget,
  setPsInvestmentBudget,
}: StatePartyHubBodyProps) {
  const partyApiBase = regionPartyApiUrl(countryCode, stateId, partyId);
  const sortedMembers = [...stateParty.members].sort((a, b) => a.name.localeCompare(b.name));
  const slatePartyMembers = stateParty.members.map((member) => ({
    id: member.id,
    sequentialId: member.sequentialId,
    name: member.name,
    homeState: member.homeState,
    currentOffice: member.currentOffice,
    isNPP: member.isNPP,
  }));

  if (activeTab === "overview") {
    return (
      <div className="space-y-6">
        <StatePartyMetricsPanel stateParty={stateParty} />
        <BuildOrgPanel
          countryCode={countryCode}
          stateId={stateParty.stateId}
          partyId={stateParty.partyId}
          partyColor={stateParty.partyColor}
          ps={stateParty.politicalStrength}
          effectiveCap={stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT}
          hasPresence={stateParty.hasPresence}
          canBuildOrg={canBuildOrg}
          onSuccess={fetchStateParty}
        />
        <StatePartyLeadershipPanel
          stateParty={stateParty}
          user={user}
          canManageLead={canManageLead}
          canAssignCampaigner={canAssignCampaigner}
          onUpdate={fetchStateParty}
          hideAdminPanel={user?.isAdmin}
        />
      </div>
    );
  }

  if (activeTab === "analytics") {
    return (
      <StatePartyAnalyticsTab
        countryCode={countryCode}
        stateId={stateParty.stateId}
        partyId={stateParty.partyId}
        initialData={analyticsData}
      />
    );
  }

  if (activeTab === "whip-room") {
    return canInfluence ? (
      <div className="space-y-4">
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <p className="text-sm text-muted">
            Issue whips bill by bill and vote by vote from here. State parties can direct NPP voting
            pressure one target at a time.
          </p>
        </div>
        <WhipTabs
          showPlayerTab={false}
          isNational={false}
          countryId={countryCode}
          partyId={stateParty.partyId}
          partyColor={stateParty.partyColor}
          stateId={stateParty.stateId}
        />
      </div>
    ) : (
      <div className="rounded-xl border border-card-border bg-card p-6 text-sm text-muted italic">
        Whip directives are restricted to the State Chair and Vice Chair.
      </div>
    );
  }

  if (activeTab === "slate") {
    return (
      <SlateTab
        countryCode={countryCode}
        countryId={stateParty.countryId}
        partyId={stateParty.partyId}
        partyColor={stateParty.partyColor}
        canManageSlate={!!canManageSlate}
        partyMembers={slatePartyMembers}
        scopeState={stateParty.stateId}
      />
    );
  }

  if (activeTab === "admin" && user?.isAdmin) {
    return <StatePartyAdminTab stateParty={stateParty} onUpdate={fetchStateParty} />;
  }

  if (activeTab === "actions" && canViewExtendedTabs) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-card-border bg-card p-6">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wider mb-4">
            Party Resources
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted">Treasury</span>
              <span className="text-lg font-bold text-warning">
                {fmt(stateParty.treasury, stateParty.countryId)}
              </span>
            </div>
            <PsStrengthCard
              current={stateParty.politicalStrength ?? 0}
              cap={stateParty.effectivePsCap ?? STATE_PS_CAP_DEFAULT}
              scope="state"
            />
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-card-border bg-card p-1">
          <button
            type="button"
            onClick={() => setNppSubtab("recruitment")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              nppSubtab === "recruitment"
                ? "bg-primary text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            Recruitment
          </button>
          <button
            type="button"
            onClick={() => setNppSubtab("management")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              nppSubtab === "management"
                ? "bg-primary text-white"
                : "text-muted hover:text-foreground"
            }`}
          >
            Management
          </button>
        </div>

        {nppSubtab === "recruitment" ? (
          <NppRecruitmentPanel
            partyId={stateParty.partyId}
            countryId={stateParty.countryId}
            stateId={stateParty.stateId}
            isNational={false}
          />
        ) : (
          <StatePartyInfluencePanel
            partyId={stateParty.partyId}
            partyColor={stateParty.partyColor}
            countryId={stateParty.countryId}
            stateId={stateParty.stateId}
            stateName={stateParty.stateName}
            onPartyRefresh={fetchStateParty}
          />
        )}
      </div>
    );
  }

  if (activeTab === "elections") {
    return (
      <StatePartyLeadershipElections
        stateId={stateParty.stateId}
        countryId={stateParty.countryId}
        partyId={stateParty.partyId}
        partyColor={stateParty.partyColor}
        partyName={stateParty.partyName}
        currentTurn={currentTurn}
      />
    );
  }

  if (activeTab === "treasury") {
    return (
      <StatePartyFundraisingPanel
        stateParty={stateParty}
        user={user}
        isMember={isMember}
        canManageTreas={canManageTreas}
        canManageTreasuryPlan={!!canManageTreasuryPlan}
        canChangeTax={canChangeTax}
        taxRate={taxRate}
        setTaxRate={setTaxRate}
        savingTax={treasury.savingTax}
        handleSaveTax={treasury.handleSaveTax}
        psInvestmentBudget={psInvestmentBudget}
        setPsInvestmentBudget={setPsInvestmentBudget}
        savingPsInvestment={treasury.savingPsInvestment}
        handleSavePsInvestment={treasury.handleSavePsInvestment}
        gotvPercent={gotvPercent}
        setGotvPercent={setGotvPercent}
        gotvCategory={gotvCategory}
        setGotvCategory={setGotvCategory}
        gotvGroup={gotvGroup}
        setGotvGroup={setGotvGroup}
        savingGotv={treasury.savingGotv}
        handleSaveGotv={treasury.handleSaveGotv}
        suppressionPercent={suppressionPercent}
        setSuppressionPercent={setSuppressionPercent}
        suppressionCategory={suppressionCategory}
        setSuppressionCategory={setSuppressionCategory}
        suppressionGroup={suppressionGroup}
        setSuppressionGroup={setSuppressionGroup}
        savingSuppression={treasury.savingSuppression}
        handleSaveSuppression={treasury.handleSaveSuppression}
        transferReserveAmount={transferReserveAmount}
        setTransferReserveAmount={setTransferReserveAmount}
        memberSupportReserveAmount={memberSupportReserveAmount}
        setMemberSupportReserveAmount={setMemberSupportReserveAmount}
        nppRecruitmentReserveAmount={nppRecruitmentReserveAmount}
        setNppRecruitmentReserveAmount={setNppRecruitmentReserveAmount}
        treasuryPreset={treasuryPreset}
        setTreasuryPreset={setTreasuryPreset}
        savingTreasuryPlan={treasury.savingTreasuryPlan}
        handleSaveTreasuryPlan={treasury.handleSaveTreasuryPlan}
        transferAmount={treasury.transferAmount}
        setTransferAmount={treasury.setTransferAmount}
        transferring={treasury.transferring}
        handleTransfer={treasury.handleTransfer}
        sendMemberId={treasury.sendMemberId}
        setSendMemberId={treasury.setSendMemberId}
        sendAmount={treasury.sendAmount}
        setSendAmount={treasury.setSendAmount}
        sending={treasury.sending}
        handleSendToMember={treasury.handleSendToMember}
        msg={msg}
        sortedMembers={sortedMembers}
        donateAmount={treasury.donateAmount}
        setDonateAmount={treasury.setDonateAmount}
        donating={treasury.donating}
        handleDonate={treasury.handleDonate}
      />
    );
  }

  if (activeTab === "members") {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6">
        {stateParty.members.length === 0 ? (
          <EmptyState
            title="No members in this state yet"
            description="Members will appear here once they join this party in this state."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left">
                  <th className="pb-3 pl-2 font-medium text-muted">Member</th>
                  <th className="pb-3 font-medium text-muted">Office</th>
                  <th className="pb-3 font-medium text-muted">Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border">
                {sortedMembers.map((m) => {
                  const isStateCampaignerRow = !m.isNPP && stateParty.campaigner?.id === m.id;
                  const isNationalCampaignerRow =
                    !m.isNPP && stateParty.nationalCampaignerIds.includes(m.id);
                  const role =
                    m.id === stateParty.chair?.id
                      ? "State Chair"
                      : m.id === stateParty.viceChair?.id
                        ? "Vice Chair"
                        : m.id === stateParty.treasurer?.id
                          ? "Treasurer"
                          : isStateCampaignerRow
                            ? "State Campaigner"
                            : isNationalCampaignerRow
                              ? "National Campaigner"
                              : null;
                  return (
                    <tr key={m.id} className="group hover:bg-muted/5">
                      <td className="py-3 pl-2">
                        <div className="flex items-center gap-3">
                          <Avatar url={m.avatarUrl} name={m.name} size="h-9 w-9" />
                          <div className="flex flex-col">
                            <Link
                              href={
                                m.isNPP
                                  ? `/politicians/npp/${m.sequentialId ?? m.id}`
                                  : `/character/${m.sequentialId ?? m.id}`
                              }
                              className="font-medium text-foreground hover:text-primary transition-colors"
                            >
                              {m.name}
                            </Link>
                            {m.isNPP && (
                              <span className="text-[10px] text-purple-400 font-medium bg-purple-500/10 px-1.5 py-0.5 rounded w-fit mt-0.5">
                                NPP
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 align-middle">
                        {m.currentOffice ? (
                          <span className="text-primary font-medium">
                            {getOfficeLabel(m.currentOffice, stateParty.countryId)}
                          </span>
                        ) : (
                          <span className="text-muted/50">—</span>
                        )}
                      </td>
                      <td className="py-3 align-middle">
                        {role ? (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border"
                            style={{
                              backgroundColor: `${stateParty.partyColor}15`,
                              color: stateParty.partyColor,
                              borderColor: `${stateParty.partyColor}30`,
                            }}
                          >
                            {role}
                          </span>
                        ) : (
                          <span className="text-muted text-xs">Member</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "discussion") {
    return (
      <DiscussionTab
        apiBasePath={`${partyApiBase}/discussion`}
        isModerator={!!(user?.isModerator || user?.isAdmin)}
      />
    );
  }

  return null;
}
