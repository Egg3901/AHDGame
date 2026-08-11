"use client";

import { useState } from "react";
import { partyApiUrl } from "@/lib/urls";
import { getPartyRoleLabel } from "@/lib/parties/partyRoleLabels";

type ProposalType =
  | "rename"
  | "positionShift"
  | "merge"
  | "electionMethod"
  | "electionDuration"
  | "removeOfficeHolder"
  | "transactionApprovalMode";

type TransactionApprovalMode = "single" | "double";

type RemoveRole = "chair" | "viceChair" | "committeeMember";

interface OfficerOption {
  id: string;
  name: string;
  role: RemoveRole;
  label: string;
}

const ELECTION_METHOD_OPTIONS = [
  {
    value: "party",
    label: "All members (default)",
    description: "All party members vote, one vote each",
  },
  {
    value: "committee",
    label: "Committee-only",
    description: "Only committee members and national leadership vote, one vote each",
  },
  {
    value: "influence",
    label: "Party influence weighted",
    description: "All members vote, but votes are weighted by each voter's party influence",
  },
] as const;

interface ActivePartyOption {
  id: string;
  objectId: string;
  sequentialId: number;
  name: string;
  abbreviation: string;
}

export function CreateProposalForm({
  country,
  partyId,
  countryCode,
  isChair,
  currentTransactionApprovalMode,
  onCreated,
}: {
  country: string;
  partyId: string;
  countryCode: string;
  isChair: boolean;
  currentTransactionApprovalMode: TransactionApprovalMode;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ProposalType>("rename");
  const [newName, setNewName] = useState("");
  const [newAbbreviation, setNewAbbreviation] = useState("");
  const [axis, setAxis] = useState<"economic" | "social">("economic");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [targetPartyId, setTargetPartyId] = useState("");
  const [parties, setParties] = useState<ActivePartyOption[]>([]);
  const [loadingParties, setLoadingParties] = useState(false);
  const [electionMethod, setElectionMethod] = useState<"party" | "committee" | "influence">(
    "party"
  );
  const [electionDurationTurns, setElectionDurationTurns] = useState(168);
  const [officers, setOfficers] = useState<OfficerOption[]>([]);
  const [loadingOfficers, setLoadingOfficers] = useState(false);
  const [removeOfficerId, setRemoveOfficerId] = useState<string>("");
  // For transactionApprovalMode: default the selection to the OPPOSITE of
  // whatever the party is currently in (since no-op proposals are
  // server-side rejected).
  const [txnMode, setTxnMode] = useState<TransactionApprovalMode>(
    currentTransactionApprovalMode === "double" ? "single" : "double"
  );
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  const fetchParties = async () => {
    if (parties.length > 0) return;
    setLoadingParties(true);
    try {
      const res = await fetch(`/api/country/${countryCode}/parties`);
      if (res.ok) {
        const data = await res.json();
        setParties(
          (data.parties ?? []).filter((p: ActivePartyOption) => String(p.sequentialId) !== partyId)
        );
      }
    } catch {
    } finally {
      setLoadingParties(false);
    }
  };

  const fetchOfficers = async () => {
    if (officers.length > 0) return;
    setLoadingOfficers(true);
    try {
      const res = await fetch(`${partyApiUrl(country, partyId)}`);
      if (res.ok) {
        type LeaderInfo = { id: string; name: string } | null;
        type Member = { id: string; name: string; isCommitteeMember?: boolean };
        const data = (await res.json()) as {
          chair?: LeaderInfo;
          viceChair?: LeaderInfo;
          members?: Member[];
        };
        const opts: OfficerOption[] = [];
        if (data.chair?.id) {
          opts.push({
            id: data.chair.id,
            name: data.chair.name,
            role: "chair",
            label: `${getPartyRoleLabel(countryCode, "chair")} — ${data.chair.name}`,
          });
        }
        if (data.viceChair?.id) {
          opts.push({
            id: data.viceChair.id,
            name: data.viceChair.name,
            role: "viceChair",
            label: `${getPartyRoleLabel(countryCode, "viceChair")} — ${data.viceChair.name}`,
          });
        }
        for (const m of data.members ?? []) {
          if (m.isCommitteeMember) {
            opts.push({
              id: m.id,
              name: m.name,
              role: "committeeMember",
              label: `${getPartyRoleLabel(countryCode, "committee")} — ${m.name}`,
            });
          }
        }
        setOfficers(opts);
      }
    } catch {
    } finally {
      setLoadingOfficers(false);
    }
  };

  const handleTypeChange = (t: ProposalType) => {
    setType(t);
    if (t === "merge") fetchParties();
    if (t === "removeOfficeHolder") fetchOfficers();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setMsg("");
    try {
      let body: Record<string, unknown> = { type };
      if (type === "rename") {
        body = { type, newName: newName.trim(), newAbbreviation: newAbbreviation.trim() };
      } else if (type === "positionShift") {
        body = { type, axis, direction };
      } else if (type === "merge") {
        if (!targetPartyId) {
          setMsg("Select a target party");
          setSubmitting(false);
          return;
        }
        const target = parties.find((p) => String(p.sequentialId) === targetPartyId);
        if (!target) {
          setMsg("Invalid target party");
          setSubmitting(false);
          return;
        }
        body = { type, targetPartyId: target.objectId };
      } else if (type === "electionMethod") {
        body = { type, method: electionMethod };
      } else if (type === "electionDuration") {
        if (electionDurationTurns < 168 || electionDurationTurns > 420) {
          setMsg("Duration must be between 168 and 420 turns (1–2.5 weeks)");
          setSubmitting(false);
          return;
        }
        body = { type, durationTurns: electionDurationTurns };
      } else if (type === "removeOfficeHolder") {
        if (!removeOfficerId) {
          setMsg("Select an officer to remove");
          setSubmitting(false);
          return;
        }
        const officer = officers.find((o) => o.id === removeOfficerId);
        if (!officer) {
          setMsg("Selected officer not found");
          setSubmitting(false);
          return;
        }
        body = { type, role: officer.role, targetCharacterId: officer.id };
      } else if (type === "transactionApprovalMode") {
        if (txnMode === currentTransactionApprovalMode) {
          setMsg(`Party is already in '${currentTransactionApprovalMode}' mode.`);
          setSubmitting(false);
          return;
        }
        body = { type, mode: txnMode };
      }

      const res = await fetch(`${partyApiUrl(country, partyId)}/committee/proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error ?? "Failed to create proposal");
      } else {
        setOpen(false);
        setNewName("");
        setNewAbbreviation("");
        setTargetPartyId("");
        setElectionDurationTurns(168);
        onCreated();
      }
    } catch {
      setMsg("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg border border-card-border bg-card hover:bg-card-hover text-muted hover:text-foreground transition-colors"
      >
        + New Proposal
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">New Proposal</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-muted hover:text-foreground">
          Cancel
        </button>
      </div>

      {/* Type selector */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            "rename",
            "positionShift",
            "electionMethod",
            "electionDuration",
            "removeOfficeHolder",
            "transactionApprovalMode",
            ...(isChair ? ["merge"] : []),
          ] as ProposalType[]
        ).map((t) => (
          <button
            key={t}
            onClick={() => handleTypeChange(t)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              type === t
                ? "border-primary bg-primary/10 text-primary"
                : "border-card-border text-muted hover:text-foreground"
            }`}
          >
            {t === "rename"
              ? "Rename"
              : t === "positionShift"
                ? "Position Shift"
                : t === "electionMethod"
                  ? "Election Method"
                  : t === "electionDuration"
                    ? "Election Duration"
                    : t === "removeOfficeHolder"
                      ? "Remove Officer"
                      : t === "transactionApprovalMode"
                        ? "Approval Mode"
                        : "Merge"}
          </button>
        ))}
      </div>

      {/* Rename fields */}
      {type === "rename" && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">New name</label>
            <input
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              placeholder="Party name"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">New abbreviation</label>
            <input
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              value={newAbbreviation}
              onChange={(e) => setNewAbbreviation(e.target.value)}
              maxLength={6}
              placeholder="e.g. DEM"
            />
          </div>
        </div>
      )}

      {/* Position shift fields */}
      {type === "positionShift" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "economic", label: "Economic" },
                { value: "social", label: "Social" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setAxis(opt.value)}
                className={`text-xs py-1.5 rounded border transition-colors ${
                  axis === opt.value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDirection(-1)}
              className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                direction === -1
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              Left (−1)
            </button>
            <button
              onClick={() => setDirection(1)}
              className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                direction === 1
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              Right (+1)
            </button>
          </div>
          <p className="text-xs text-muted">
            Position shifts move the selected axis by ±1 (clamped to ±5). Each axis carries its own
            336-turn cooldown after a successful shift.
          </p>
        </div>
      )}

      {/* Election method */}
      {type === "electionMethod" && (
        <div className="space-y-2">
          <label className="block text-xs text-muted">Leadership election method</label>
          {ELECTION_METHOD_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setElectionMethod(opt.value)}
              className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                electionMethod === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-card-border text-muted hover:text-foreground"
              }`}
            >
              <div className="font-medium">{opt.label}</div>
              <div className="text-muted mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      )}

      {/* Election duration */}
      {type === "electionDuration" && (
        <div className="space-y-2">
          <label className="block text-xs text-muted">
            Election duration (turns) — 168 min (1 week), 420 max (2.5 weeks)
          </label>
          <input
            type="number"
            min={168}
            max={420}
            step={1}
            className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
            value={electionDurationTurns}
            onChange={(e) => setElectionDurationTurns(Number(e.target.value))}
          />
          <p className="text-xs text-muted">
            ≈ {(electionDurationTurns / 168).toFixed(1)} week(s). Applies to new elections created
            after this proposal passes.
          </p>
        </div>
      )}

      {/* Remove Officer */}
      {type === "removeOfficeHolder" && (
        <div>
          <label className="block text-xs text-muted mb-1">Officer to remove</label>
          {loadingOfficers ? (
            <p className="text-xs text-muted">Loading officers…</p>
          ) : officers.length === 0 ? (
            <p className="text-xs text-muted">No removable officers (all seats vacant).</p>
          ) : (
            <select
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              value={removeOfficerId}
              onChange={(e) => setRemoveOfficerId(e.target.value)}
            >
              <option value="">Select officer…</option>
              {officers.map((o) => (
                <option key={`${o.role}-${o.id}`} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted mt-1">
            The target is excluded from voting on their own removal. 60% of remaining filled
            committee + leadership roles must vote yes. If a chair is removed, the vice-chair acts
            as chair until a new chair is elected or admin-appointed.
          </p>
        </div>
      )}

      {/* Transaction approval mode */}
      {type === "transactionApprovalMode" && (
        <div className="space-y-2">
          <label className="block text-xs text-muted">Treasury action approval mode</label>
          {[
            {
              value: "double" as const,
              label: "Two-person approval",
              description:
                "Send to Member and Transfer to State Party require Treasurer + Chair/VC to both approve before executing.",
            },
            {
              value: "single" as const,
              label: "Single-person approval",
              description:
                "Authorized officers can execute Send/Transfer immediately (legacy behavior).",
            },
          ].map((opt) => {
            const isCurrent = opt.value === currentTransactionApprovalMode;
            return (
              <button
                key={opt.value}
                onClick={() => !isCurrent && setTxnMode(opt.value)}
                disabled={isCurrent}
                className={`w-full text-left px-3 py-2 rounded border text-xs transition-colors ${
                  isCurrent
                    ? "border-card-border text-muted opacity-50 cursor-not-allowed"
                    : txnMode === opt.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-card-border text-muted hover:text-foreground"
                }`}
              >
                <div className="font-medium">
                  {opt.label}
                  {isCurrent && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider">current</span>
                  )}
                </div>
                <div className="text-muted mt-0.5">{opt.description}</div>
              </button>
            );
          })}
          <p className="text-xs text-muted">
            Affects future Send-to-Member and Transfer-to-State-Party actions only. Pending
            transactions already in flight finish in their original mode.
          </p>
        </div>
      )}

      {/* Merge target */}
      {type === "merge" && (
        <div>
          <label className="block text-xs text-muted mb-1">Merge into party</label>
          {loadingParties ? (
            <p className="text-xs text-muted">Loading parties…</p>
          ) : (
            <select
              className="w-full bg-background border border-card-border rounded px-3 py-1.5 text-sm"
              value={targetPartyId}
              onChange={(e) => setTargetPartyId(e.target.value)}
            >
              <option value="">Select party…</option>
              {parties.map((p) => (
                <option key={p.sequentialId} value={String(p.sequentialId)}>
                  {p.name} ({p.abbreviation})
                </option>
              ))}
            </select>
          )}
          <p className="text-xs text-muted mt-1">
            Both committees must pass for the merge to take effect.
          </p>
        </div>
      )}

      {msg && <p className="text-xs text-red-400">{msg}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Proposal"}
      </button>
    </div>
  );
}
