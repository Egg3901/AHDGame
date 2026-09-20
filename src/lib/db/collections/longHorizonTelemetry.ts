import type { Db } from "mongodb";
import type {
  ApprovalTelemetryPoint,
  MacroTelemetryPoint,
} from "@/lib/db/types/longHorizonTelemetry";

export const APPROVAL_TELEMETRY_COLLECTION = "approvalTelemetry";
export const MACRO_TELEMETRY_COLLECTION = "macroTelemetry";

export function getApprovalTelemetryCollection(db: Db) {
  return db.collection<ApprovalTelemetryPoint>(APPROVAL_TELEMETRY_COLLECTION);
}

export function getMacroTelemetryCollection(db: Db) {
  return db.collection<MacroTelemetryPoint>(MACRO_TELEMETRY_COLLECTION);
}
