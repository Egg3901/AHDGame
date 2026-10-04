import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import type { CountryId } from "@/lib/constants/countries";
import { CentralBankSection } from "./CentralBankSection";

export interface CentralBankMember {
  countryId: CountryId;
  name: string;
  isIssuer: boolean;
}

export function CentralBankMembersTab({ members }: { members: CentralBankMember[] }) {
  return (
    <CentralBankSection
      title="Member countries"
      meta="Countries that use this currency. The issuer's central bank sets monetary policy for every member."
    >
      <ul className="max-w-2xl divide-y divide-card-border/60">
        {members.map((member) => (
          <li key={member.countryId}>
            <Link
              href={`/country/${member.countryId.toLowerCase()}`}
              className="group flex min-h-[44px] items-center gap-3 py-2"
            >
              <CountryFlag country={member.countryId} width={30} height={20} />
              <span className="text-body font-medium text-foreground underline-offset-4 group-hover:underline">
                {member.name}
              </span>
              {member.isIssuer && <span className="ml-auto text-body-sm text-muted">Issuer</span>}
            </Link>
          </li>
        ))}
      </ul>
    </CentralBankSection>
  );
}
