import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { parseJsonBody } from "@/lib/api/validate";
import { adminLawTypesCreateSchema } from "@/lib/api/schemas/admin";
import type { LegislationType } from "@/lib/db/types";
import { legislationTypes as seedLegislationTypes } from "@/lib/seeds/reference/legislationTypes";
import type { LegislationTypePosition } from "@/lib/db/types/legislation";

// GET /api/admin/law-types — Lists all legislation types, merging seed definitions with admin-created overrides.
// Auth: requireAdmin
// Errors: 401, 403
export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();

    // Get admin-created from DB
    const adminTypes = await db
      .collection<LegislationType>("legislationTypes")
      .find({ source: "admin" })
      .toArray();

    // Mark seed types with source
    const seedTypesWithSource = seedLegislationTypes.map((t) => ({
      ...t,
      source: "seed" as const,
    }));

    // Combine, admin types override seed if same _id
    const adminIds = new Set(adminTypes.map((t) => t._id));
    const combined = [...seedTypesWithSource.filter((t) => !adminIds.has(t._id)), ...adminTypes];

    // Sort by policyDomain then name
    combined.sort((a, b) => {
      if (a.policyDomain !== b.policyDomain) {
        return a.policyDomain.localeCompare(b.policyDomain);
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ lawTypes: combined });
  } catch (error) {
    return handleRouteError(error);
  }
}

// POST /api/admin/law-types — Creates a new admin-defined legislation type, optionally marking it permanent.
// Auth: requireAdmin
// Errors: 400, 401, 403, 409
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const parsed = await parseJsonBody(request, adminLawTypesCreateSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const {
      _id,
      name,
      policyDomain,
      description,
      subCategory,
      allowedScope,
      effectTargets,
      demographicTargeting,
      positions,
      policyOptions,
      budgetCost,
      budgetCategory,
      isPermanent,
    } = parsed.data;

    const db = await getDb();

    // Check for duplicate ID
    const existing = await db.collection<LegislationType>("legislationTypes").findOne({ _id });
    const seedExists = seedLegislationTypes.some((t) => t._id === _id);

    if (existing || seedExists) {
      return NextResponse.json(
        { error: `Law type with ID "${_id}" already exists` },
        { status: 409 }
      );
    }

    const lawType: LegislationType = {
      _id,
      name,
      description: description || "",
      policyDomain,
      subCategory: subCategory || "",
      allowedScope: allowedScope || "both",
      effectTargets: effectTargets || [],
      demographicTargeting: demographicTargeting || [],
      positions: (positions || []) as LegislationTypePosition[],
      policyOptions: policyOptions || [],
      budgetCost: budgetCost || 0,
      budgetCategory: budgetCategory || "",
      source: "admin",
      isPermanent: isPermanent || false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.collection<LegislationType>("legislationTypes").insertOne(lawType);

    // If marked as permanent, write to seed file
    if (isPermanent) {
      const { writeAdminSeedFile } = await import("@/lib/admin/seedFileGenerator");
      const permanentTypes = await db
        .collection<LegislationType>("legislationTypes")
        .find({ source: "admin", isPermanent: true })
        .toArray();
      await writeAdminSeedFile(permanentTypes);
    }

    return NextResponse.json({ lawType, message: "Law type created successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
