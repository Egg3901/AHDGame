/**
 * Avatar — sender avatar for mail InboxItems.
 * Shows two-letter initials derived from the counterpart name,
 * with an optional party colour dot in the bottom-right corner.
 */

interface AvatarProps {
  /** Counterpart display name — used to derive initials */
  name: string;
  /** Optional hex or CSS colour for the party dot */
  partyColor?: string;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, partyColor, className }: AvatarProps) {
  const initials = getInitials(name);
  return (
    <span
      className={[
        "relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-card-elevated text-[10px] font-semibold tracking-wide text-muted select-none",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={name}
    >
      {initials}
      {partyColor && (
        <span
          className="absolute bottom-0 right-0 h-2 w-2 rounded-full ring-1 ring-card"
          style={{ backgroundColor: partyColor }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
