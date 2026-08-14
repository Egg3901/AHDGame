// POST /api/country/[code]/executive/cabinet/[positionId]/setting
// Auth: requireAuth — must be cabinet holder or admin
// Errors: 400, 401, 403, 404
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { getCabinetMechanics } from "@/lib/constants/cabinetMechanics";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import { getCabinetSettingsCollection } from "@/lib/db/collections/cabinetSettings";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import { getGameState } from "@/lib/gameState";
import {
  blockedSettingChange,
  requestedSettingCooldownFields,
  stampsForSettingChange,
} from "@/lib/cabinet/settingCooldowns";
import { z } from "zod";

const settingSchema = z.object({
  tierSetting: z.string().nullable().optional(),
  // Per-key selections for seats carrying extra policy levers (mechanics.tierSettings[]).
  tierSettings: z.record(z.string(), z.string()).optional(),
  targetRegionId: z.string().nullable().optional(),
  targetCountryId: z.string().nullable().optional(),
  aidPriority: z.enum(["economic", "humanitarian", "security"]).nullable().optional(),
  advocacyActive: z.boolean().optional(),
});

interface RouteParams {
  params: Promise<{ code: string; positionId: string }>;
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireAuth();
    if (!auth.ok) return auth.response;

    const { code, positionId } = await params;
    const countryId = code.toUpperCase() as CountryId;
    if (!COUNTRY_CONFIGS[countryId]) {
      return NextResponse.json({ error: "Invalid country" }, { status: 400 });
    }

    const mechanics = getCabinetMechanics(countryId, positionId);
    if (!mechanics) {
      return NextResponse.json({ error: "Unknown cabinet position" }, { status: 404 });
    }

    const parsed = await parseJsonBody(request, settingSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const db = await getDb();
    const member = await getCabinetMembersCollection(db).findOne({ countryId, positionId });

    // Auth: must be holder or admin
    const isHolder =
      member &&
      member.characterId &&
      auth.user.character &&
      member.characterId.toString() === auth.user.character._id.toString();
    const isAdmin = auth.user.isAdmin;
    if (!isHolder && !isAdmin) {
      return NextResponse.json(
        { error: "Only the cabinet holder or admin can change settings" },
        { status: 403 }
      );
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;
    const settingsCol = getCabinetSettingsCollection(db);
    const existing = await settingsCol.findOne({ _id: `${countryId}_${positionId}` });

    // Rate limit: each non-toggle lever has its own 24-turn cooldown. Allocation
    // changes track lastAllocationChangedTurn on a separate route.
    const isToggleOnly =
      parsed.data.advocacyActive !== undefined && Object.keys(parsed.data).length === 1;
    const cooldownFields = requestedSettingCooldownFields(parsed.data);
    const blocked = isToggleOnly
      ? null
      : blockedSettingChange(existing, cooldownFields, currentTurn);
    if (blocked) {
      return NextResponse.json(
        {
          error: `Settings can only be changed once per 24 turns. ${blocked.turnsRemaining} turns remaining.`,
        },
        { status: 400 }
      );
    }

    // Validate tier setting value
    if (parsed.data.tierSetting && mechanics.tierSetting) {
      const validTiers = mechanics.tierSetting.options.map((o) => o.id);
      if (!validTiers.includes(parsed.data.tierSetting)) {
        return NextResponse.json({ error: "Invalid tier setting" }, { status: 400 });
      }
    }

    // Validate extra-tier selections against their matching config by key
    if (parsed.data.tierSettings) {
      for (const [key, value] of Object.entries(parsed.data.tierSettings)) {
        const cfg = mechanics.tierSettings?.find((t) => t.key === key);
        if (!cfg) {
          return NextResponse.json({ error: `Unknown tier '${key}'` }, { status: 400 });
        }
        if (!cfg.options.some((o) => o.id === value)) {
          return NextResponse.json(
            { error: `Invalid selection for tier '${key}'` },
            { status: 400 }
          );
        }
      }
    }

    if (parsed.data.targetCountryId) {
      const enabledCountryIds = await getEnabledCountryIds();
      const validTargetCountryIds = enabledCountryIds.filter(
        (enabledCountryId) => enabledCountryId !== countryId
      );
      if (!validTargetCountryIds.includes(parsed.data.targetCountryId as CountryId)) {
        return NextResponse.json(
          { error: "Target country must be player-enabled and different from the home country" },
          { status: 400 }
        );
      }
    }

    const update: Record<string, unknown> = {
      countryId,
      positionId,
      characterId: member?.characterId ?? auth.user.character?._id,
      updatedAt: new Date(),
    };

    if (parsed.data.tierSetting !== undefined) update.tierSetting = parsed.data.tierSetting;
    // Merge extra-tier selections by dotted path so levers change independently.
    if (parsed.data.tierSettings) {
      for (const [key, value] of Object.entries(parsed.data.tierSettings)) {
        update[`tierSettings.${key}`] = value;
      }
    }
    if (parsed.data.targetRegionId !== undefined)
      update.targetRegionId = parsed.data.targetRegionId;
    if (parsed.data.targetCountryId !== undefined)
      update.targetCountryId = parsed.data.targetCountryId;
    if (parsed.data.aidPriority !== undefined) update.aidPriority = parsed.data.aidPriority;
    if (parsed.data.advocacyActive !== undefined)
      update.advocacyActive = parsed.data.advocacyActive;
    if (!isToggleOnly) Object.assign(update, stampsForSettingChange(cooldownFields, currentTurn));

    await settingsCol.updateOne(
      { _id: `${countryId}_${positionId}` },
      { $set: update },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
