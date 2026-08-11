/**
 * GET /api/admin/country/[code]/region/[id]/vacant-seats
 * Admin: get vacant seat information for a region.
 * Moved from /api/admin/state/[id]/vacant-seats.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import {
  COUNTRY_CONFIGS,
  getRegionAppointableSeats,
  type CountryId,
  type RegionAppointableSeatSpec,
} from "@/lib/constants/countries";
import type { ElectedOfficial, State, SenateClass } from "@/lib/db/types";
import { SENATE_CLASSES } from "@/lib/constants";
import { subNationalChamberSeats } from "@/lib/constants/states";
import { getGameStatePreset } from "@/lib/db/collections/gameState";
import { handleRouteError } from "@/lib/api/errors";

/** A region seat group as rendered/validated by the admin seat appointer. */
interface SeatGroup {
  officeType: string;
  label: string;
  groupLabel: string;
  kind: RegionAppointableSeatSpec["kind"];
  multiSeat: boolean;
  vacant: number;
  total: number;
  /** Present only for the US-style classed senate group. */
  classes?: { class: SenateClass; isVacant: boolean }[];
}

/** Total seat count for a multi-seat group, read from the resolved State field. */
function totalForSpec(
  spec: RegionAppointableSeatSpec,
  state: State,
  countryId: CountryId,
  preset: string | undefined
): number {
  // The sub-national chamber is country-resolved: for CN it is the elected
  // People's Congress (not `stateSenateSeats`, which is the appointed CPPCC).
  if (spec.kind === "subNationalChamber") return subNationalChamberSeats(countryId, state, preset);
  if (spec.totalsByRegion) return spec.totalsByRegion[state._id] ?? 0;
  if (spec.totalField === "houseDistricts") return state.houseDistricts ?? 0;
  if (spec.totalField === "stateSenateSeats") return state.stateSenateSeats ?? 0;
  return 0;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { code, id } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country code" }, { status: 404 });
    }

    const stateId = id;

    const db = await getDb();

    // Verify state exists
    const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
    if (!state) {
      return NextResponse.json({ error: "State not found" }, { status: 404 });
    }

    // Get all elected officials for this state
    const officials = await db
      .collection<ElectedOfficial>("electedOfficials")
      .find({ state: stateId })
      .toArray();
    const isFilled = (o: ElectedOfficial) => Boolean(o.characterId || o.nppId);

    // Build the country's region-appointable seat groups from config — no
    // hardcoded US offices. Each group reports live vacancy for this region.
    const specs = getRegionAppointableSeats(countryId);
    // Era-sized chambers (CN: 1,226 deputies in 1953 vs 2,980 modern) need the
    // active preset, resolved once outside the per-spec map.
    const preset = await getGameStatePreset(db);
    const seatGroups: SeatGroup[] = specs.map((spec) => {
      const groupOfficials = officials.filter((o) => o.officeType === spec.officeType);
      const base = {
        officeType: spec.officeType,
        label: spec.label,
        groupLabel: spec.groupLabel,
        kind: spec.kind,
        multiSeat: spec.multiSeat,
      };

      if (spec.kind === "executive") {
        const filled = groupOfficials.some(isFilled);
        return { ...base, vacant: filled ? 0 : 1, total: 1 };
      }

      if (spec.kind === "classedUpper") {
        // US Senate: 2-of-3 classes per state, keyed by SENATE_CLASSES.
        const stateClasses = (SENATE_CLASSES[stateId] || [1, 2]) as [SenateClass, SenateClass];
        const filledClasses = new Set(groupOfficials.filter(isFilled).map((o) => o.senateClass));
        const classes = stateClasses.map((cls) => ({
          class: cls,
          isVacant: !filledClasses.has(cls),
        }));
        return {
          ...base,
          classes,
          vacant: classes.filter((c) => c.isVacant).length,
          total: classes.length,
        };
      }

      // Multi-seat chamber (federal lower or sub-national).
      const total = totalForSpec(spec, state, countryId, preset);
      const filled = groupOfficials
        .filter(isFilled)
        .reduce((sum, o) => sum + (o.seatsHeld ?? 1), 0);
      return { ...base, vacant: Math.max(0, total - filled), total };
    });

    // Get all filled officials for removal UI
    const filledOfficials = officials.filter(isFilled).map((o) => ({
      _id: o._id.toString(),
      officeType: o.officeType,
      senateClass: o.senateClass,
      seatsHeld: o.seatsHeld ?? 1,
      characterId: o.characterId?.toString() ?? null,
      nppId: o.nppId?.toString() ?? null,
      characterName: o.characterName ?? "Unknown",
      party: o.party ?? null,
      isNPP: o.isNPP ?? false,
    }));

    // Legacy mirror so older consumers (the bespoke UK admin tab) keep working
    // unchanged while the generic panel reads `seatGroups`.
    const exec = seatGroups.find((g) => g.kind === "executive");
    const classed = seatGroups.find((g) => g.kind === "classedUpper");
    const lower = seatGroups.find((g) => g.kind === "lowerChamber");
    const sub = seatGroups.find((g) => g.kind === "subNationalChamber");

    return NextResponse.json({
      seatGroups,
      filledOfficials,
      // ── legacy fields (UK tab + pre-generalization callers) ──
      senateSeats: classed?.classes ?? [],
      houseVacant: lower?.vacant ?? 0,
      houseTotal: lower?.total ?? 0,
      governorVacant: exec ? exec.vacant > 0 : true,
      stateSenateVacant: sub?.vacant ?? 0,
      stateSenateTotal: sub?.total ?? 0,
      commonsVacant: lower?.vacant ?? 0,
      commonsTotal: lower?.total ?? 0,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
