/**
 * A country's active constitution determines which deputies vote and which
 * executive offices they appoint. resolveCountryOfficeLayout derives those
 * keys from the resolved country configuration without assuming a modern era.
 */
import type { CountryConfig } from "@/lib/constants/countries";

export function resolveCountryOfficeLayout(config: CountryConfig) {
  const forChamber = (key: string) =>
    config.officeTypes.find((office) => office.chamberKey === key)?.key ?? key;
  const lowerOfficeType = forChamber(config.legislature.lowerChamber.key);
  const upperOfficeType = config.legislature.upperChamber
    ? config.officeTypes.find(
        (office) => office.chamberKey === config.legislature.upperChamber?.key
      )?.key
    : undefined;
  const executiveOfficeKey = config.officeTypes.find(
    (office) => office.isExecutive && !office.isSubNational
  )?.key;
  const headOfGovernmentOfficeKey =
    config.officeTypes.find(
      (office) =>
        office.isExecutive && !office.isSubNational && office.label === config.executiveTitle
    )?.key ?? executiveOfficeKey;
  const headOfStateOfficeType = config.officeTypes.find(
    (office) => office.isHeadOfState && !office.isSubNational
  )?.key;
  const jointSittingOfficeTypes = [lowerOfficeType];
  if (upperOfficeType && config.upperElectionSystem) jointSittingOfficeTypes.push(upperOfficeType);
  return {
    config,
    lowerOfficeType,
    upperOfficeType,
    executiveOfficeKey,
    headOfGovernmentOfficeKey,
    headOfStateOfficeType,
    jointSittingOfficeTypes,
  };
}
