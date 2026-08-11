"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Button, EmptyState, Skeleton } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { Party, UserData, OrgParty, PartyTrendPoint } from "./partiesTypes";
import type { CoalitionListItem } from "./coalitionTypes";
import { partiesApiUrl, coalitionsApiUrl } from "@/lib/urls";
import { PartiesHeader } from "./components/PartiesHeader";
import { ChartsSection } from "./components/ChartsSection";
import { PartyCard } from "./components/PartyCard";
import { CoalitionsTab } from "./components/CoalitionsTab";
import { CreateCoalitionModal } from "./components/CreateCoalitionModal";
import { useAuthMe } from "@/contexts/AuthDataContext";

/**
 * Parties list redesign plan:
 * Palette: semantic card/background/status tokens, with party colors reserved for data identity.
 * Type: display for the page title, heading levels for balance-of-power headlines, body for detail.
 * Layout: compact hero and tabs → power briefing → ranked, drillable party/coalition cards.
 * Signature: one segmented balance bar paired with largest-party and momentum callouts.
 */

export default function PartiesPage() {
  const { showToast } = useToast();
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: authUser, navData } = useAuthMe();

  const [parties, setParties] = useState<Party[]>([]);
  const [orgParties, setOrgParties] = useState<OrgParty[]>([]);
  const [partyHistory, setPartyHistory] = useState<PartyTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 6 D6: party creation flows through the charter wizard at
  // `/charters/new`; the in-modal create-form is no longer used.

  // Tab state — initialize from URL ?tab=coalitions if present
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<"parties" | "coalitions">(
    tabParam === "coalitions" ? "coalitions" : "parties"
  );

  // Coalition state
  const [coalitions, setCoalitions] = useState<CoalitionListItem[]>([]);
  const [coalitionsLoading, setCoalitionsLoading] = useState(false);
  const [showCreateCoalition, setShowCreateCoalition] = useState(false);
  const [creatingCoalition, setCreatingCoalition] = useState(false);

  // Create coalition form state
  const [coalitionFormName, setCoalitionFormName] = useState("");
  const [coalitionFormAbbrev, setCoalitionFormAbbrev] = useState("");
  const [coalitionFormColor, setCoalitionFormColor] = useState("#6366F1");

  // Country from route params [code]
  const effectiveCountry = code?.toLowerCase() ?? "us";
  const user = useMemo<UserData | null>(() => {
    if (!authUser) return null;
    const character = authUser.character as
      | {
          id?: string;
          party?: string;
          countryId?: string;
        }
      | null
      | undefined;
    return {
      username: String(authUser.username ?? ""),
      isAdmin: authUser.isAdmin === true,
      hasCharacter: !!navData?.hasCharacter || !!character,
      character: character
        ? {
            id: String(character.id ?? ""),
            party: String(character.party ?? ""),
            homeState: navData?.homeState?.id ?? "",
            homeStateName: navData?.homeState?.name,
            countryId: character.countryId,
            actions: typeof navData?.actions === "number" ? navData.actions : 0,
            funds: typeof navData?.funds === "number" ? navData.funds : 0,
          }
        : undefined,
    };
  }, [authUser, navData]);

  // Fetch enabled countries for the tab selector
  const [enabledCountries, setEnabledCountries] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    fetchJson<{
      countries?: { id: string; name?: string; enabledForPlayers?: boolean }[];
    }>("/api/countries", { feature: "parties-enabled-countries" })
      .then((data) => {
        setEnabledCountries(
          (data.countries ?? [])
            .filter((entry: { enabledForPlayers?: boolean }) => entry.enabledForPlayers)
            .map((entry: { id: string; name?: string }) => ({
              id: entry.id.toLowerCase(),
              name: entry.name ?? COUNTRY_CONFIGS[entry.id as CountryId]?.name ?? entry.id,
            }))
        );
      })
      .catch(() => {});
  }, []);

  const fetchParties = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const partiesRes = await fetch(`${partiesApiUrl(effectiveCountry)}?includeOrg=1`);
      if (!partiesRes.ok) throw new Error("Failed to load parties");
      const data = await partiesRes.json();
      setParties(data.parties || []);
      setOrgParties(data.orgParties || []);
    } catch {
      setError("Failed to load parties. Please try again.");
    } finally {
      setLoading(false);
    }

    try {
      const historyRes = await fetch(`${partiesApiUrl(effectiveCountry)}/history`);
      if (historyRes.ok) {
        const data = await historyRes.json();
        setPartyHistory(data.history || []);
      }
    } catch {
      /* silent */
    }
  }, [effectiveCountry]);

  const fetchCoalitions = useCallback(async () => {
    setCoalitionsLoading(true);
    try {
      const res = await fetch(coalitionsApiUrl(effectiveCountry));
      if (res.ok) {
        const data = await res.json();
        setCoalitions(data.coalitions || []);
      }
    } catch {
      /* silent */
    } finally {
      setCoalitionsLoading(false);
    }
  }, [effectiveCountry]);

  useEffect(() => {
    fetchParties();
  }, [fetchParties]);

  // Fetch coalitions when tab is active or country changes
  useEffect(() => {
    if (activeTab === "coalitions") {
      fetchCoalitions();
    }
  }, [activeTab, fetchCoalitions]);

  const handleCreateCoalition = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingCoalition(true);
    try {
      const res = await fetch(coalitionsApiUrl(effectiveCountry), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: coalitionFormName,
          abbreviation: coalitionFormAbbrev,
          color: coalitionFormColor,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message ?? "Coalition created successfully", "success");
        setShowCreateCoalition(false);
        setCoalitionFormName("");
        setCoalitionFormAbbrev("");
        setCoalitionFormColor("#6366F1");
        fetchCoalitions();
      } else {
        showToast(data.error ?? "Failed to create coalition", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setCreatingCoalition(false);
    }
  };

  // Determine the character's country from their home state
  const characterCountry = (user?.character?.countryId ?? "US").toLowerCase();
  const isInSameCountry = user?.hasCharacter && characterCountry === effectiveCountry;
  // Phase 6 D6: party creation routes through `/charters/new`, so the
  // 25-actions / $1M gate is enforced inside the charter wizard / API
  // rather than here on the parties listing page.

  // National chair detection: user is chair if their party's chair id matches their character id
  const userParty = parties.find((p) => p.id === user?.character?.party);
  const isNationalChair = !!(
    user?.hasCharacter &&
    user?.character &&
    userParty?.chair?.id === user.character.id &&
    isInSameCountry
  );

  // Coalition membership check: any coalition has user's party in members
  const isInCoalition = !!(
    user?.character?.party &&
    coalitions.some((c) =>
      c.memberParties.some((mp) => String(mp.partyId) === user?.character?.party)
    )
  );

  return (
    <div className="min-h-screen bg-background pb-16">
      <main className="mx-auto max-w-7xl overflow-x-hidden px-4 py-6 sm:px-6 sm:py-8">
        <PartiesHeader
          effectiveCountry={effectiveCountry}
          parties={parties}
          canShowCreateButton={!!isInSameCountry}
          onCreatePartyClick={() => router.push("/charters/new")}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          isNationalChair={isNationalChair}
          isInCoalition={isInCoalition}
          onCreateCoalitionClick={() => setShowCreateCoalition(true)}
          enabledCountries={enabledCountries}
        />

        {activeTab === "parties" && (
          <>
            {!loading && (
              <ChartsSection
                parties={parties}
                orgParties={orgParties}
                partyHistory={partyHistory}
                defaultPartyId={user?.character?.party ?? parties[0]?.id ?? ""}
              />
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 flex flex-col gap-3 rounded-lg border border-error/30 bg-error/10 p-4 text-body-sm text-error sm:flex-row sm:items-center sm:justify-between"
              >
                <span>{error}</span>
                <Button variant="secondary" size="sm" onClick={fetchParties}>
                  Try again
                </Button>
              </div>
            )}

            {loading && !error && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-card-border bg-card p-5">
                    <Skeleton className="h-12 w-12 rounded-full mb-3" />
                    <Skeleton className="h-5 w-2/3 mb-2" />
                    <Skeleton className="h-4 w-full mb-1" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ))}
              </div>
            )}

            {!loading &&
              (() => {
                const orgMap = new Map(orgParties.map((o) => [o.id, o.totalOrg]));
                const sorted = [...parties].sort(
                  (a, b) =>
                    b.memberCount - a.memberCount ||
                    (orgMap.get(b.id) ?? 0) - (orgMap.get(a.id) ?? 0)
                );
                const totalMembers = parties.reduce((sum, party) => sum + party.memberCount, 0);
                const momentumByParty = new Map(
                  parties.map((party) => {
                    const history = partyHistory
                      .filter((point) => point.partyId === party.id)
                      .sort((a, b) => a.turn - b.turn);
                    const latest = history.at(-1);
                    const previous = history.at(-2);
                    return [
                      party.id,
                      latest && previous ? latest.memberCount - previous.memberCount : null,
                    ] as const;
                  })
                );
                return (
                  <section aria-labelledby="party-roster-title">
                    <div className="mb-3 flex items-end justify-between gap-4">
                      <div>
                        <p className="text-body-xs font-bold uppercase tracking-widest text-muted">
                          Ranked by membership
                        </p>
                        <h2 id="party-roster-title" className="text-heading-lg font-extrabold">
                          Party roster
                        </h2>
                      </div>
                      <span className="font-mono text-body-sm text-muted">
                        {parties.length} total
                      </span>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {sorted.map((party, index) => (
                        <PartyCard
                          key={party.id}
                          party={party}
                          effectiveCountry={effectiveCountry}
                          rank={index + 1}
                          totalMembers={totalMembers}
                          momentum={momentumByParty.get(party.id) ?? null}
                        />
                      ))}
                    </div>
                  </section>
                );
              })()}

            {!loading && parties.length === 0 && (
              <div className="rounded-xl border border-card-border bg-card p-12">
                <EmptyState
                  title="No political parties found"
                  description="This country has no registered political parties yet."
                  {...(isInSameCountry
                    ? {
                        actionLabel: "Create Party",
                        onAction: () => router.push("/charters/new"),
                      }
                    : {})}
                />
              </div>
            )}
          </>
        )}

        {activeTab === "coalitions" && (
          <CoalitionsTab
            coalitions={coalitions}
            loading={coalitionsLoading}
            effectiveCountry={effectiveCountry}
          />
        )}

        {showCreateCoalition && (
          <CreateCoalitionModal
            creating={creatingCoalition}
            formName={coalitionFormName}
            formAbbrev={coalitionFormAbbrev}
            formColor={coalitionFormColor}
            userActions={user?.character?.actions ?? 0}
            onClose={() => setShowCreateCoalition(false)}
            onSubmit={handleCreateCoalition}
            onFormNameChange={setCoalitionFormName}
            onFormAbbrevChange={setCoalitionFormAbbrev}
            onFormColorChange={setCoalitionFormColor}
          />
        )}
      </main>
    </div>
  );
}
