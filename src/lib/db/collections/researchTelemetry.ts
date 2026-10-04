import type { Db } from "mongodb";
import type { CountryTurnRow, SecurityTelemetryRow } from "@/lib/telemetry/research/rules";

export const COUNTRY_TURN_TELEMETRY_COLLECTION = "countryTurnTelemetry";
export const SECURITY_TELEMETRY_COLLECTION = "securityTelemetry";

export function getCountryTurnTelemetryCollection(db: Db) {
  return db.collection<CountryTurnRow>(COUNTRY_TURN_TELEMETRY_COLLECTION);
}

export function getSecurityTelemetryCollection(db: Db) {
  return db.collection<SecurityTelemetryRow>(SECURITY_TELEMETRY_COLLECTION);
}
