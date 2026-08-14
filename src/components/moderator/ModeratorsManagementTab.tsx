"use client";

import { useState, useEffect, useCallback } from "react";
import { PlayerSelector } from "@/components/PlayerSelector";
import { LocalTime } from "@/components/time/LocalTime";

interface Moderator {
  userId: string;
  username: string;
  email: string;
  moderatorSince: string;
  characterName: string | null;
}

export function ModeratorsManagementTab() {
  const [moderators, setModerators] = useState<Moderator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<{
    userId: string;
    username: string;
  } | null>(null);
  const [assigning, setAssigning] = useState(false);

  const fetchModerators = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/moderators");
      if (!res.ok) throw new Error("Failed to fetch moderators");
      const data = await res.json();
      setModerators(data.moderators);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load moderators");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModerators();
  }, [fetchModerators]);

  const handleAssign = async () => {
    if (!selectedUser) return;
    setAssigning(true);
    setError("");
    try {
      const res = await fetch("/api/admin/moderators/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUser.userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to assign moderator");
      } else {
        setSelectedUser(null);
        setError("");
        fetchModerators();
      }
    } catch {
      setError("Failed to assign moderator");
    } finally {
      setAssigning(false);
    }
  };

  const handleRemove = async (userId: string, username: string) => {
    if (!confirm(`Remove moderator role from ${username}?`)) return;
    setError("");
    try {
      const res = await fetch("/api/admin/moderators/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to remove moderator");
      } else {
        fetchModerators();
      }
    } catch {
      setError("Failed to remove moderator");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-card-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold">Assign Moderator</h3>
        <div className="flex gap-2">
          {selectedUser ? (
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm">
                <span className="font-medium">{selectedUser.username}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="rounded-md border border-card-border bg-card px-3 py-2 text-xs text-muted hover:text-foreground"
              >
                Clear
              </button>
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {assigning ? "Assigning..." : "Assign"}
              </button>
            </div>
          ) : (
            <PlayerSelector
              onSelect={(char) => {
                setSelectedUser({ userId: char.userId ?? char.id, username: char.name });
                setError("");
              }}
              placeholder="Search by username, character, or discord name..."
              className="flex-1"
            />
          )}
        </div>
        {error && <p className="mt-2 text-sm text-error">{error}</p>}
      </div>

      <div className="rounded-lg border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-3">
          <h3 className="text-sm font-semibold">Current Moderators ({moderators.length})</h3>
        </div>
        {moderators.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No moderators assigned</p>
        ) : (
          <div className="divide-y divide-card-border">
            {moderators.map((mod) => (
              <div key={mod.userId} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="font-medium">{mod.username}</span>
                  {mod.characterName && (
                    <span className="ml-2 text-sm text-muted">({mod.characterName})</span>
                  )}
                  <span className="ml-3 text-xs text-muted">
                    Since <LocalTime value={mod.moderatorSince} options={{ dateStyle: "medium" }} />
                  </span>
                </div>
                <button
                  onClick={() => handleRemove(mod.userId, mod.username)}
                  className="rounded-lg bg-error/10 px-3 py-1.5 text-xs font-medium text-error transition-colors hover:bg-error/20"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
