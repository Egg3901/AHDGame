/**
 * Durable long-horizon telemetry collections (issues #2099, #2100).
 *
 * `approvalTelemetry`: one document per (world, country, region, turn) with
 * approval, net approval and governing-actor provenance. `macroTelemetry`:
 * one document per (world, country, region, metric, turn) for the
 * GDP/population family. Both are append-only per world, indexed, and
 * `runtime` in the seed manifest (wiped on reset, rebuilt by play).
 *
 * The point shapes live in the portable rules core so report builders and
 * future hosts share one contract; this module only re-exports them for
 * collection typing (type-only, erased at runtime).
 */
export type {
  ApprovalTelemetryPoint,
  MacroTelemetryPoint,
  LongHorizonSourceClass,
  TelemetryGoverningActor,
  TelemetryEffectiveManifest,
  TelemetryActorConfiguration,
} from "@/lib/telemetry/longHorizon/rules";
