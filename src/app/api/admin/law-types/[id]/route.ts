import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminLawTypesCreateSchema } from "@/lib/api/schemas/admin";
import type { LegislationType, Bill, BillStatus } from "@/lib/db/types";
import { legislationTypes as seedLegislationTypes } from "@/lib/seeds/reference/legislationTypes";
import type { LegislationTypePosition } from "@/lib/db/types/legislation";

// Partial schema for updates (all fields optional except we need at least one)
const adminLawTypesUpdateSchema = adminLawTypesCreateSchema.omit({ _id: true }).partial();

// Terminal bill statuses that don't count as "active"
const TERMINAL_STATUSES: BillStatus[] = ["signed", "failed", "vetoed", "withdrawn"];

// PUT /api/admin/law-types/[id] — Updates a law type, creating an admin override for seed-defined types.
// Auth: requireAdmin
// Errors: 400, 401, 403, 404
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;

    const parsed = await parseJsonBody(request, adminLawTypesUpdateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const updates = parsed.data;

    // Check if there's anything to update
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields provided for update" }, { status: 400 });
    }

    const db = await getDb();

    // Check if this ID exists (either as seed or admin type)
    const seedType = seedLegislationTypes.find((t) => t._id === id);
    const adminType = await db.collection<LegislationType>("legislationTypes").findOne({ _id: id });

    if (!seedType && !adminType) {
      return NextResponse.json({ error: `Law type "${id}" not found` }, { status: 404 });
    }

    const now = new Date();

    if (seedType) {
      // For seed types, upsert to create/update admin override
      const baseData = adminType || {
        _id: id,
        name: seedType.name,
        description: seedType.description || "",
        policyDomain: seedType.policyDomain,
        subCategory: seedType.subCategory || "",
        allowedScope: seedType.nationalOnly ? "national" : "both",
        effectTargets: [],
        demographicTargeting: [],
        positions: seedType.positions as LegislationTypePosition[],
        policyOptions: seedType.policyOptions || [],
        source: "admin" as const,
        createdAt: now,
      };

      const updatedType: LegislationType = {
        ...baseData,
        ...updates,
        _id: id,
        source: "admin",
        updatedAt: now,
      } as LegislationType;

      await db
        .collection<LegislationType>("legislationTypes")
        .updateOne({ _id: id }, { $set: updatedType }, { upsert: true });

      const isNew = !adminType;
      return NextResponse.json({
        lawType: updatedType,
        message: isNew
          ? "Admin override created for seed law type"
          : "Law type updated successfully",
      });
    } else {
      // Admin type - update directly
      const updatedType = {
        ...updates,
        updatedAt: now,
      } as Partial<LegislationType>;

      await db
        .collection<LegislationType>("legislationTypes")
        .updateOne({ _id: id, source: "admin" }, { $set: updatedType });

      const finalType = await db
        .collection<LegislationType>("legislationTypes")
        .findOne({ _id: id });

      return NextResponse.json({
        lawType: finalType,
        message: "Law type updated successfully",
      });
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

// DELETE /api/admin/law-types/[id] — Deletes an admin-created law type; blocks deletion if active bills reference it.
// Auth: requireAdmin
// Errors: 401, 403, 404, 409
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    // Check if this is a seed type
    const seedType = seedLegislationTypes.find((t) => t._id === id);
    const adminType = await db.collection<LegislationType>("legislationTypes").findOne({ _id: id });

    if (seedType) {
      if (adminType) {
        // Delete the admin override, reverting to seed definition
        await db.collection<LegislationType>("legislationTypes").deleteOne({ _id: id });
        return NextResponse.json({
          message: "Admin override removed; law type reverted to seed definition",
        });
      } else {
        // Cannot delete seed types
        return NextResponse.json(
          { error: "Cannot delete seed-defined law types" },
          { status: 403 }
        );
      }
    }

    // Admin-created type
    if (!adminType) {
      return NextResponse.json({ error: `Law type "${id}" not found` }, { status: 404 });
    }

    // Check for active bills using this legislation type
    // Active = not in terminal status (signed, failed, vetoed, withdrawn)
    const activeBillCount = await db.collection<Bill>("bills").countDocuments({
      $or: [{ legislationTypeId: id }, { "provisions.legislationTypeId": id }],
      status: { $nin: TERMINAL_STATUSES },
    });

    if (activeBillCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete law type: ${activeBillCount} active bill(s) reference it`,
          activeBillCount,
        },
        { status: 409 }
      );
    }

    // Delete the admin type
    await db.collection<LegislationType>("legislationTypes").deleteOne({ _id: id });

    return NextResponse.json({
      message: "Law type deleted successfully",
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
