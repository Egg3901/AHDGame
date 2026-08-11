"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getPartyTextColor, getPartyLabel } from "@/lib/utils/politics";
import { formatDate } from "@/lib/utils/formatters";
import { ResponsiveTable, type ResponsiveTableColumn } from "@/components/ui";
import { Pagination } from "@/components/admin/Pagination";
import { ACTION_BTN, getLatestNoteText, type UserData } from "./types";

interface UsersTableProps {
  pagedUsers: UserData[];
  searchTerm: string;
  page: number;
  tableTotalPages: number;
  onPageChange: (page: number) => void;
  context: "admin" | "moderator";
  isModeratorContext: boolean;
  retiredLoading: boolean;
  isBanOnCooldown: (userId: string) => boolean;
  onOpenNote: (user: UserData) => void;
  onResetPassword: (userId: string, username: string) => void;
  onResetMovement: (userId: string, username: string) => void;
  onResetFoundingCooldown: (userId: string, username: string) => void;
  onResetDiscord: (userId: string, username: string, discordUsername: string | null) => void;
  onViewRetired: (userId: string, username: string) => void;
  onBanUser: (userId: string, username: string, currentlyBanned: boolean) => void;
  onRetireCharacter: (userId: string, username: string) => void;
  onDeleteUser: (userId: string, username: string) => void;
}

export function UsersTable({
  pagedUsers,
  searchTerm,
  page,
  tableTotalPages,
  onPageChange,
  context,
  isModeratorContext,
  retiredLoading,
  isBanOnCooldown,
  onOpenNote,
  onResetPassword,
  onResetMovement,
  onResetFoundingCooldown,
  onResetDiscord,
  onViewRetired,
  onBanUser,
  onRetireCharacter,
  onDeleteUser,
}: UsersTableProps) {
  const columns: ResponsiveTableColumn<UserData>[] = [
    {
      key: "character",
      header: "Character",
      render: (u) => (
        <div className="flex flex-wrap items-center gap-2">
          {u.isAdmin && (
            <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-xs font-medium text-yellow-400">
              Admin
            </span>
          )}
          {u.isBanned && (
            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
              Banned
            </span>
          )}
          {getLatestNoteText(u) && (
            <span
              className="rounded bg-blue-500/20 px-1.5 py-0.5 text-xs font-medium text-blue-400"
              title={getLatestNoteText(u) ?? undefined}
            >
              Note
            </span>
          )}
          <span className={u.characterName ? "font-medium" : "text-muted italic"}>
            {u.characterName || "(No character)"}
          </span>
        </div>
      ),
    },
    {
      key: "party",
      header: "Party",
      render: (u) => (
        <span className={getPartyTextColor(u.party)}>
          {u.party ? getPartyLabel(u.party) : "No Character"}
        </span>
      ),
    },
    ...(!isModeratorContext
      ? [
          {
            key: "username" as const,
            header: "Username",
            render: (u: UserData) => (
              <>
                <div className="font-medium">{u.username}</div>
                <div className="text-xs text-muted">{u.email}</div>
              </>
            ),
          },
        ]
      : []),
    {
      key: "fingerprint",
      header: isModeratorContext ? "Browser Signals" : "Fingerprint",
      render: (u) =>
        isModeratorContext ? (
          u.lastFingerprintKey || u.registrationFingerprintKey ? (
            <span className="text-xs text-muted">
              Hidden
              {u.fingerprintCount > 1 ? ` (${u.fingerprintCount})` : ""}
            </span>
          ) : (
            <span className="text-muted text-xs">--</span>
          )
        ) : u.lastFingerprint ? (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-primary truncate max-w-[120px] md:max-w-none">
              {u.lastFingerprint}
            </span>
            {u.fingerprintCount > 1 && (
              <span
                className="text-xs text-yellow-400"
                title={`${u.fingerprintCount} unique fingerprints`}
              >
                ({u.fingerprintCount})
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted text-xs">--</span>
        ),
      hideOnMobile: true,
    },
    {
      key: "lastLogin",
      header: "Last Login",
      render: (u) => (
        <span className="text-sm text-muted">
          {u.lastLogin ? formatDate(u.lastLogin) : "Never"}
        </span>
      ),
    },
    {
      key: "lastLogout",
      header: "Last Logout",
      render: (u) => (
        <span className="text-sm text-muted">
          {u.lastLogout ? formatDate(u.lastLogout) : "Never"}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "vpn",
      header: "VPN",
      render: (u) => {
        if (u.vpnFlag === null || u.vpnFlag === undefined) {
          return <span className="text-xs text-muted">--</span>;
        }
        return u.vpnFlag ? (
          <span
            className="inline-flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400"
            title={
              u.ipDetails
                ? `VPN/Proxy/Tor detected (${u.ipDetails.checkedAt})`
                : "VPN/Proxy detected"
            }
          >
            ⚠️ VPN
          </span>
        ) : (
          <span className="text-xs text-green-400">Clean</span>
        );
      },
      hideOnMobile: true,
    },
  ];

  if (!isModeratorContext) {
    columns.splice(
      3,
      0,
      {
        key: "regIp",
        header: "Registration IP",
        mobileLabel: "Reg. IP",
        render: (u) => (
          <span className="font-mono text-sm break-all">
            {u.registrationIp || <span className="text-muted">--</span>}
          </span>
        ),
        hideOnMobile: true,
      },
      {
        key: "lastIp",
        header: "Last Known IP",
        mobileLabel: "Last IP",
        render: (u) => (
          <span className="font-mono text-sm break-all">
            {u.lastKnownIp || <span className="text-muted">--</span>}
          </span>
        ),
        hideOnMobile: true,
      }
    );
  }

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Menu state keys off the row's user id; a row that leaves the page unmounts
  // its menu with it, so no cleanup effect is needed.
  const [menuUserId, setMenuUserId] = useState<string | null>(null);

  const openDossier = (userId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("tab", "players");
    params.set("sub", "dossier");
    params.set("user", userId);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <>
      <ResponsiveTable
        columns={columns}
        data={pagedUsers}
        keyExtractor={(u) => u.id}
        emptyMessage={searchTerm ? "No users match your search" : "No users found"}
        renderActions={(user) => (
          <div className="flex flex-wrap items-center gap-2">
            {/* Consolidated row actions: Note / Ban / Dossier inline, everything
                else under the ⋯ overflow menu — was 8 buttons per row. */}
            <button
              onClick={() => onOpenNote(user)}
              className={`${ACTION_BTN} ${
                getLatestNoteText(user)
                  ? "bg-amber-500/25 text-amber-300 border border-amber-400/60 hover:bg-amber-500/35"
                  : "bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30"
              }`}
              title={getLatestNoteText(user) ? `Note: ${getLatestNoteText(user)}` : "Add mod note"}
            >
              {getLatestNoteText(user) ? "View Note" : "Note"}
            </button>
            {!user.isAdmin && (
              <button
                onClick={() => onBanUser(user.id, user.username, user.isBanned)}
                disabled={isBanOnCooldown(user.id)}
                className={`${ACTION_BTN} ${
                  user.isBanned
                    ? "bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30"
                    : "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50 hover:bg-yellow-500/30"
                } disabled:opacity-40`}
              >
                {user.isBanned ? "Unban" : "Ban"}
              </button>
            )}
            {context === "admin" && (
              <button
                onClick={() => openDossier(user.id)}
                className={`${ACTION_BTN} bg-amber-500/10 text-amber-400 border border-amber-500/50 hover:bg-amber-500/20`}
                title="Open dossier — the full cross-tab record for this account"
              >
                Dossier
              </button>
            )}
            {context === "admin" && (
              <div className="relative">
                <button
                  onClick={() => setMenuUserId(menuUserId === user.id ? null : user.id)}
                  className={`${ACTION_BTN} border border-card-border text-muted hover:text-foreground`}
                  aria-haspopup="menu"
                  aria-expanded={menuUserId === user.id}
                  aria-label={`More actions for ${user.username}`}
                  title="Reset password · Reset movement · Reset Discord · View retired · Retire character · Delete account"
                >
                  ⋯
                </button>
                {menuUserId === user.id && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      aria-hidden
                      onClick={() => setMenuUserId(null)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 z-40 mt-1 w-48 overflow-hidden rounded-lg border border-card-border bg-card-elevated py-1 shadow-modal"
                    >
                      <MenuItem
                        label="Reset password"
                        onClick={() => {
                          setMenuUserId(null);
                          onResetPassword(user.id, user.username);
                        }}
                      />
                      <MenuItem
                        label="Reset movement"
                        title="Clear relocation cooldown for this user"
                        onClick={() => {
                          setMenuUserId(null);
                          onResetMovement(user.id, user.username);
                        }}
                      />
                      <MenuItem
                        label="Reset founding"
                        title="Clear the corporation-founding cooldown for this user (per-account, survives a character reroll by design)"
                        onClick={() => {
                          setMenuUserId(null);
                          onResetFoundingCooldown(user.id, user.username);
                        }}
                      />
                      <MenuItem
                        label={user.discordId ? "Reset Discord" : "Clear Discord"}
                        title={
                          user.discordUsername
                            ? `Discord: ${user.discordUsername}`
                            : "No Discord linked"
                        }
                        onClick={() => {
                          setMenuUserId(null);
                          onResetDiscord(user.id, user.username, user.discordUsername);
                        }}
                      />
                      <MenuItem
                        label="View retired"
                        disabled={retiredLoading}
                        onClick={() => {
                          setMenuUserId(null);
                          onViewRetired(user.id, user.username);
                        }}
                      />
                      {!user.isAdmin && user.characterName && (
                        <MenuItem
                          label="Retire character"
                          tone="warning"
                          onClick={() => {
                            setMenuUserId(null);
                            onRetireCharacter(user.id, user.username);
                          }}
                        />
                      )}
                      {!user.isAdmin && (
                        <MenuItem
                          label="Delete account"
                          tone="danger"
                          onClick={() => {
                            setMenuUserId(null);
                            onDeleteUser(user.id, user.username);
                          }}
                        />
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      />
      <Pagination page={page} totalPages={tableTotalPages} onPageChange={onPageChange} />
    </>
  );
}

function MenuItem({
  label,
  onClick,
  title,
  disabled,
  tone,
}: {
  label: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
  tone?: "warning" | "danger";
}) {
  const toneCls =
    tone === "danger"
      ? "text-error hover:bg-error/10"
      : tone === "warning"
        ? "text-warning hover:bg-warning/10"
        : "text-foreground hover:bg-white/5";
  return (
    <button
      role="menuitem"
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`block w-full cursor-pointer px-3 py-1.5 text-left text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${toneCls}`}
    >
      {label}
    </button>
  );
}
