"use client";

import { Avatar } from "@/components/Avatar";
import { memberInGameName, ROLE_HEX, type AltMemberIdentity, type AltMemberRole } from "./altTypes";

type Suspect = AltMemberIdentity & { role?: AltMemberRole };

/** Mugshot-only portrait for bounty-board tiles and the ring graph. */
export function SuspectMugshot({
  member,
  size = "h-12 w-12",
  rounded = "rounded-lg",
}: {
  member: Suspect;
  size?: string;
  rounded?: string;
}) {
  const name = memberInGameName(member);
  const roleColor = member.role ? ROLE_HEX[member.role] : undefined;

  return (
    <div className={`relative shrink-0 ${member.banned ? "opacity-80" : ""}`} title={name}>
      <div
        className={`overflow-hidden ${rounded} ${
          member.banned ? "ring-2 ring-red-500" : roleColor ? "ring-2" : "ring-2 ring-background"
        }`}
        style={member.banned || !roleColor ? undefined : { boxShadow: `0 0 0 2px ${roleColor}` }}
      >
        <Avatar url={member.avatarUrl} name={name} size={size} className={rounded} />
      </div>
    </div>
  );
}
