"use client";

import { getPartyTextColor, getPartyLabel } from "@/lib/utils/politics";
import { formatDate } from "@/lib/utils/formatters";
import { Pagination } from "@/components/admin/Pagination";
import { ACTION_BTN, getLatestNoteText, type DuplicateGroup, type UserData } from "./types";

interface DuplicateGroupsViewProps {
  duplicateGroups: DuplicateGroup[];
  pagedGroups: DuplicateGroup[];
  page: number;
  groupsPerPage: number;
  groupsTotalPages: number;
  expandedGroups: Set<number>;
  onToggleGroup: (idx: number) => void;
  onSetExpandedGroups: (groups: Set<number>) => void;
  onPageChange: (page: number) => void;
  context: "admin" | "moderator";
  isModeratorContext: boolean;
  isBanOnCooldown: (userId: string) => boolean;
  onOpenNote: (user: UserData) => void;
  onResetPassword: (userId: string, username: string) => void;
  onBanUser: (userId: string, username: string, currentlyBanned: boolean) => void;
  onDeleteUser: (userId: string, username: string) => void;
}

export function DuplicateGroupsView({
  duplicateGroups,
  pagedGroups,
  page,
  groupsPerPage,
  groupsTotalPages,
  expandedGroups,
  onToggleGroup,
  onSetExpandedGroups,
  onPageChange,
  context,
  isModeratorContext,
  isBanOnCooldown,
  onOpenNote,
  onResetPassword,
  onBanUser,
  onDeleteUser,
}: DuplicateGroupsViewProps) {
  const allExpanded = pagedGroups.length > 0 && pagedGroups.every((_, i) => expandedGroups.has(i));

  return (
    <div className="space-y-6">
      {duplicateGroups.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() =>
              onSetExpandedGroups(allExpanded ? new Set() : new Set(pagedGroups.map((_, i) => i)))
            }
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>
      )}
      <p className="text-sm text-muted">
        Matches drop off after 30 days without the signal being re-observed, so a pair of dormant
        accounts disappears from this list even if they really are linked. No confidence scoring is
        applied here — one shared signal groups two accounts. For ranked confidence with weighted
        evidence, and for rings that persist regardless of age, see the Alts tab.
      </p>
      {duplicateGroups.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
          No duplicate accounts detected by shared IP, browser cookie, device key, or fingerprint in
          the last 30 days.
        </div>
      )}
      {pagedGroups.map((group, gi) => (
        <div
          key={gi}
          className="rounded-xl border border-amber-500/30 bg-card shadow-sm overflow-hidden"
        >
          {/* Group header */}
          <button
            type="button"
            onClick={() => onToggleGroup(gi)}
            aria-expanded={expandedGroups.has(gi)}
            aria-controls={`dup-group-body-${gi}`}
            className="flex w-full flex-wrap items-center gap-3 border-b border-card-border bg-amber-500/5 px-4 py-3 text-left hover:bg-amber-500/10 transition-colors"
          >
            <svg
              className={`h-4 w-4 flex-shrink-0 text-amber-400 transition-transform ${expandedGroups.has(gi) ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-400">
              Group {(page - 1) * groupsPerPage + gi + 1}
            </span>
            <span className="text-sm text-muted">{group.members.length} accounts</span>
            {typeof group.newestEvidenceMs === "number" && (
              <span className="text-xs text-muted">
                newest evidence {Math.max(1, Math.round(group.newestEvidenceMs / 86_400_000))}d old
              </span>
            )}
            {group.sharedIps.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">
                  {isModeratorContext ? "Network:" : "IP:"}
                </span>
                {isModeratorContext ? (
                  <span className="rounded border border-card-border bg-card px-2 py-0.5 text-xs text-muted">
                    Hidden ({group.sharedIps.length} shared
                    {group.sharedIps.length === 1 ? " IP" : " IPs"})
                  </span>
                ) : (
                  group.sharedIps.map((ip) => (
                    <span
                      key={ip}
                      className="rounded bg-card px-2 py-0.5 font-mono text-xs text-foreground border border-card-border"
                    >
                      {ip}
                    </span>
                  ))
                )}
              </div>
            )}
            {group.sharedFingerprints.length > 0 && (
              <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400 border border-red-500/30">
                {group.sharedFingerprints.length === 1
                  ? "Fingerprint match"
                  : `${group.sharedFingerprints.length} fingerprint matches`}
              </span>
            )}
            {group.sharedDevices.length > 0 && (
              <span
                className="rounded bg-pink-500/15 px-2 py-0.5 text-xs font-medium text-pink-400 border border-pink-500/30"
                title="Accounts share a localStorage device key (survives cookie clears)"
              >
                {group.sharedDevices.length === 1
                  ? "Same device"
                  : `${group.sharedDevices.length} device matches`}
              </span>
            )}
          </button>
          {group.cgnatSuspect && (
            <div
              className="border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-300"
              title="Mobile/cellular IPs are routinely shared across thousands of unrelated users via carrier-grade NAT (cgNAT). Without a fingerprint, device key, or behavioral overlap, this group is likely a false positive."
            >
              <span className="font-semibold">Likely cgNAT (mobile carrier):</span> shared IP is the
              only signal linking these accounts, and at least one member is on a mobile device.
              Confirm with fingerprint, device-key, or coordinated-login evidence before treating as
              alts.
            </div>
          )}

          {/* Member rows */}
          {expandedGroups.has(gi) && (
            <div id={`dup-group-body-${gi}`} className="divide-y divide-card-border">
              {group.members.map((user) => (
                <div key={user.id} className="px-4 py-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    {/* Character & match badges */}
                    <div className="flex flex-wrap items-center gap-2 min-w-[140px]">
                      {user.isAdmin && (
                        <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-xs font-medium text-yellow-400">
                          Admin
                        </span>
                      )}
                      {user.isBanned && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs font-medium text-red-400">
                          Banned
                        </span>
                      )}
                      {user.matchReasons.includes("ip") && (
                        <span
                          className="rounded bg-orange-500/15 px-1.5 py-0.5 text-xs font-medium text-orange-400 border border-orange-500/30"
                          title="Shares an IP address with another account in this group"
                        >
                          IP match
                        </span>
                      )}
                      {user.matchReasons.includes("fingerprint") && (
                        <span
                          className="rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-medium text-red-400 border border-red-500/30"
                          title="Shares a browser fingerprint with another account in this group"
                        >
                          Fingerprint
                        </span>
                      )}
                      {user.matchReasons.includes("tracking") && (
                        <span
                          className="rounded bg-purple-500/15 px-1.5 py-0.5 text-xs font-medium text-purple-400 border border-purple-500/30"
                          title="Shares a browser tracking cookie with another account in this group"
                        >
                          Same browser
                        </span>
                      )}
                      {user.matchReasons.includes("device") && (
                        <span
                          className="rounded bg-pink-500/15 px-1.5 py-0.5 text-xs font-medium text-pink-400 border border-pink-500/30"
                          title="Shares a localStorage device key with another account in this group (survives cookie clears)"
                        >
                          Same device
                        </span>
                      )}
                      {(user.lastDevice === "mobile" || user.lastDevice === "tablet") && (
                        <span
                          className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-xs font-medium text-cyan-400 border border-cyan-500/30"
                          title={`Last login from a ${user.lastDevice} device — mobile/cellular IPs are often shared across many users via carrier NAT.`}
                        >
                          {user.lastDevice === "mobile" ? "Mobile" : "Tablet"}
                        </span>
                      )}
                      {user.characterId ? (
                        <a
                          href={`/character/${user.characterId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`font-medium hover:text-primary transition-colors ${user.characterName ? "" : "text-muted italic text-sm"}`}
                        >
                          {user.characterName || "(No character)"}
                        </a>
                      ) : (
                        <span
                          className={
                            user.characterName ? "font-medium" : "text-muted italic text-sm"
                          }
                        >
                          {user.characterName || "(No character)"}
                        </span>
                      )}
                    </div>

                    {/* Party */}
                    <span className={`text-sm ${getPartyTextColor(user.party)}`}>
                      {user.party ? getPartyLabel(user.party) : "—"}
                    </span>

                    {/* Username / email — admin only */}
                    {!isModeratorContext && (
                      <div className="min-w-[160px]">
                        <div className="text-sm font-medium">{user.username}</div>
                        <div className="text-xs text-muted">{user.email}</div>
                      </div>
                    )}

                    {/* IPs */}
                    {isModeratorContext ? (
                      <span className="text-xs text-muted">Network details hidden</span>
                    ) : (
                      <div className="flex gap-4 text-xs">
                        <div>
                          <span className="text-muted">Reg: </span>
                          <span className="font-mono break-all">{user.registrationIp || "—"}</span>
                        </div>
                        <div>
                          <span className="text-muted">Last: </span>
                          <span className="font-mono break-all">{user.lastKnownIp || "—"}</span>
                        </div>
                      </div>
                    )}

                    {/* VPN badge */}
                    {user.vpnFlag !== null && user.vpnFlag !== undefined && (
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${
                          user.vpnFlag
                            ? "bg-red-500/20 text-red-400"
                            : "bg-green-500/20 text-green-400"
                        }`}
                      >
                        {user.vpnFlag ? "⚠️ VPN" : "Clean"}
                      </span>
                    )}

                    {/* IP Details panel (admin only) */}
                    {!isModeratorContext && user.ipDetails && (
                      <div className="w-full rounded-lg border border-card-border bg-background/50 p-3 text-xs space-y-1.5">
                        <div className="font-medium text-foreground mb-1">
                          IP Intelligence{" "}
                          <span className="text-muted font-normal">
                            ({new Date(user.ipDetails.checkedAt).toLocaleDateString("en-US")})
                          </span>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
                          <div>
                            <span className="text-muted">Country: </span>
                            {user.ipDetails.country || "—"}
                          </div>
                          <div>
                            <span className="text-muted">Region: </span>
                            {user.ipDetails.region || "—"}
                          </div>
                          <div>
                            <span className="text-muted">City: </span>
                            {user.ipDetails.city || "—"}
                          </div>
                          <div>
                            <span className="text-muted">Timezone: </span>
                            {user.ipDetails.timezone || "—"}
                          </div>
                          <div>
                            <span className="text-muted">ISP: </span>
                            {user.ipDetails.isp || "—"}
                          </div>
                          <div>
                            <span className="text-muted">Org: </span>
                            {user.ipDetails.org || "—"}
                          </div>
                          <div className="col-span-2">
                            <span className="text-muted">AS: </span>
                            <span className="font-mono">{user.ipDetails.as || "—"}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          {user.ipDetails.isVpn && (
                            <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-red-400">
                              VPN
                            </span>
                          )}
                          {user.ipDetails.isProxy && (
                            <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-orange-400">
                              Proxy
                            </span>
                          )}
                          {user.ipDetails.isHosting && (
                            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-blue-400">
                              Hosting/Datacenter
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fingerprint — show value only for admin */}
                    {!isModeratorContext && (user.lastFingerprint || user.lastFingerprintKey) && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted">FP:</span>
                        <span className="font-mono text-primary break-all">
                          {user.lastFingerprint}
                        </span>
                        {user.fingerprintCount > 1 && (
                          <span className="text-yellow-400">({user.fingerprintCount})</span>
                        )}
                      </div>
                    )}

                    {/* Last login */}
                    <span className="text-xs text-muted">
                      {user.lastLogin ? formatDate(user.lastLogin) : "Never"}
                    </span>

                    {/* Last logout */}
                    {user.lastLogout && (
                      <span className="text-xs text-muted">
                        Logout: {formatDate(user.lastLogout)}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => onOpenNote(user)}
                      className={`${ACTION_BTN} ${
                        getLatestNoteText(user)
                          ? "bg-amber-500/25 text-amber-300 border border-amber-400/60 hover:bg-amber-500/35"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/50 hover:bg-blue-500/30"
                      }`}
                      title={
                        getLatestNoteText(user)
                          ? `Note: ${getLatestNoteText(user)}`
                          : "Add mod note"
                      }
                    >
                      {getLatestNoteText(user) ? "View Note" : "Mod Note"}
                    </button>
                    {context === "admin" && (
                      <button
                        onClick={() => onResetPassword(user.id, user.username)}
                        className={`${ACTION_BTN} bg-orange-500/20 text-orange-400 border border-orange-500/50 hover:bg-orange-500/30`}
                      >
                        Reset Password
                      </button>
                    )}
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
                        onClick={() => onDeleteUser(user.id, user.username)}
                        className={`${ACTION_BTN} bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30`}
                      >
                        Delete Account
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <Pagination page={page} totalPages={groupsTotalPages} onPageChange={onPageChange} />
    </div>
  );
}
