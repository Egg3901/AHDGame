import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { getPartyLabel } from "@/lib/utils/politics";

export interface LeaderCardCharacter {
  characterId: string;
  sequentialId?: number | null;
  characterName: string;
  party: string | null;
  since: string | null;
  avatarUrl?: string | null;
}

export function LeaderCard({
  title,
  subtitle,
  character,
}: {
  title: string;
  subtitle: string;
  character: LeaderCardCharacter | null;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{title}</p>
      <p className="mb-3 text-xs text-muted">{subtitle}</p>
      {character ? (
        <div className="flex items-center gap-3">
          <Avatar
            url={character.avatarUrl ?? null}
            name={character.characterName}
            size="h-10 w-10"
          />
          <div>
            <Link
              href={`/character/${character.sequentialId ?? character.characterId}`}
              className="font-semibold text-foreground hover:text-primary transition-colors"
            >
              {character.characterName}
            </Link>
            {character.party && (
              <p className="text-xs text-muted">{getPartyLabel(character.party)}</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm italic text-muted">Vacant</p>
      )}
    </div>
  );
}
