"use client";

import { useState } from "react";

interface StateElectionIssue {
  _id: string;
  type: "state";
  stateId: string;
  partyId: string;
  position: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
}

interface NationalElectionIssue {
  _id: string;
  type: "national";
  partyId: string;
  countryId: string;
  position: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
  hasCountryId: boolean;
}

interface CommitteeElectionIssue {
  _id: string;
  type: "committee";
  partyId: string;
  countryId: string;
  status: string;
  hasStartTurn: boolean;
  hasEndTurn: boolean;
  hasDurationTurns: boolean;
  hasCountryId: boolean;
}

type ElectionIssue = StateElectionIssue | NationalElectionIssue | CommitteeElectionIssue;

interface DiagnosticResult {
  status: string;
  stateIssueCount: number;
  nationalIssueCount: number;
  committeeIssueCount: number;
  totalIssueCount: number;
  currentTurn: number;
  elections: ElectionIssue[];
  message: string;
}

export function HealPartyElections() {
  const [loading, setLoading] = useState(false);
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const runDiagnostic = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-elections");
      const data = await res.json();
      if (res.ok) {
        setDiagnostic(data);
      } else {
        setResult({ ok: false, message: data.error ?? "Diagnostic failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const runHeal = async () => {
    if (
      !confirm(
        "This will add missing fields (startTurn, endTurn, durationTurns, countryId) to state and national party elections.\n\nContinue?"
      )
    )
      return;

    setLoading(true);
    setDiagnostic(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/heal/party-elections", { method: "POST" });
      const data = await res.json();
      setResult({ ok: res.ok, message: data.message ?? data.error ?? "Unknown response" });
    } catch {
      setResult({ ok: false, message: "Network error" });
    } finally {
      setLoading(false);
    }
  };

  const getMissingFields = (e: ElectionIssue): string[] => {
    const fields: string[] = [];
    if (!e.hasStartTurn) fields.push("startTurn");
    if (!e.hasEndTurn) fields.push("endTurn");
    if (!e.hasDurationTurns) fields.push("durationTurns");
    if ((e.type === "national" || e.type === "committee") && !e.hasCountryId)
      fields.push("countryId");
    return fields;
  };

  const getTypeColor = (type: string): string => {
    switch (type) {
      case "state":
        return "bg-blue-500/10 text-blue-400";
      case "national":
        return "bg-purple-500/10 text-purple-400";
      case "committee":
        return "bg-green-500/10 text-green-400";
      default:
        return "bg-gray-500/10 text-gray-400";
    }
  };

  const getPosition = (e: ElectionIssue): string => {
    if (e.type === "committee") return "committee";
    return e.position;
  };

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm">Heal Party Elections</h3>
        <p className="mt-1 text-xs text-muted">
          Fixes state, national, and committee party elections missing required fields (startTurn,
          endTurn, durationTurns, countryId). Elections without these fields display incorrectly or
          cause cross-country conflicts.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runDiagnostic}
          disabled={loading}
          className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
        >
          {loading ? "Running..." : "Diagnose"}
        </button>
        <button
          onClick={runHeal}
          disabled={loading}
          className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning transition-colors hover:bg-warning/20 disabled:opacity-50"
        >
          {loading ? "Healing..." : "Heal Now"}
        </button>
      </div>

      {diagnostic && (
        <div className="rounded-lg border border-card-border bg-background p-3 space-y-2 text-xs">
          {diagnostic.status === "ok" ? (
            <p className="text-success">{diagnostic.message}</p>
          ) : (
            <>
              <p className="font-medium text-warning">{diagnostic.message}</p>
              <div className="flex gap-4 text-muted">
                <span>Current turn: {diagnostic.currentTurn}</span>
                <span>State: {diagnostic.stateIssueCount}</span>
                <span>National: {diagnostic.nationalIssueCount}</span>
                <span>Committee: {diagnostic.committeeIssueCount}</span>
              </div>
              {diagnostic.elections.length > 0 && (
                <div className="mt-2 max-h-48 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted border-b border-card-border">
                        <th className="pb-1">Type</th>
                        <th className="pb-1">Location</th>
                        <th className="pb-1">Party</th>
                        <th className="pb-1">Position</th>
                        <th className="pb-1">Status</th>
                        <th className="pb-1">Missing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-card-border/50">
                      {diagnostic.elections.map((e) => (
                        <tr key={e._id}>
                          <td className="py-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${getTypeColor(e.type)}`}
                            >
                              {e.type}
                            </span>
                          </td>
                          <td className="py-1">{e.type === "state" ? e.stateId : e.countryId}</td>
                          <td className="py-1">{e.partyId}</td>
                          <td className="py-1">{getPosition(e)}</td>
                          <td className="py-1">{e.status}</td>
                          <td className="py-1 text-error">{getMissingFields(e).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {diagnostic.totalIssueCount > 30 && (
                    <p className="mt-2 text-muted italic">
                      Showing first 30 of {diagnostic.totalIssueCount} elections
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {result && (
        <p className={`text-xs font-medium ${result.ok ? "text-success" : "text-error"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}
