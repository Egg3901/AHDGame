"use client";

import { useState, useEffect, useCallback } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";
import { regionPartyUrl, partyUrl } from "@/lib/urls";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";

type PartyElectionStatus = "voting" | "completed" | "cancelled";
type ElectionType = "state" | "national" | "committee";

interface PartyElectionRow {
  id: string;
  electionType: ElectionType;
  countryId: CountryId;
  stateId: string | null;
  partyId: string;
  partyName: string;
  position: string;
  positionLabel: string;
  status: PartyElectionStatus;
  startTurn: number;
  endTurn: number;
  durationTurns: number;
  turnsRemaining: number;
  candidateCount: number;
  totalVotes: number;
}

const STATUS_COLOR: Record<PartyElectionStatus, string> = {
  voting: "text-green-400 bg-green-500/10",
  completed: "text-muted bg-card-border",
  cancelled: "text-red-400 bg-red-500/10",
};

const TYPE_COLOR: Record<ElectionType, string> = {
  state: "text-blue-400 bg-blue-500/10",
  national: "text-purple-400 bg-purple-500/10",
  committee: "text-green-400 bg-green-500/10",
};

export function PartyElectionsPanel() {
  const registered = useRegisteredCountries();
  const [rows, setRows] = useState<PartyElectionRow[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterParty, setFilterParty] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [filterStatus, setFilterStatus] = useState("voting");
  const [filterType, setFilterType] = useState("all");
  const [createDuration, setCreateDuration] = useState(72);
  const [includeNational, setIncludeNational] = useState(true);
  const [includeCommittee, setIncludeCommittee] = useState(true);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filterState) qs.set("state", filterState);
      if (filterParty) qs.set("party", filterParty);
      if (filterPosition) qs.set("position", filterPosition);
      if (filterStatus) qs.set("status", filterStatus);
      if (filterType) qs.set("type", filterType);
      // Empty filterCountry ("All Countries") → "all"; the endpoint treats that as
      // a cross-country view. (Was a `?? "us"` bug that produced an empty country
      // code and a 400, which the panel then rendered as "no elections".)
      const countryCode = (filterCountry || "all").toLowerCase();
      const res = await fetch(`/api/admin/country/${countryCode}/state-party-elections?${qs}`);
      const data = await res.json();
      if (res.ok) {
        setRows(data.elections ?? []);
        setCurrentTurn(data.currentTurn ?? 0);
        setMessage("");
      } else {
        setRows([]);
        setMessage(`✗ Failed to load elections: ${data?.error ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setRows([]);
      setMessage("✗ Failed to load elections (network error)");
    } finally {
      setLoading(false);
    }
  }, [filterCountry, filterState, filterParty, filterPosition, filterStatus, filterType]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const batchAction = async (action: "batch-resolve" | "batch-create" | "batch-restart") => {
    const scopeText = `${includeNational ? " + national" : ""}${includeCommittee ? " + committee" : ""}`;
    // Make the country scope explicit — an empty filter means EVERY country, and
    // batch actions (especially restart) are destructive across all of them.
    const countryScope = filterCountry ? filterCountry : "ALL COUNTRIES";
    let confirmMsg = "";
    if (action === "batch-resolve") {
      confirmMsg = `Force-resolve all elections whose endTurn <= currentTurn (${countryScope}: state${scopeText})?`;
    } else if (action === "batch-create") {
      confirmMsg = `Create missing elections for all party x position combos (${createDuration} turns each, ${countryScope}: state${scopeText})?`;
    } else if (action === "batch-restart") {
      confirmMsg = `⚠️ RESTART ALL ELECTIONS — ${countryScope} ⚠️\n\nThis will:\n• Cancel ALL voting elections (${countryScope}: state${scopeText})\n• Withdraw ALL active candidates\n• Create NEW elections (${createDuration} turns each)\n\nThis is destructive and cannot be undone. Continue?`;
    }
    if (!confirm(confirmMsg)) return;
    setLoading(true);
    setMessage("");
    try {
      const postBase = `/api/admin/country/${(filterCountry || "all").toLowerCase()}/state-party-elections`;
      const res = await fetch(postBase, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          durationTurns: createDuration,
          includeNational,
          includeCommittee,
        }),
      });
      const data = await res.json();
      setMessage(res.ok ? `✓ ${data.message}` : `✗ ${data.error ?? "Failed"}`);
      if (res.ok) await fetchRows();
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  };

  const cancelElection = async (id: string, label: string) => {
    if (!confirm(`Cancel the ${label} election?`)) return;
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch(`/api/admin/state-party-elections/${id}`, { method: "DELETE" });
      const data = await res.json();
      setMessage(res.ok ? `✓ ${data.message}` : `✗ ${data.error}`);
      if (res.ok) await fetchRows();
    } catch {
      setMessage("✗ Network error");
    } finally {
      setLoading(false);
    }
  };

  const active = rows.filter((r) => r.status === "voting").length;
  const endingSoon = rows.filter((r) => r.status === "voting" && r.turnsRemaining <= 24).length;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Active Elections", value: active, color: "text-green-400" },
          { label: "Ending ≤ 24 Turns", value: endingSoon, color: "text-yellow-400" },
          { label: "Current Turn", value: currentTurn, color: "text-primary" },
          { label: "Shown", value: rows.length, color: "text-muted" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-card-border bg-card p-4 text-center"
          >
            <div className="text-xs text-muted mb-1">{s.label}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {message && (
        <div className={`rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
      )}

      {/* Batch actions */}
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
        <h3 className="font-semibold">Batch Actions</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-muted block mb-1">
              Duration for new elections (turns)
            </label>
            <input
              type="number"
              min={1}
              value={createDuration}
              onChange={(e) => setCreateDuration(parseInt(e.target.value) || 72)}
              className="w-28 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeNational}
                onChange={(e) => setIncludeNational(e.target.checked)}
                className="rounded border-card-border"
              />
              <span className="text-xs text-muted">Include National</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeCommittee}
                onChange={(e) => setIncludeCommittee(e.target.checked)}
                className="rounded border-card-border"
              />
              <span className="text-xs text-muted">Include Committee</span>
            </label>
          </div>
          <button
            onClick={() => batchAction("batch-create")}
            disabled={loading}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
          >
            Create Missing
          </button>
          <button
            onClick={() => batchAction("batch-resolve")}
            disabled={loading}
            className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Process Now
          </button>
          <button
            onClick={() => batchAction("batch-restart")}
            disabled={loading}
            className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/20 disabled:opacity-50"
          >
            Restart All
          </button>
        </div>
        <p className="text-xs text-muted/60">
          <strong>Create Missing</strong> — generates elections for any party × position combo with
          no active election.
          <br />
          <strong>Process Now</strong> — force-resolves all elections whose end turn ≤ current turn.
          <br />
          <strong>Restart All</strong> — cancels all voting elections, withdraws all candidates, and
          creates new elections.
          <br />
          <strong>Include National</strong> — batch actions include national party leadership
          elections (Chair, Vice Chair, Treasurer).
          <br />
          <strong>Include Committee</strong> — batch actions include national committee elections.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
        <h3 className="font-semibold">Filter</h3>
        <div className="flex flex-wrap gap-3">
          <select
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="w-24 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All Countries</option>
            {registered.map((id) => (
              <option key={id} value={id}>
                {COUNTRY_CONFIGS[id].name}
              </option>
            ))}
          </select>
          <input
            placeholder="State/Region"
            value={filterState}
            onChange={(e) => setFilterState(e.target.value.toUpperCase())}
            className="w-28 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          <input
            placeholder="Party Name"
            value={filterParty}
            onChange={(e) => setFilterParty(e.target.value)}
            className="w-40 rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="all">All Types</option>
            <option value="state">State</option>
            <option value="national">National</option>
            <option value="committee">Committee</option>
          </select>
          <select
            value={filterPosition}
            onChange={(e) => setFilterPosition(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All Positions</option>
            <option value="chair">Chair</option>
            <option value="viceChair">Vice Chair</option>
            <option value="treasurer">Treasurer</option>
            <option value="committee">Committee</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="voting">Voting</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            onClick={fetchRows}
            disabled={loading}
            className="rounded-lg border border-card-border bg-background px-4 py-2 text-sm hover:text-foreground disabled:opacity-50"
          >
            {loading ? "…" : "Search"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left">
                {[
                  "Type",
                  "Country",
                  "State/Region",
                  "Party",
                  "Position",
                  "Status",
                  "Candidates",
                  "Votes",
                  "Turn Start",
                  "Turn End",
                  "Turns Left",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-xs font-medium text-muted whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-card-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-4 py-8 text-center text-muted text-sm">
                    {loading ? "Loading…" : "No elections found"}
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-foreground/[0.03]">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLOR[row.electionType]}`}
                    >
                      {row.electionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{row.countryId}</td>
                  <td className="px-4 py-3 text-muted">{row.stateId ?? "—"}</td>
                  <td className="px-4 py-3">{row.partyName}</td>
                  <td className="px-4 py-3">{row.positionLabel}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{row.candidateCount}</td>
                  <td className="px-4 py-3 tabular-nums">{row.totalVotes}</td>
                  <td className="px-4 py-3 tabular-nums text-muted">{row.startTurn}</td>
                  <td className="px-4 py-3 tabular-nums text-muted">{row.endTurn}</td>
                  <td
                    className={`px-4 py-3 tabular-nums font-medium ${
                      row.status !== "voting"
                        ? "text-muted"
                        : row.turnsRemaining <= 12
                          ? "text-red-400"
                          : row.turnsRemaining <= 24
                            ? "text-yellow-400"
                            : "text-foreground"
                    }`}
                  >
                    {row.status === "voting" ? row.turnsRemaining : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {row.electionType === "state" && row.stateId ? (
                        <a
                          href={regionPartyUrl(row.countryId, row.stateId, row.partyId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <a
                          href={partyUrl(row.countryId, row.partyId)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View
                        </a>
                      )}
                      {row.status === "voting" && (
                        <button
                          onClick={() =>
                            cancelElection(
                              row.id,
                              `${row.countryId} ${row.stateId ?? "National"} ${row.partyName} ${row.positionLabel}`
                            )
                          }
                          disabled={loading}
                          className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
