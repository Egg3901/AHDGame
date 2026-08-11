import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError } from "@/lib/api/errors";
import { PATREON_BORDER_OPTIONS, type ProfileBorderKey, type User } from "@/lib/db/types";
import { isPatreonActive, isPlusOrBetter } from "@/lib/db/types";

const borderKeys = PATREON_BORDER_OPTIONS.map((option) => option.key) as [
  ProfileBorderKey,
  ...ProfileBorderKey[],
];
const adPreferenceKeys = ["ad-free", "player-only", "all-ads"] as const;
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const supporterBorderGroups = new Set(["default", "static"]);

function getPatreonAdPreference(user: User): "ad-free" | "player-only" | "all-ads" {
  if (user.patreonAdPreference) return user.patreonAdPreference;
  return user.adsDisabled ? "ad-free" : "all-ads";
}

const patchSchema = z.object({
  adsDisabled: z.boolean().optional(),
  patreonAdPreference: z.enum(adPreferenceKeys).optional(),
  patreonHighlightColor: z
    .string()
    .regex(HEX_COLOR_REGEX, "Highlight color must be a 6-digit hex color")
    .nullable()
    .optional(),
  patreonProfileBorder: z.enum(borderKeys).nullable().optional(),
});

export async function PATCH(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, patchSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);
    const user = await db.collection<User>("users").findOne({ _id: userId });
    // Admins bypass Patreon requirements — full access to all cosmetic features
    const isAdmin = user?.role === "admin" || user?.isAdmin;
    if (
      !isAdmin &&
      (!user || !isPatreonActive(user.patreonTier ?? null, user.patreonExpiresAt ?? null))
    ) {
      return NextResponse.json({ error: "Active Patreon status required" }, { status: 403 });
    }

    if (
      parsed.data.patreonProfileBorder !== undefined &&
      parsed.data.patreonProfileBorder !== null
    ) {
      const option = PATREON_BORDER_OPTIONS.find(
        (candidate) => candidate.key === parsed.data.patreonProfileBorder
      );

      if (!option) {
        return NextResponse.json({ error: "Invalid Patreon border option" }, { status: 400 });
      }

      const allowedForTier =
        isAdmin ||
        isPlusOrBetter(user.patreonTier ?? null) ||
        (user.patreonTier === "supporter" && supporterBorderGroups.has(option.group));

      if (!allowedForTier) {
        return NextResponse.json(
          { error: "Supporter+ required for animated and frame borders" },
          { status: 403 }
        );
      }
    }

    const update: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    const unset: Record<string, "" | 1> = {};

    if (parsed.data.adsDisabled !== undefined) {
      update.adsDisabled = parsed.data.adsDisabled;
    }
    if (parsed.data.patreonAdPreference !== undefined) {
      update.patreonAdPreference = parsed.data.patreonAdPreference;
      update.adsDisabled = parsed.data.patreonAdPreference === "ad-free";
    }
    if (parsed.data.patreonHighlightColor !== undefined) {
      if (parsed.data.patreonHighlightColor === null) {
        unset.patreonHighlightColor = "";
      } else {
        update.patreonHighlightColor = parsed.data.patreonHighlightColor;
      }
    }
    if (parsed.data.patreonProfileBorder !== undefined) {
      if (parsed.data.patreonProfileBorder === null) {
        unset.patreonProfileBorder = "";
      } else {
        update.patreonProfileBorder = parsed.data.patreonProfileBorder;
      }
    }

    await db.collection<User>("users").updateOne(
      { _id: userId },
      {
        $set: update,
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      }
    );

    return NextResponse.json({
      success: true,
      adsDisabled: update.adsDisabled ?? user.adsDisabled ?? false,
      patreonAdPreference: parsed.data.patreonAdPreference ?? getPatreonAdPreference(user),
      patreonHighlightColor:
        parsed.data.patreonHighlightColor === undefined
          ? (user.patreonHighlightColor ?? null)
          : parsed.data.patreonHighlightColor,
      patreonProfileBorder:
        parsed.data.patreonProfileBorder === undefined
          ? (user.patreonProfileBorder ?? null)
          : parsed.data.patreonProfileBorder,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
