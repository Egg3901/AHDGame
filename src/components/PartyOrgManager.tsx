"use client";

import { useState, useEffect, useCallback } from "react";
import { Skeleton, Slider } from "@/components/ui";
import { getMessageStyle } from "@/lib/utils/formatters";
import { US_STATES } from "@/lib/constants";
import { getOrgLabel, getOrgBarColor } from "@/lib/utils/partyOrg";

interface Party {
  _id: string;
  sequentialId: number;
  name: string;
  abbreviation: string;
  color: string;
}

interface PartyOrgData {
  _id: string;
  stateId: string;
  partyId: string;
  organization: number;
}

export function PartyOrgManager() {
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedState, setSelectedState] = useState("");
  const [, setPartyOrgData] = useState<PartyOrgData[]>([]);
  const [editData, setEditData] = useState<Record<string, { organization: number }>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Fetch parties on mount
  useEffect(() => {
    fetchParties();
  }, []);

  const fetchPartyOrg = useCallback(
    async (stateId: string) => {
      setLoading(true);
      setMessage("");
      try {
        const res = await fetch(`/api/admin/party-org?state=${stateId}`);
        if (res.ok) {
          const data = await res.json();
          setPartyOrgData(data.partyOrg || []);

          // Initialize edit data
          const initialEdit: Record<string, { organization: number }> = {};
          for (const po of data.partyOrg || []) {
            initialEdit[po.partyId] = { organization: po.organization };
          }
          setEditData(initialEdit);
        }
      } catch (error) {
        console.error("Failed to fetch party org:", error);
        setMessage("Failed to load party org data");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parties]
  );

  // Fetch party org when state changes
  useEffect(() => {
    if (selectedState) {
      fetchPartyOrg(selectedState);
    } else {
      setPartyOrgData([]);
      setEditData({});
    }
  }, [selectedState, fetchPartyOrg]);

  const fetchParties = async () => {
    try {
      const res = await fetch("/api/admin/party-org");
      if (res.ok) {
        const data = await res.json();
        setParties(data.parties || []);
      }
    } catch (error) {
      console.error("Failed to fetch parties:", error);
    }
  };

  const handleSave = async (partyId: string) => {
    if (!selectedState || !editData[partyId]) return;

    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/party-org", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateId: selectedState,
          // PartyOrgManager is the US admin tool (US_STATES drives the selector).
          countryId: "US",
          partyId,
          organization: editData[partyId].organization,
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setMessage(`${data.message}`);
        await fetchPartyOrg(selectedState);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage("Error: Network error");
    } finally {
      setLoading(false);
    }
  };

  const handleEditChange = (partyId: string, value: number) => {
    setEditData((prev) => ({
      ...prev,
      [partyId]: { ...prev[partyId], organization: value },
    }));
  };

  // Sort parties: major parties first (sequentialId 1, 2), then others alphabetically
  const sortedParties = [...parties].sort((a, b) => {
    const aOrder = a.sequentialId <= 2 ? a.sequentialId : 99;
    const bOrder = b.sequentialId <= 2 ? b.sequentialId : 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="mb-6 text-sm text-muted">
          Manage party strength in each state. Organization (0-100) is the state-party&apos;s share
          of the statewide Org pool. It determines campaign effectiveness and candidate
          availability.
        </p>

        {/* State Selector */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium">Select State</label>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm w-48"
          >
            <option value="">-- Select State --</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {/* Message */}
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
        )}

        {loading && (
          <div className="min-h-64 space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-card-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-8 w-16" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-7 w-16" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Party Org Editor */}
        {selectedState && !loading && (
          <div className="space-y-4">
            {sortedParties.map((party) => {
              const currentData = editData[String(party.sequentialId)];
              if (!currentData) return null;
              const orgLabel = getOrgLabel(currentData.organization);

              return (
                <div
                  key={String(party.sequentialId)}
                  className="rounded-lg border border-card-border p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-4 w-4 rounded-full"
                        style={{ backgroundColor: party.color }}
                      />
                      <span className="font-medium">{party.name}</span>
                      <span className="text-sm text-muted">({party.abbreviation})</span>
                    </div>
                    <button
                      onClick={() => handleSave(String(party.sequentialId))}
                      disabled={loading}
                      className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm text-muted">Organization</label>
                      <span className={`text-sm font-medium ${orgLabel.color}`}>
                        {orgLabel.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={0}
                        max={100}
                        value={currentData.organization}
                        onChange={(e) =>
                          handleEditChange(String(party.sequentialId), parseInt(e.target.value))
                        }
                        variant="primary"
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={currentData.organization}
                        onChange={(e) =>
                          handleEditChange(
                            String(party.sequentialId),
                            parseInt(e.target.value) || 0
                          )
                        }
                        className="w-16 rounded border border-card-border bg-background px-2 py-1 text-center text-sm"
                      />
                    </div>
                    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-background">
                      <div
                        className={`h-full rounded-full transition-all ${getOrgBarColor(currentData.organization)}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, currentData.organization))}%`,
                        }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-muted">{currentData.organization}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!selectedState && !loading && (
          <p className="py-8 text-center text-muted">Select a state to manage party organization</p>
        )}
      </div>
    </div>
  );
}
