"use client";

// IdentityPanel — who this account claims to be and every net-identity
// anchor it has ever presented: emails, OAuth links, IPs (with the ip-api
// VPN/proxy/hosting verdicts), fingerprints, and the device/IP sighting
// table. Masking is server-side (moderators receive truncated PII and null
// deviceKey/trackingId); this panel only mirrors that with an "admin only"
// hint so mods know depth exists rather than thinking data is missing.

import {
  formatDateTime,
  OVERLINE_CLS,
  PANEL_CLS,
  type DossierContext,
  type DossierIdentity,
  type DossierDeviceIpRow,
} from "./dossierTypes";
import { formatRelative } from "@/components/admin/forensics/types";

interface IdentityPanelProps {
  identity: DossierIdentity;
  devicesAndIps: DossierDeviceIpRow[];
  context: DossierContext;
}

const MONO_CLS = "font-mono text-[11px] tracking-tight";

export function IdentityPanel({ identity, devicesAndIps, context }: IdentityPanelProps) {
  const isAdmin = context === "admin";
  const { oauth, ipDetails } = identity;
  const netRisk = ipDetails && (ipDetails.isVpn || ipDetails.isProxy || ipDetails.isHosting);

  return (
    <section className={PANEL_CLS} aria-label="Identity and devices">
      <h3 className={`mb-3 ${OVERLINE_CLS}`}>Identity &amp; devices</h3>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
        <Field label="Email" value={identity.email} mono />
        <Field label="Role" value={identity.role} />
        <Field
          label="Discord"
          value={
            oauth.discordUsername
              ? `${oauth.discordUsername}${isAdmin && oauth.discordId ? ` (${oauth.discordId})` : ""}`
              : oauth.discordId
          }
          mono
        />
        <Field
          label="Google"
          value={oauth.googleEmail ?? oauth.googleName ?? (oauth.googleId ? "linked" : null)}
          mono
        />
        <Field label="Patreon" value={oauth.patreonUserId} mono />
        <Field
          label="Referrals"
          value={
            identity.referredBy
              ? `referred by …${identity.referredBy.slice(-6)} · ${identity.referralCount} referred`
              : `${identity.referralCount} referred`
          }
        />
        <Field label="Registration IP" value={identity.registrationIp} mono />
        <Field label="Last known IP" value={identity.lastKnownIp} mono />
        <Field label="Registration fingerprint" value={identity.registrationFingerprint} mono />
        <Field label="Last fingerprint" value={identity.lastFingerprint} mono />
        <Field label="Device key" value={identity.deviceKey} mono adminOnlyHint={!isAdmin} />
        <Field label="Tracking cookie" value={identity.trackingId} mono adminOnlyHint={!isAdmin} />
      </dl>

      {/* ip-api verdict on the last known IP — the only place the cockpit
          editorializes about the network itself. */}
      {ipDetails && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2.5 text-xs ${
            netRisk
              ? "border-amber-500/25 bg-amber-500/5"
              : "border-card-border/70 bg-card-elevated/40"
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className={OVERLINE_CLS}>Network</span>
            <span className="text-foreground/90">
              {[ipDetails.city, ipDetails.region, ipDetails.country].filter(Boolean).join(", ") ||
                "Unknown location"}
            </span>
            {ipDetails.isp && <span className="text-muted">{ipDetails.isp}</span>}
            {ipDetails.as && <span className={`${MONO_CLS} text-muted`}>{ipDetails.as}</span>}
            <span className="ml-auto inline-flex gap-1.5">
              {ipDetails.isVpn && <NetChip label="VPN" />}
              {ipDetails.isProxy && <NetChip label="Proxy" />}
              {ipDetails.isHosting && <NetChip label="Hosting" />}
              {!netRisk && (
                <span className="rounded-md border border-green-500/20 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-400">
                  Residential
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* Fingerprint history, when there is more than the current one. */}
      {identity.fingerprintHistory.length > 1 && (
        <div className="mt-4">
          <div className={`mb-1.5 ${OVERLINE_CLS}`}>
            Fingerprint history ({identity.fingerprintHistory.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {identity.fingerprintHistory.map((fp, i) => (
              <span
                key={`${fp}-${i}`}
                className={`rounded-md border border-card-border/70 bg-card-elevated/50 px-1.5 py-0.5 text-muted ${MONO_CLS}`}
              >
                {fp}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Device / IP sightings. */}
      <div className="mt-4">
        <div className={`mb-1.5 ${OVERLINE_CLS}`}>
          Device &amp; IP sightings ({devicesAndIps.length})
        </div>
        {devicesAndIps.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted">No device or IP data recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-xs">
              <thead>
                <tr className="border-b border-card-border/70 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <th className="py-1.5 pr-3 font-semibold">IP</th>
                  <th className="py-1.5 pr-3 font-semibold">Fingerprint</th>
                  <th className="py-1.5 pr-3 font-semibold">Tracking</th>
                  <th className="py-1.5 pr-3 font-semibold">Source</th>
                  <th className="py-1.5 text-right font-semibold">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/50">
                {devicesAndIps.map((row, i) => (
                  <tr key={i} className="align-top">
                    <td className={`py-1.5 pr-3 ${MONO_CLS}`}>{row.ip ?? "—"}</td>
                    <td className={`py-1.5 pr-3 ${MONO_CLS}`}>{row.fingerprint ?? "—"}</td>
                    <td className={`py-1.5 pr-3 ${MONO_CLS}`}>
                      {row.trackingId ?? (isAdmin ? "—" : <AdminOnlyDash />)}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{row.source}</td>
                    <td
                      className="py-1.5 text-right tabular-nums text-muted"
                      title={formatDateTime(row.lastSeen)}
                    >
                      {formatRelative(row.lastSeen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
  adminOnlyHint = false,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  adminOnlyHint?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="w-32 flex-shrink-0 text-[11px] font-medium text-muted">{label}</dt>
      <dd
        className={`min-w-0 truncate text-xs text-foreground/90 ${mono ? "font-mono text-[11px] tracking-tight" : ""}`}
        title={value ?? undefined}
      >
        {value ?? (adminOnlyHint ? <AdminOnlyDash /> : "—")}
      </dd>
    </div>
  );
}

/** Mods see a dash that explains itself: the value exists but is admin-depth. */
function AdminOnlyDash() {
  return (
    <span className="text-muted" title="Visible to admins only.">
      — <span className="text-[9px] font-semibold uppercase tracking-wide">admin</span>
    </span>
  );
}

function NetChip({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
      {label}
    </span>
  );
}
