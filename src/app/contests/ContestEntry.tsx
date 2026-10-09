import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { CorporationLogo } from "@/components/corporation/CorporationLogo";
import { PartyLogo } from "@/components/PartyLogo";
import type { EntryImages } from "@/lib/contests/queries";

interface EntryProps extends EntryImages {
  subjectName: string;
  characterName: string;
  /** Corporate and party entries name their player; government entries name their leader. */
  showOwner: boolean;
  size?: "sm" | "lg";
}

function MaybeLink({
  href,
  className,
  children,
}: {
  href?: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  return href ? (
    <Link href={href} className={`hover:underline ${className ?? ""}`}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** Logo and portrait, then the entry's name and its player, each linked to its page. */
export function ContestEntry({
  subjectName,
  characterName,
  showOwner,
  logoKind,
  logoUrl,
  logoColor,
  partyId,
  avatarUrl,
  subjectHref,
  characterHref,
  size = "sm",
}: EntryProps) {
  const hasLogo = logoKind != null;
  const box = size === "lg" ? "h-10 w-10" : "h-7 w-7";
  const ownerBox = size === "lg" ? "h-5 w-5" : "h-4 w-4";

  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {hasLogo ? (
        <span className="relative shrink-0">
          <MaybeLink href={subjectHref} className="block">
            {logoKind === "party" ? (
              <PartyLogo
                partyId={partyId}
                partyColor={logoColor ?? "#888888"}
                logoUrl={logoUrl}
                logoAlt={subjectName}
                size={box}
              />
            ) : (
              <CorporationLogo logoUrl={logoUrl} name={subjectName} size={box} />
            )}
          </MaybeLink>
          <MaybeLink href={characterHref} className="absolute -bottom-1 -right-1 block">
            <Avatar
              url={avatarUrl}
              name={characterName}
              size={ownerBox}
              className="ring-2 ring-card"
            />
          </MaybeLink>
        </span>
      ) : (
        <MaybeLink href={characterHref} className="block shrink-0">
          <Avatar url={avatarUrl} name={characterName} size={box} />
        </MaybeLink>
      )}
      <span className="min-w-0 truncate">
        <MaybeLink href={hasLogo ? subjectHref : characterHref} className="text-foreground">
          {subjectName}
        </MaybeLink>
        {showOwner && (
          <>
            <span className="text-muted"> · </span>
            <MaybeLink href={characterHref} className="text-muted">
              {characterName}
            </MaybeLink>
          </>
        )}
      </span>
    </span>
  );
}
