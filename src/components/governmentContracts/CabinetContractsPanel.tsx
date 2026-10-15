"use client";
import { useTranslations } from "next-intl";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { DEFENSE_POSITION_BY_COUNTRY } from "@/lib/constants/military";
import { officeContractType } from "@/lib/governmentContracts/rules";
import { GovernmentContractsBoard } from "./GovernmentContractsBoard";
export function CabinetContractsPanel({
  countryId,
  positionId,
}: {
  countryId: string;
  positionId: string;
}) {
  const t = useTranslations("corporations.governmentContracts");
  const config = COUNTRY_CONFIGS[countryId as CountryId];
  const type = officeContractType(
    countryId,
    positionId,
    config.financeMinisterCabinetId,
    DEFENSE_POSITION_BY_COUNTRY[countryId as CountryId]
  );
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="font-semibold">{t("officeResponsibilities")}</h2>
        <p className="mt-2 text-sm text-muted">
          {type === "defence"
            ? t("defenceOffice")
            : type === "extraction"
              ? t("financeOffice")
              : t("otherOffice")}
        </p>
      </div>
      <GovernmentContractsBoard
        countryId={countryId}
        countryName={config.name}
        type={type ?? "all"}
        embedded
      />
    </div>
  );
}
