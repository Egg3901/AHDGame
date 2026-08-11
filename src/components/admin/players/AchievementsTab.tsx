"use client";

import { useState, useEffect } from "react";
import { AchievementIcon } from "@/lib/utils/achievementIcons";

interface AchievementRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  triggerType: string;
  order: number;
  earnedCount: number;
}

interface CharacterOption {
  id: string;
  name: string;
}

type ActionTab = "grant" | "revoke" | "bulk";

interface AchievementsTabProps {
  context?: "admin" | "moderator";
}

export function AchievementsTab({ context = "admin" }: AchievementsTabProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const [achievements, setAchievements] = useState<AchievementRow[]>([]);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<ActionTab>("grant");
  const [grantCharacterId, setGrantCharacterId] = useState("");
  const [grantSlug, setGrantSlug] = useState("");
  const [revokeCharacterId, setRevokeCharacterId] = useState("");
  const [revokeSlug, setRevokeSlug] = useState("");
  const [bulkSlug, setBulkSlug] = useState("alpha_tester");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [seedLoading, setSeedLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [achRes, charRes] = await Promise.all([
        fetch(`${apiBase}/achievements`),
        fetch(`${apiBase}/users`),
      ]);
      const achData = await achRes.json();
      const charData = await charRes.json();
      if (achRes.ok) setAchievements(achData.achievements ?? []);
      if (charRes.ok) {
        const chars = (charData.users ?? [])
          .filter((u: { characterId: string | null }) => u.characterId)
          .map((u: { characterId: string; characterName: string }) => ({
            id: u.characterId,
            name: u.characterName,
          }));
        setCharacters(chars);
      }
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantCharacterId || !grantSlug) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`${apiBase}/achievements/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: grantCharacterId, achievementSlug: grantSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message, ok: true });
        fetchData();
      } else {
        setActionMsg({ text: data.error ?? "Failed", ok: false });
      }
    } catch {
      setActionMsg({ text: "Network error", ok: false });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!revokeCharacterId || !revokeSlug) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`${apiBase}/achievements/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: revokeCharacterId, achievementSlug: revokeSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message, ok: true });
        fetchData();
      } else {
        setActionMsg({ text: data.error ?? "Failed", ok: false });
      }
    } catch {
      setActionMsg({ text: "Network error", ok: false });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirm(`Grant "${bulkSlug}" to ALL characters?`)) return;
    setActionLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`${apiBase}/achievements/bulk-grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ achievementSlug: bulkSlug }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMsg({ text: data.message, ok: true });
        fetchData();
      } else {
        setActionMsg({ text: data.error ?? "Failed", ok: false });
      }
    } catch {
      setActionMsg({ text: "Network error", ok: false });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSyncNames = async () => {
    setSyncLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`${apiBase}/achievements/seed`, { method: "PATCH" });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMsg({ text: data.message, ok: true });
        fetchData();
      } else {
        setActionMsg({ text: data.message ?? data.error ?? "Sync failed", ok: false });
      }
    } catch {
      setActionMsg({ text: "Network error", ok: false });
    } finally {
      setSyncLoading(false);
    }
  };

  const handleSeedAchievements = async () => {
    setSeedLoading(true);
    setActionMsg(null);
    try {
      const res = await fetch(`${apiBase}/achievements/seed`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMsg({ text: data.message, ok: true });
        fetchData();
      } else {
        setActionMsg({ text: data.message ?? data.error ?? "Seed failed", ok: false });
      }
    } catch {
      setActionMsg({ text: "Network error", ok: false });
    } finally {
      setSeedLoading(false);
    }
  };

  if (loading) return <p className="text-muted">Loading...</p>;
  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-6">
      {/* Seed button */}
      <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <div>
          <p className="text-sm font-medium">Seed Achievement Definitions</p>
          <p className="mt-0.5 text-xs text-muted">
            Creates all achievement definitions from seed data (only when collection is empty)
          </p>
        </div>
        <button
          type="button"
          onClick={handleSeedAchievements}
          disabled={seedLoading}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {seedLoading ? "Seeding..." : "Seed All"}
        </button>
        <button
          type="button"
          onClick={handleSyncNames}
          disabled={syncLoading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
        >
          {syncLoading ? "Syncing..." : "Sync Names"}
        </button>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div
          className={`rounded-lg p-3 text-sm ${actionMsg.ok ? "bg-green-500/10 border border-green-500/30 text-green-400" : "bg-red-500/10 border border-red-500/30 text-red-400"}`}
        >
          {actionMsg.text}
        </div>
      )}

      {/* Action forms */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        {/* Tab buttons */}
        <div className="flex border-b border-card-border bg-background">
          {[
            { id: "grant" as const, label: "Grant to Character" },
            { id: "revoke" as const, label: "Revoke from Character" },
            { id: "bulk" as const, label: "Bulk Grant to All" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-b-2 border-primary bg-card text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Form content */}
        <div className="p-6">
          {activeTab === "grant" && (
            <form onSubmit={handleGrant} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Character</label>
                <select
                  value={grantCharacterId}
                  onChange={(e) => setGrantCharacterId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select character</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Achievement</label>
                <select
                  value={grantSlug}
                  onChange={(e) => setGrantSlug(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select achievement</option>
                  {achievements.map((a) => (
                    <option key={a.id} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={actionLoading || !grantCharacterId || !grantSlug}
                className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
              >
                Grant Achievement
              </button>
            </form>
          )}

          {activeTab === "revoke" && (
            <form onSubmit={handleRevoke} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Character</label>
                <select
                  value={revokeCharacterId}
                  onChange={(e) => setRevokeCharacterId(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select character</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Achievement</label>
                <select
                  value={revokeSlug}
                  onChange={(e) => setRevokeSlug(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select achievement</option>
                  {achievements.map((a) => (
                    <option key={a.id} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={actionLoading || !revokeCharacterId || !revokeSlug}
                className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Revoke Achievement
              </button>
            </form>
          )}

          {activeTab === "bulk" && (
            <form onSubmit={handleBulkGrant} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Achievement</label>
                <select
                  value={bulkSlug}
                  onChange={(e) => setBulkSlug(e.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {achievements.map((a) => (
                    <option key={a.id} value={a.slug}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-400">
                ⚠ This will grant the selected achievement to{" "}
                <strong>all {characters.length} characters</strong>.
              </div>
              <button
                type="submit"
                disabled={actionLoading}
                className="w-full rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                Grant to All Characters
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Achievement list */}
      <div className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="border-b border-card-border bg-background px-4 py-3">
          <h3 className="font-semibold">All Achievements</h3>
          <p className="mt-0.5 text-xs text-muted">
            {achievements.length} total achievement{achievements.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card/50">
                <th className="px-4 py-3 text-left font-medium">Icon</th>
                <th className="px-4 py-3 text-left font-medium">Name</th>
                <th className="px-4 py-3 text-left font-medium">Slug</th>
                <th className="px-4 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-right font-medium">Earned</th>
              </tr>
            </thead>
            <tbody>
              {achievements.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-card-border/50 hover:bg-background/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <AchievementIcon name={a.icon} className="h-5 w-5 text-muted" />
                  </td>
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{a.slug}</td>
                  <td className="px-4 py-3 capitalize text-muted">{a.category}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {a.earnedCount}
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
