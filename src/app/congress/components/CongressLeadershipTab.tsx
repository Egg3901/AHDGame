"use client";

import { useState, useEffect, useCallback } from "react";
import { SpeakerSection } from "./SpeakerSection";
import { AssignLeaderModal } from "./AssignLeaderModal";
import { HouseLeadershipRoleSection, SenateLeadershipRoleSection } from "./LeadershipRoleSection";
import {
  HouseLeadershipByPartyGrid,
  SenateLeadershipByPartyGrid,
  type LeaderDisplay,
} from "./LeadershipByPartyGrid";
import type {
  SpeakerResponse,
  SenateLeadershipResponse,
  HouseLeadershipResponse,
} from "@/lib/congress/types";
import type { ChamberTab } from "./CongressConstants";
import type { CountryId } from "@/lib/constants/countries";
import { CardSkeleton, ListRowSkeleton, Skeleton } from "@/components/ui";
import { WhipTabs } from "@/components/party/WhipTabs";

type SenateLeadershipRole =
  "pro_tempore" | "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip";

export function CongressLeadershipTab({
  activeTab,
  countryId,
}: {
  activeTab: ChamberTab;
  countryId: CountryId;
}) {
  const [data, setData] = useState<SpeakerResponse | null>(null);
  const [houseLeadData, setHouseLeadData] = useState<HouseLeadershipResponse | null>(null);
  const [senateData, setSenateData] = useState<SenateLeadershipResponse | null>(null);
  const [leaders, setLeaders] = useState<LeaderDisplay[]>([]);
  const [leadersAdmin, setLeadersAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [declaring, setDeclaring] = useState(false);
  const [senateDeclaring, setSenateDeclaring] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [assigningRole, setAssigningRole] = useState<string | null>(null);
  const [chamberMembers, setChamberMembers] = useState<
    { id: string; name: string; state: string; party: string }[]
  >([]);
  const [assignCharacterId, setAssignCharacterId] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);

  type AssignableMember = {
    id: string;
    name: string;
    state: string;
    party: string;
    partyName?: string;
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [speakerRes, houseLeadRes, senateRes, leadersRes] = await Promise.all([
        fetch("/api/congress/speaker"),
        fetch("/api/congress/house-leadership"),
        fetch("/api/congress/senate-leadership"),
        fetch("/api/congress/leaders"),
      ]);
      if (speakerRes.ok) setData(await speakerRes.json());
      if (houseLeadRes.ok) setHouseLeadData(await houseLeadRes.json());
      if (senateRes.ok) setSenateData(await senateRes.json());
      if (leadersRes.ok) {
        const j = await leadersRes.json();
        setLeaders(j.leaders ?? []);
        setLeadersAdmin(j.isAdmin ?? false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Viewer's own party, so the Whip Room can be used from this screen instead
  // of navigating away to the party page mid-leadership-election (ticket #974
  // QoL request). Both whip panels self-gate on the `canWhip` flag their
  // endpoints return, so rendering this for any party member is safe — a
  // non-chair simply sees the whip actions disabled.
  const [viewerParty, setViewerParty] = useState<{ id: string; color: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const meRes = await fetch("/api/character/me");
        if (!meRes.ok) return;
        const me = await meRes.json();
        const partyId: string | null = me?.character?.party ?? null;
        if (!partyId || partyId === "independent") return;
        if (me?.character?.countryId !== countryId) return;
        const partiesRes = await fetch(`/api/country/${countryId.toLowerCase()}/parties`);
        if (!partiesRes.ok) return;
        const parties = await partiesRes.json();
        const list: Array<{ sequentialId: number; color?: string }> = Array.isArray(parties)
          ? parties
          : (parties?.parties ?? []);
        const mine = list.find((p) => String(p.sequentialId) === partyId);
        if (!cancelled) setViewerParty({ id: partyId, color: mine?.color ?? "#6b7280" });
      } catch {
        // Non-fatal: the Whip Room section just stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  async function apiPost(
    url: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; error?: string; message?: string }> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    return { ok: res.ok, error: d.error, message: d.message };
  }

  async function handleSpeakerAction(
    action: string,
    nominationId?: string,
    vacateVote?: "for" | "against"
  ): Promise<void> {
    setError("");
    setMessage("");
    const body: Record<string, unknown> = { action };
    if (nominationId) body.nominationId = nominationId;
    if (vacateVote) body.vacateVote = vacateVote;
    const result = await apiPost("/api/congress/speaker", body);
    if (result.ok) setMessage(result.message ?? "");
    else setError(result.error ?? "Error");
    fetchData();
  }

  async function handleSenateLeadershipAction(
    role: SenateLeadershipRole,
    action: string,
    nominationId?: string
  ): Promise<void> {
    setError("");
    setMessage("");
    const body: Record<string, unknown> = { action, role };
    if (nominationId) body.nominationId = nominationId;
    const result = await apiPost("/api/congress/senate-leadership", body);
    if (result.ok) setMessage(result.message ?? "");
    else setError(result.error ?? "Error");
    fetchData();
  }

  async function handleHouseLeadAction(
    role: "majority_leader" | "minority_leader" | "majority_whip" | "minority_whip",
    action: string,
    nominationId?: string
  ): Promise<void> {
    setError("");
    setMessage("");
    const body: Record<string, unknown> = { action, role };
    if (nominationId) body.nominationId = nominationId;
    const result = await apiPost("/api/congress/house-leadership", body);
    if (result.ok) setMessage(result.message ?? "");
    else setError(result.error ?? "Error");
    fetchData();
  }

  async function openAssign(role: string, chamber: "house" | "senate") {
    setAssigningRole(role);
    setAssignCharacterId("");
    const res = await fetch(
      `/api/country/${countryId.toLowerCase()}/congress/members?chamber=${chamber}`
    );
    if (res.ok) {
      const j = await res.json();
      let list: AssignableMember[] = (j.members ?? [])
        .filter((m: { characterId: string | null }) => m.characterId)
        .map(
          (m: {
            characterId: string;
            characterName: string;
            state: string;
            party: string;
            partyName?: string;
          }) => ({
            id: m.characterId,
            name: m.characterName,
            state: m.state,
            party: m.party,
            partyName: m.partyName,
          })
        );
      if (role === "majority_leader_house") {
        list = list.filter(
          (member: AssignableMember) => member.party === (data?.majorityParty ?? "")
        );
      }
      if (role === "majority_leader_senate") {
        list = list.filter(
          (member: AssignableMember) =>
            member.party === (senateData?.senateComposition?.[0]?.party ?? "")
        );
      }
      setChamberMembers(list);
    } else {
      setChamberMembers([]);
    }
  }

  async function submitAssign() {
    if (!assigningRole) return;
    setError("");
    setMessage("");
    setAssignLoading(true);
    try {
      const result = await apiPost("/api/congress/leaders", {
        role: assigningRole,
        characterId: assignCharacterId || null,
      });
      if (result.ok) {
        setMessage(result.message ?? "");
        setAssigningRole(null);
        fetchData();
      } else {
        setError(result.error ?? "Error");
      }
    } finally {
      setAssignLoading(false);
    }
  }

  async function clearRole(role: string) {
    setError("");
    setMessage("");
    const result = await apiPost("/api/congress/leaders", {
      role,
      characterId: null,
    });
    if (result.ok) setMessage(result.message ?? "");
    else setError(result.error ?? "Error");
    fetchData();
  }

  const chamberLeaders = leaders.filter((l) => l.chamber === activeTab);

  if (loading)
    return (
      <div className="min-h-[32rem] space-y-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i}>
            <Skeleton className="h-5 w-40 mb-4" />
            <ListRowSkeleton withBadge />
            <ListRowSkeleton withBadge />
          </CardSkeleton>
        ))}
      </div>
    );

  return (
    <div className="space-y-5">
      {message && (
        <div className="rounded-lg bg-success/10 border border-success/30 px-4 py-3 text-sm text-success">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-error/10 border border-error/30 px-4 py-3 text-sm text-error">
          {error}
        </div>
      )}

      {activeTab === "house" ? (
        <>
          <SpeakerSection
            data={data}
            leadersAdmin={leadersAdmin}
            declaring={declaring}
            countryId={countryId}
            onDeclare={() => {
              setDeclaring(true);
              handleSpeakerAction("declare").finally(() => setDeclaring(false));
            }}
            onWithdraw={() => handleSpeakerAction("withdraw")}
            onVote={(id) => handleSpeakerAction("vote", id)}
            onStartElection={async () => {
              setError("");
              setMessage("");
              const result = await apiPost("/api/congress/speaker", {
                action: "start_election",
              });
              if (result.ok) setMessage(result.message ?? "");
              else setError(result.error ?? "Error");
              fetchData();
            }}
            onForceEnd={() => handleSpeakerAction("force_end")}
            onReset={() => handleSpeakerAction("reset_election")}
            onFileVacate={() => handleSpeakerAction("file_vacate_motion")}
            onVacateVote={(vote) => handleSpeakerAction("vote_vacate_motion", undefined, vote)}
          />

          <HouseLeadershipRoleSection
            title="Majority Leader"
            electionState={houseLeadData?.majorityLeader}
            isMember={houseLeadData?.majorityLeader?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleHouseLeadAction("majority_leader", "start_election")}
            onForceEnd={() => handleHouseLeadAction("majority_leader", "force_end")}
            onReset={() => handleHouseLeadAction("majority_leader", "reset_election")}
            onVote={(id) => handleHouseLeadAction("majority_leader", "vote", id)}
            onWithdraw={() => handleHouseLeadAction("majority_leader", "withdraw")}
            onDeclare={() => handleHouseLeadAction("majority_leader", "declare")}
          />
          <HouseLeadershipRoleSection
            title="Minority Leader"
            electionState={houseLeadData?.minorityLeader}
            isMember={houseLeadData?.minorityLeader?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleHouseLeadAction("minority_leader", "start_election")}
            onForceEnd={() => handleHouseLeadAction("minority_leader", "force_end")}
            onReset={() => handleHouseLeadAction("minority_leader", "reset_election")}
            onVote={(id) => handleHouseLeadAction("minority_leader", "vote", id)}
            onWithdraw={() => handleHouseLeadAction("minority_leader", "withdraw")}
            onDeclare={() => handleHouseLeadAction("minority_leader", "declare")}
          />
          <HouseLeadershipRoleSection
            title="Majority Whip"
            electionState={houseLeadData?.majorityWhip}
            isMember={houseLeadData?.majorityWhip?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleHouseLeadAction("majority_whip", "start_election")}
            onForceEnd={() => handleHouseLeadAction("majority_whip", "force_end")}
            onReset={() => handleHouseLeadAction("majority_whip", "reset_election")}
            onVote={(id) => handleHouseLeadAction("majority_whip", "vote", id)}
            onWithdraw={() => handleHouseLeadAction("majority_whip", "withdraw")}
            onDeclare={() => handleHouseLeadAction("majority_whip", "declare")}
          />
          <HouseLeadershipRoleSection
            title="Minority Whip"
            electionState={houseLeadData?.minorityWhip}
            isMember={houseLeadData?.minorityWhip?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleHouseLeadAction("minority_whip", "start_election")}
            onForceEnd={() => handleHouseLeadAction("minority_whip", "force_end")}
            onReset={() => handleHouseLeadAction("minority_whip", "reset_election")}
            onVote={(id) => handleHouseLeadAction("minority_whip", "vote", id)}
            onWithdraw={() => handleHouseLeadAction("minority_whip", "withdraw")}
            onDeclare={() => handleHouseLeadAction("minority_whip", "declare")}
          />

          <HouseLeadershipByPartyGrid
            chamberLeaders={chamberLeaders}
            data={data}
            leadersAdmin={leadersAdmin}
            onAssign={(role) => openAssign(role, "house")}
            onClear={clearRole}
          />
        </>
      ) : (
        <>
          <SenateLeadershipRoleSection
            title="President Pro Tempore"
            electionState={senateData?.proTempore}
            isMember={senateData?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleSenateLeadershipAction("pro_tempore", "start_election")}
            onForceEnd={() => handleSenateLeadershipAction("pro_tempore", "force_end")}
            onReset={() => handleSenateLeadershipAction("pro_tempore", "reset_election")}
            onVote={(id) => handleSenateLeadershipAction("pro_tempore", "vote", id)}
            onWithdraw={() => handleSenateLeadershipAction("pro_tempore", "withdraw")}
            onDeclare={async () => {
              setSenateDeclaring(true);
              await handleSenateLeadershipAction("pro_tempore", "declare");
              setSenateDeclaring(false);
            }}
            declaring={senateDeclaring}
          />
          <SenateLeadershipRoleSection
            title="Majority Leader"
            electionState={senateData?.majorityLeader}
            isMember={senateData?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() =>
              handleSenateLeadershipAction("majority_leader", "start_election")
            }
            onForceEnd={() => handleSenateLeadershipAction("majority_leader", "force_end")}
            onReset={() => handleSenateLeadershipAction("majority_leader", "reset_election")}
            onVote={(id) => handleSenateLeadershipAction("majority_leader", "vote", id)}
            onWithdraw={() => handleSenateLeadershipAction("majority_leader", "withdraw")}
            onDeclare={() => handleSenateLeadershipAction("majority_leader", "declare")}
          />
          <SenateLeadershipRoleSection
            title="Minority Leader"
            electionState={senateData?.minorityLeader}
            isMember={senateData?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() =>
              handleSenateLeadershipAction("minority_leader", "start_election")
            }
            onForceEnd={() => handleSenateLeadershipAction("minority_leader", "force_end")}
            onReset={() => handleSenateLeadershipAction("minority_leader", "reset_election")}
            onVote={(id) => handleSenateLeadershipAction("minority_leader", "vote", id)}
            onWithdraw={() => handleSenateLeadershipAction("minority_leader", "withdraw")}
            onDeclare={() => handleSenateLeadershipAction("minority_leader", "declare")}
          />
          <SenateLeadershipRoleSection
            title="Majority Whip"
            electionState={senateData?.majorityWhip}
            isMember={senateData?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleSenateLeadershipAction("majority_whip", "start_election")}
            onForceEnd={() => handleSenateLeadershipAction("majority_whip", "force_end")}
            onReset={() => handleSenateLeadershipAction("majority_whip", "reset_election")}
            onVote={(id) => handleSenateLeadershipAction("majority_whip", "vote", id)}
            onWithdraw={() => handleSenateLeadershipAction("majority_whip", "withdraw")}
            onDeclare={() => handleSenateLeadershipAction("majority_whip", "declare")}
          />
          <SenateLeadershipRoleSection
            title="Minority Whip"
            electionState={senateData?.minorityWhip}
            isMember={senateData?.isMember ?? false}
            leadersAdmin={leadersAdmin}
            countryId={countryId}
            onStartElection={() => handleSenateLeadershipAction("minority_whip", "start_election")}
            onForceEnd={() => handleSenateLeadershipAction("minority_whip", "force_end")}
            onReset={() => handleSenateLeadershipAction("minority_whip", "reset_election")}
            onVote={(id) => handleSenateLeadershipAction("minority_whip", "vote", id)}
            onWithdraw={() => handleSenateLeadershipAction("minority_whip", "withdraw")}
            onDeclare={() => handleSenateLeadershipAction("minority_whip", "declare")}
          />

          {senateData?.senateComposition && senateData.senateComposition.length > 0 && (
            <SenateLeadershipByPartyGrid
              chamberLeaders={chamberLeaders}
              senateData={senateData}
              leadersAdmin={leadersAdmin}
              onAssign={(role) => openAssign(role, "senate")}
              onClear={clearRole}
            />
          )}
        </>
      )}

      {viewerParty && (
        <section className="mt-6 rounded-lg border border-card-border bg-card p-4">
          <h3 className="text-sm font-semibold mb-1">Whip Room</h3>
          <p className="text-xs text-muted mb-3">
            Whip your party on the leadership elections above without leaving this page.
          </p>
          <WhipTabs
            showPlayerTab
            isNational
            countryId={countryId}
            partyId={viewerParty.id}
            partyColor={viewerParty.color}
          />
        </section>
      )}

      <AssignLeaderModal
        assigningRole={assigningRole}
        roleLabel={
          chamberLeaders.find((l) => l.role === assigningRole)?.label ?? assigningRole ?? ""
        }
        chamberMembers={chamberMembers}
        assignCharacterId={assignCharacterId}
        assignLoading={assignLoading}
        onCharacterChange={setAssignCharacterId}
        onCancel={() => setAssigningRole(null)}
        onSubmit={submitAssign}
      />
    </div>
  );
}
