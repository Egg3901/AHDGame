"use client";

import { useState, useEffect, useCallback } from "react";
import { getLatestNoteText, type RetiredCharacterEntry, type UserData } from "./types";
import { getDuplicateGroups } from "./duplicateGroups";
import { UsersToolbar } from "./UsersToolbar";
import { UsersTable } from "./UsersTable";
import { DuplicateGroupsView } from "./DuplicateGroupsView";
import { RetiredCharactersModal } from "./RetiredCharactersModal";
import { ModNoteModal } from "./ModNoteModal";

interface UsersTabProps {
  context?: "admin" | "moderator";
}

export function UsersTab({ context = "admin" }: UsersTabProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const isModeratorContext = context === "moderator";
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());

  const USERS_PER_PAGE = 25;
  const GROUPS_PER_PAGE = 10;

  // Reset to page 1 whenever the active filter/search changes.
  useEffect(() => {
    setPage(1);
    setExpandedGroups(new Set());
  }, [searchTerm, showDuplicatesOnly]);

  const toggleGroup = (idx: number) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };
  // userId -> timestamp of last ban action; enforces 1-minute client cooldown
  const [banCooldowns, setBanCooldowns] = useState<Map<string, number>>(new Map());

  const isBanOnCooldown = (userId: string) => {
    const last = banCooldowns.get(userId);
    return last !== undefined && Date.now() - last < 60_000;
  };

  const recordBanAction = (userId: string) => {
    setBanCooldowns((prev) => new Map(prev).set(userId, Date.now()));
  };

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/users`);
      const data = await res.json();
      if (res.ok) setUsers(data.users);
      else setError(data.error || "Failed to fetch users");
    } catch {
      setError("Network error - please try again");
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleResetPassword = async (userId: string, username: string) => {
    const newPassword = prompt(`Enter new password for ${username}:\n(minimum 8 characters)`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    if (!confirm(`Reset password for ${username}?`)) return;
    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword }),
      });
      const data = await res.json();
      if (res.ok) alert(`Password reset for ${username}`);
      else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const handleResetMovement = async (userId: string, username: string) => {
    if (
      !confirm(`Clear movement cooldown for ${username}? This allows them to relocate immediately.`)
    )
      return;
    try {
      const res = await fetch("/api/admin/users/reset-movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) alert(data.message);
      else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const handleResetFoundingCooldown = async (userId: string, username: string) => {
    if (
      !confirm(
        `Clear the corporation-founding cooldown for ${username}? This lets them found a corporation immediately.\n\nThe cooldown is per-account on purpose — it blocks the found → drain → abandon → reroll loop. Granting it on a live world hands that back.`
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/users/reset-founding-cooldown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) alert(data.message);
      else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const handleBanUser = async (userId: string, username: string, currentlyBanned: boolean) => {
    if (isBanOnCooldown(userId)) {
      alert("Please wait 1 minute before performing another ban action on this user.");
      return;
    }
    const reason = currentlyBanned
      ? null
      : prompt(`Reason for banning ${username}:`, "Violation of rules");
    if (!currentlyBanned && reason === null) return;
    if (!confirm(`${currentlyBanned ? "Unban" : "Ban"} ${username}?`)) return;
    try {
      const res = await fetch(`${apiBase}/users/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ban: !currentlyBanned, reason }),
      });
      const data = await res.json();
      if (res.ok) {
        recordBanAction(userId);
        alert(data.message);
        fetchUsers();
      } else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    if (
      !confirm(
        `PERMANENTLY DELETE ${username}?\n\nDeletes account, character, offices, and logs.\n\nCANNOT be undone!`
      )
    )
      return;
    if (prompt(`Type "${username}" to confirm:`) !== username) {
      alert("Cancelled.");
      return;
    }
    try {
      const res = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchUsers();
      } else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const handleRetireCharacter = async (userId: string, username: string) => {
    if (
      !confirm(
        `Retire ${username}'s active character?\n\nThis will snapshot the character and remove them from all offices, elections, and parties.\n\nThe user can create a new character afterward.`
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/users/retire-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Character retired successfully");
        fetchUsers();
      } else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const [retiredModal, setRetiredModal] = useState<{
    userId: string;
    username: string;
    characters: RetiredCharacterEntry[];
  } | null>(null);
  const [retiredLoading, setRetiredLoading] = useState(false);

  const [noteModal, setNoteModal] = useState<{
    userId: string;
    username: string;
    note: string;
    existingNote?: string | null;
  } | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  const handleOpenNote = (user: UserData) => {
    const existingNote = getLatestNoteText(user);
    setNoteModal({
      userId: user.id,
      username: user.username,
      note: isModeratorContext ? "" : existingNote || "",
      existingNote,
    });
  };

  const handleSaveNote = async () => {
    if (!noteModal) return;
    const trimmedNote = noteModal.note.trim();
    setNoteSaving(true);
    try {
      if (isModeratorContext && !trimmedNote) {
        alert("Enter a note before saving.");
        return;
      }
      const res = await fetch(
        isModeratorContext ? "/api/moderator/users/mod-notes" : "/api/admin/users/mod-note",
        {
          method: isModeratorContext ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isModeratorContext
              ? { userId: noteModal.userId, text: trimmedNote }
              : { userId: noteModal.userId, note: noteModal.note }
          ),
        }
      );
      const data = await res.json();
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === noteModal.userId
              ? {
                  ...u,
                  modNote: isModeratorContext ? u.modNote : trimmedNote || null,
                  latestModNote: trimmedNote || null,
                }
              : u
          )
        );
        setNoteModal(null);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert("Network error");
    } finally {
      setNoteSaving(false);
    }
  };

  const handleViewRetired = async (userId: string, username: string) => {
    setRetiredLoading(true);
    try {
      const res = await fetch(`/api/admin/users/retire-character?userId=${userId}`);
      const data = await res.json();
      if (res.ok) {
        setRetiredModal({ userId, username, characters: data.retiredCharacters });
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert("Network error");
    } finally {
      setRetiredLoading(false);
    }
  };

  const handleResetDiscord = async (
    userId: string,
    username: string,
    discordUsername: string | null
  ) => {
    const discordInfo = discordUsername ? ` (${discordUsername})` : "";
    if (
      !confirm(
        `Reset Discord link for ${username}${discordInfo}?\n\nThis will unlink Discord from ALL accounts using this Discord ID, allowing the user to re-link.`
      )
    )
      return;
    try {
      const res = await fetch("/api/admin/users/reset-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchUsers();
      } else alert(`Error: ${data.error}`);
    } catch {
      alert("Network error");
    }
  };

  const duplicateGroups = getDuplicateGroups(users);
  const duplicateUserIds = new Set(duplicateGroups.flatMap((g) => g.members.map((m) => m.id)));
  const duplicateCount = duplicateUserIds.size;
  const filtered = users.filter((u) => {
    if (showDuplicatesOnly && !duplicateUserIds.has(u.id)) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return (
        u.username.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        (u.characterName && u.characterName.toLowerCase().includes(term))
      );
    }
    return true;
  });

  const groupsTotalPages = Math.max(1, Math.ceil(duplicateGroups.length / GROUPS_PER_PAGE));
  const pagedGroups = duplicateGroups.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE);

  const tableTotalPages = Math.max(1, Math.ceil(filtered.length / USERS_PER_PAGE));
  const pagedUsers = filtered.slice((page - 1) * USERS_PER_PAGE, page * USERS_PER_PAGE);

  return (
    <div className="space-y-4">
      <UsersToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        showDuplicatesOnly={showDuplicatesOnly}
        onToggleDuplicatesOnly={() => setShowDuplicatesOnly(!showDuplicatesOnly)}
        loading={loading}
        error={error}
        onRefresh={fetchUsers}
        totalUsers={users.length}
        filteredCount={filtered.length}
        duplicateGroupCount={duplicateGroups.length}
        duplicateCount={duplicateCount}
      />

      {retiredModal && (
        <RetiredCharactersModal
          username={retiredModal.username}
          characters={retiredModal.characters}
          onClose={() => setRetiredModal(null)}
        />
      )}

      {noteModal && (
        <ModNoteModal
          username={noteModal.username}
          note={noteModal.note}
          existingNote={noteModal.existingNote}
          isModeratorContext={isModeratorContext}
          saving={noteSaving}
          onNoteChange={(note) => setNoteModal({ ...noteModal, note })}
          onClose={() => setNoteModal(null)}
          onSave={handleSaveNote}
        />
      )}

      {!loading && !error && showDuplicatesOnly && (
        <DuplicateGroupsView
          duplicateGroups={duplicateGroups}
          pagedGroups={pagedGroups}
          page={page}
          groupsPerPage={GROUPS_PER_PAGE}
          groupsTotalPages={groupsTotalPages}
          expandedGroups={expandedGroups}
          onToggleGroup={toggleGroup}
          onSetExpandedGroups={setExpandedGroups}
          onPageChange={(p) => {
            setPage(p);
            setExpandedGroups(new Set());
          }}
          context={context}
          isModeratorContext={isModeratorContext}
          isBanOnCooldown={isBanOnCooldown}
          onOpenNote={handleOpenNote}
          onResetPassword={handleResetPassword}
          onBanUser={handleBanUser}
          onDeleteUser={handleDeleteUser}
        />
      )}

      {!loading && !error && !showDuplicatesOnly && (
        <UsersTable
          pagedUsers={pagedUsers}
          searchTerm={searchTerm}
          page={page}
          tableTotalPages={tableTotalPages}
          onPageChange={setPage}
          context={context}
          isModeratorContext={isModeratorContext}
          retiredLoading={retiredLoading}
          isBanOnCooldown={isBanOnCooldown}
          onOpenNote={handleOpenNote}
          onResetPassword={handleResetPassword}
          onResetMovement={handleResetMovement}
          onResetFoundingCooldown={handleResetFoundingCooldown}
          onResetDiscord={handleResetDiscord}
          onViewRetired={handleViewRetired}
          onBanUser={handleBanUser}
          onRetireCharacter={handleRetireCharacter}
          onDeleteUser={handleDeleteUser}
        />
      )}
    </div>
  );
}
