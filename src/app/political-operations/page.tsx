"use client";

import { useEffect, useState } from "react";
import { Skeleton, TabRowSkeleton } from "@/components/ui";
import {
  PoliticalOperationsTabs,
  type PoliticalOperationsTab,
} from "./components/PoliticalOperationsTabs";
import { PresidentialElectionPanel } from "./components/PresidentialElectionPanel";

interface PageData {
  character: { _id: string; name: string; countryId: string; homeState: string };
  activePresidentialCandidacy: {
    electionId: string;
    candidateId: string;
    campaignId: string;
  } | null;
}

export default function PoliticalOperationsPage() {
  const [activeTab, setActiveTab] = useState<PoliticalOperationsTab>("overview");
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    fetch("/api/political-operations/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) setForbidden(true);
        else setData(d);
        setLoading(false);
      })
      .catch(() => {
        setForbidden(true);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-4 space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <TabRowSkeleton count={2} />
        <div className="mt-6 space-y-3 min-h-[160px]">
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-4 w-3/4 max-w-md" />
        </div>
      </div>
    );
  }
  if (forbidden || !data) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Political Operations</h1>
        <p className="mt-4 text-muted">
          Political Operations is currently available only to US characters.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Political Operations</h1>
        <p className="text-sm text-muted">{data.character.name}</p>
      </header>
      <PoliticalOperationsTabs activeTab={activeTab} onChange={setActiveTab} />
      <main className="mt-6">
        {activeTab === "overview" && (
          <div>
            <p className="text-muted">
              Build Campaign Presence, manage your active campaign, and watch your political
              footprint grow across cycles.
            </p>
            {data.activePresidentialCandidacy ? (
              <p className="mt-3 text-sm text-foreground">
                You are an active candidate in a presidential election.
              </p>
            ) : (
              <p className="mt-3 text-sm text-muted">
                You are not currently a candidate in any eligible election.
              </p>
            )}
          </div>
        )}
        {activeTab === "presidentialElection" && (
          <PresidentialElectionPanel
            activePresidentialCandidacy={data.activePresidentialCandidacy}
          />
        )}
      </main>
    </div>
  );
}
