import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";

export interface CentralBankMember {
  countryId: CountryId;
  name: string;
  isIssuer: boolean;
}

export function CentralBankMembersTab({ members }: { members: CentralBankMember[] }) {
  return (
    <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
      <div className="border-b border-card-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Member Countries</h2>
        <p className="mt-0.5 text-xs text-muted">
          Countries that use this currency. The issuer&apos;s central bank sets monetary policy for
          every member.
        </p>
      </div>
      <ul className="divide-y divide-card-border">
        {members.map((member) => (
          <li key={member.countryId}>
            <Link
              href={`/country/${member.countryId.toLowerCase()}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-card-elevated/40"
            >
              <CountryFlag country={member.countryId} width={30} height={20} />
              <span className="text-sm font-medium text-foreground">{member.name}</span>
              {member.isIssuer && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                  Issuer
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
