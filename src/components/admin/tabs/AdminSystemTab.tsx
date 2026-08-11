"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { SeedControls } from "@/components/admin/system/SeedControls";
import { UniversalSeeder } from "@/components/admin/system/UniversalSeeder";
import { GameResetControls } from "@/components/GameResetControls";
import { HealSenateClasses } from "@/components/admin/heal/HealSenateClasses";
import { HealCrossCountryCandidates } from "@/components/admin/heal/HealCrossCountryCandidates";
import { HealOrphanVoteTallies } from "@/components/admin/heal/HealOrphanVoteTallies";
import { HealPresidentialElection } from "@/components/admin/heal/HealPresidentialElection";
import { HealPartyElections } from "@/components/admin/heal/HealPartyElections";
import { HealWithdrawnTallies } from "@/components/admin/heal/HealWithdrawnTallies";
import { HealCrossCountryPartyOrg } from "@/components/admin/heal/HealCrossCountryPartyOrg";
import { HealPartyLeadershipElections } from "@/components/admin/heal/HealPartyLeadershipElections";
import { HealPartyMembership } from "@/components/admin/heal/HealPartyMembership";
import { HealMultiSeatElections } from "@/components/admin/heal/HealMultiSeatElections";
import { HealDroppedNppParties } from "@/components/admin/heal/HealDroppedNppParties";
import { HealCorporationCash } from "@/components/admin/heal/HealCorporationCash";
import { HealCorporationShares } from "@/components/admin/heal/HealCorporationShares";
import { HealExecutiveDuplicates } from "@/components/admin/heal/HealExecutiveDuplicates";
import { HealStaleAdminAppointments } from "@/components/admin/heal/HealStaleAdminAppointments";
import { HealCorporationTimers } from "@/components/admin/heal/HealCorporationTimers";
import { HealCeoVotes } from "@/components/admin/heal/HealCeoVotes";
import { HealCorporationCeoVacant } from "@/components/admin/heal/HealCorporationCeoVacant";
import { HealUKCommonsSeats } from "@/components/admin/heal/HealUKCommonsSeats";
import { HealUKGovernment } from "@/components/admin/heal/HealUKGovernment";
import { HealStrategyCooldown } from "@/components/admin/heal/HealStrategyCooldown";
import { HealStaleCampaigns } from "@/components/admin/heal/HealStaleCampaigns";
import { HealConfidenceVotes } from "@/components/admin/heal/HealConfidenceVotes";
import { CountryReadinessPanel } from "@/components/admin/system/CountryReadinessPanel";
import { PostResetChecklist } from "@/components/admin/system/PostResetChecklist";
import { SeedDiagnosticPanel } from "@/components/admin/system/SeedDiagnosticPanel";
import { HealBudgets } from "@/components/admin/heal/HealFederalBudgets";
import { HealNppDataCorruption } from "@/components/admin/heal/HealNppDataCorruption";
import { IssueSovereignDebtCard } from "@/components/admin/economy/IssueSovereignDebtCard";
import { DiscordIntegrations } from "@/components/admin/system/DiscordIntegrations";
import { HealDiscordUsers } from "@/components/admin/heal/HealDiscordUsers";
import { GameHealthTab } from "@/components/admin/system/GameHealthTab";
import { CodeQualityTab } from "@/components/admin/system/CodeQualityTab";
import { AdminObservabilityTab } from "./AdminObservabilityTab";
import { SubTabBar } from "./SubTabBar";
import { SubNavLayout } from "./SubNavLayout";

export type SystemSubTab =
  | "seed"
  | "universal-seeder"
  | "reset"
  | "post-reset"
  | "heal"
  | "game-health"
  | "code-quality"
  | "integrations"
  | "observability";

type HealCategory = "elections" | "officials" | "parties" | "corporations" | "data";

const HEAL_CATEGORIES: { id: HealCategory; label: string }[] = [
  { id: "elections", label: "Elections" },
  { id: "officials", label: "Officials & Government" },
  { id: "parties", label: "Parties & Membership" },
  { id: "corporations", label: "Corporations" },
  { id: "data", label: "Economy & Data" },
];

interface AdminSystemTabProps {
  activeSub: SystemSubTab;
  onSubChange: (sub: SystemSubTab) => void;
}

const HEAL_CATEGORY_IDS = HEAL_CATEGORIES.map((c) => c.id);

function getValidHealCategory(param: string | null): HealCategory {
  return param && HEAL_CATEGORY_IDS.includes(param as HealCategory)
    ? (param as HealCategory)
    : "elections";
}

export function AdminSystemTab({ activeSub, onSubChange }: AdminSystemTabProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const healCategory = getValidHealCategory(searchParams.get("heal"));

  const setHealCategory = (category: HealCategory) => {
    const params = new URLSearchParams(searchParams);
    params.set("heal", category);
    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <SubNavLayout tab="system" active={activeSub} onChange={onSubChange}>
      <div className="space-y-6">
        <div className="rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-3 shadow-sm sm:p-4">
          <div className="flex items-start gap-2 sm:gap-3">
            <svg
              className="h-5 w-5 shrink-0 text-yellow-500 sm:mt-0.5 sm:h-6 sm:w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-yellow-500 sm:text-base">
                Caution: Destructive Actions
              </h3>
              <p className="mt-0.5 text-xs text-muted sm:mt-1 sm:text-sm">
                These actions can permanently delete data. Understand the consequences before
                proceeding.
              </p>
            </div>
          </div>
        </div>

        {activeSub === "seed" && (
          <div className="space-y-4">
            <SeedControls />
            <CountryReadinessPanel />
          </div>
        )}
        {activeSub === "universal-seeder" && (
          <div className="space-y-4">
            <UniversalSeeder />
            <IssueSovereignDebtCard />
          </div>
        )}
        {activeSub === "reset" && (
          <div className="space-y-4">
            <GameResetControls />
            <SeedDiagnosticPanel />
          </div>
        )}
        {activeSub === "post-reset" && <PostResetChecklist />}
        {activeSub === "heal" && (
          <div className="space-y-4">
            <SubTabBar options={HEAL_CATEGORIES} active={healCategory} onChange={setHealCategory} />

            {healCategory === "elections" && (
              <div className="space-y-4">
                <HealPresidentialElection />
                <HealPartyElections />
                <HealPartyLeadershipElections />
                <HealMultiSeatElections />
                <HealWithdrawnTallies />
                <HealOrphanVoteTallies />
              </div>
            )}

            {healCategory === "officials" && (
              <div className="space-y-4">
                <HealStaleAdminAppointments />
                <HealExecutiveDuplicates />
                <HealSenateClasses />
                <HealUKCommonsSeats />
                <HealConfidenceVotes />
                <HealUKGovernment />
              </div>
            )}

            {healCategory === "parties" && (
              <div className="space-y-4">
                <HealPartyMembership />
                <HealCrossCountryPartyOrg />
                <HealDroppedNppParties />
                <HealCrossCountryCandidates />
              </div>
            )}

            {healCategory === "corporations" && (
              <div className="space-y-4">
                <HealCorporationCash />
                <HealCorporationShares />
                <HealCorporationTimers />
                <HealStrategyCooldown />
                <HealCeoVotes />
                <HealCorporationCeoVacant />
              </div>
            )}

            {healCategory === "data" && (
              <div className="space-y-4">
                <HealBudgets />
                <HealStaleCampaigns />
                <HealNppDataCorruption />
                <HealDiscordUsers />
              </div>
            )}
          </div>
        )}
        {activeSub === "game-health" && <GameHealthTab />}
        {activeSub === "code-quality" && <CodeQualityTab />}
        {activeSub === "integrations" && <DiscordIntegrations />}
        {activeSub === "observability" && <AdminObservabilityTab />}
      </div>
    </SubNavLayout>
  );
}
