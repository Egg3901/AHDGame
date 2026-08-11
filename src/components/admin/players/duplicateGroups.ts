import type { IdentitySignalName } from "@/lib/auth/identitySignals";
import type { DuplicateGroup, GroupMember, MatchReason, UserData } from "./types";

/**
 * Build duplicate groups from shared IPs, tracking cookies, device keys and
 * exact fingerprints.
 *
 * Eligibility is decided SERVER-SIDE (`eligibleIdentitySignals`) and arrives on
 * `UserData.signalEligibility`. This function must not re-derive it: the
 * moderator endpoint emits sha256 hashes, so neither the Cloudflare-edge CIDR
 * check nor the sentinel-string check is possible here — a hash never equals
 * "unknown", which is how every account with an unresolvable IP previously got
 * welded into a single component.
 *
 * A user with no annotation contributes no signals. That is deliberate: a stale
 * client bundle degrades to "no groups" rather than to "group on everything".
 */
export const getDuplicateGroups = (users: UserData[]): DuplicateGroup[] => {
  // Signal name -> the value fields that carry it. The moderator endpoint sends
  // the `*Key` hash and nulls the raw field; the admin endpoint sends the raw
  // value and no hash. `??` picks whichever is present.
  const readSignal = (u: UserData, name: IdentitySignalName): string | null => {
    if (!u.signalEligibility?.[name]?.eligible) return null;
    switch (name) {
      case "registrationIp":
        return u.registrationIpKey ?? u.registrationIp ?? null;
      case "lastKnownIp":
        return u.lastKnownIpKey ?? u.lastKnownIp ?? null;
      case "registrationFingerprint":
        return u.registrationFingerprintKey ?? u.registrationFingerprint ?? null;
      case "lastFingerprint":
        return u.lastFingerprintKey ?? u.lastFingerprint ?? null;
      case "trackingId":
        return u.trackingIdKey ?? u.trackingId ?? null;
      case "deviceKey":
        return u.deviceKeyKey ?? u.deviceKey ?? null;
    }
  };

  const collect = (names: IdentitySignalName[]): Map<string, Set<string>> => {
    const byValue = new Map<string, Set<string>>();
    users.forEach((u) => {
      const values = new Set(
        names.map((name) => readSignal(u, name)).filter((v): v is string => v !== null)
      );
      for (const value of values) {
        if (!byValue.has(value)) byValue.set(value, new Set());
        byValue.get(value)!.add(u.id);
      }
    });
    // Only values shared by 2+ users can group anyone.
    return new Map([...byValue.entries()].filter(([, ids]) => ids.size > 1));
  };

  const sharedIps = collect(["registrationIp", "lastKnownIp"]);
  const sharedTracks = collect(["trackingId"]);
  const sharedDevices = collect(["deviceKey"]);
  const sharedFingerprints = collect(["registrationFingerprint", "lastFingerprint"]);

  // Union-find structure
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };

  // Union users who share any IP
  for (const [, userIds] of sharedIps) {
    const ids = [...userIds];
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Union users who share a tracking cookie
  for (const [, userIds] of sharedTracks) {
    const ids = [...userIds];
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Union users who share an exact browser fingerprint
  for (const [, userIds] of sharedFingerprints) {
    const ids = [...userIds];
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Union users who share a device key
  for (const [, userIds] of sharedDevices) {
    const ids = [...userIds];
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  // Collect groups — only include users that were actually linked
  const allLinkedIds = new Set<string>();
  for (const [, ids] of sharedIps) ids.forEach((id) => allLinkedIds.add(id));
  for (const [, ids] of sharedTracks) ids.forEach((id) => allLinkedIds.add(id));
  for (const [, ids] of sharedFingerprints) ids.forEach((id) => allLinkedIds.add(id));
  for (const [, ids] of sharedDevices) ids.forEach((id) => allLinkedIds.add(id));

  const groupMap = new Map<string, Set<string>>();
  for (const id of allLinkedIds) {
    const root = find(id);
    if (!groupMap.has(root)) groupMap.set(root, new Set());
    groupMap.get(root)!.add(id);
  }

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Build group objects with match reasons
  return [...groupMap.values()]
    .map((idSet) => {
      const allMembers = [...idSet].map((id) => userMap.get(id)!).filter(Boolean);

      // Find signals shared within this group
      const groupIps = new Set<string>();
      for (const [ip, ids] of sharedIps) {
        if ([...ids].some((id) => idSet.has(id))) groupIps.add(ip);
      }
      const groupTracks = new Set<string>();
      for (const [track, ids] of sharedTracks) {
        if ([...ids].some((id) => idSet.has(id))) groupTracks.add(track);
      }
      const groupFingerprints = new Set<string>();
      for (const [fingerprint, ids] of sharedFingerprints) {
        if ([...ids].some((id) => idSet.has(id))) groupFingerprints.add(fingerprint);
      }
      const groupDevices = new Set<string>();
      for (const [device, ids] of sharedDevices) {
        if ([...ids].some((id) => idSet.has(id))) groupDevices.add(device);
      }

      // Build per-member match reasons (checked against all members including banned,
      // so we correctly label connections even when the matched account is banned).
      const buildMatchReasons = (member: UserData): MatchReason[] => {
        const reasons: MatchReason[] = [];
        for (const ip of groupIps) {
          const usersForIp = sharedIps.get(ip);
          if (
            usersForIp?.has(member.id) &&
            [...usersForIp].some((id) => id !== member.id && allMembers.some((m) => m.id === id))
          ) {
            reasons.push("ip");
            break;
          }
        }
        for (const track of groupTracks) {
          const usersForTrack = sharedTracks.get(track);
          if (
            usersForTrack?.has(member.id) &&
            [...usersForTrack].some((id) => id !== member.id && allMembers.some((m) => m.id === id))
          ) {
            reasons.push("tracking");
            break;
          }
        }
        for (const fp of groupFingerprints) {
          const usersForFp = sharedFingerprints.get(fp);
          if (
            usersForFp?.has(member.id) &&
            [...usersForFp].some((id) => id !== member.id && allMembers.some((m) => m.id === id))
          ) {
            reasons.push("fingerprint");
            break;
          }
        }
        for (const device of groupDevices) {
          const usersForDevice = sharedDevices.get(device);
          if (
            usersForDevice?.has(member.id) &&
            [...usersForDevice].some(
              (id) => id !== member.id && allMembers.some((m) => m.id === id)
            )
          ) {
            reasons.push("device");
            break;
          }
        }
        return reasons;
      };

      // Keep banned members in the cluster so moderators can still see the
      // evidence trail after taking action on one linked account.
      const displayMembers: GroupMember[] = allMembers
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((m) => ({ ...m, matchReasons: buildMatchReasons(m) }));

      if (displayMembers.length < 2) return null;

      // A group is "cgNAT-suspect" when the only thing linking accounts is a
      // shared IP and at least one member is on a mobile/tablet — carrier
      // cgNAT routinely puts unrelated users behind one IP, so the badge
      // helps moderators avoid treating a household-wifi or cellular cluster
      // as a real alt ring without other corroborating signals.
      const onlySignalIsIp = displayMembers.every(
        (m) => m.matchReasons.length === 1 && m.matchReasons[0] === "ip"
      );
      const hasMobileMember = displayMembers.some(
        (m) => m.lastDevice === "mobile" || m.lastDevice === "tablet"
      );
      const cgnatSuspect = onlySignalIsIp && hasMobileMember;

      // Age of the freshest signal anywhere in this group, for the "newest
      // evidence" label. Ineligible signals are excluded — an expired value is
      // not evidence, even though it still carries an age.
      const ages = allMembers.flatMap((m) =>
        Object.values(m.signalEligibility ?? {})
          .filter((e) => e.eligible && typeof e.ageMs === "number")
          .map((e) => e.ageMs as number)
      );
      const newestEvidenceMs = ages.length > 0 ? Math.min(...ages) : undefined;

      return {
        members: displayMembers,
        sharedIps: [...groupIps],
        sharedFingerprints: [...groupFingerprints],
        sharedDevices: [...groupDevices],
        cgnatSuspect,
        newestEvidenceMs,
      };
    })
    .filter((g): g is NonNullable<typeof g> => g !== null);
};
