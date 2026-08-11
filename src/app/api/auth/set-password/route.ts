import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { parseJsonBody } from "@/lib/api/validate";
import { setPasswordSchema } from "@/lib/api/schemas/settings";
import { checkRateLimit, rateLimitResponse } from "@/lib/api/rateLimit";

// POST /api/auth/set-password — Sets a password for a social-only account that has no existing password.
// Auth: requireBasicAuth
// Errors: 400, 401, 404, 429
export async function POST(request: Request) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const userId = auth.user.userId;

    const rateLimit = checkRateLimit(userId, 10, 60000);
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const parsed = await parseJsonBody(request, setPasswordSchema);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { newPassword } = parsed.data;

    const db = await getDb();
    const usersCollection = db.collection("users");

    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only allow setting password if user doesn't have one (social-only accounts)
    if (user.password) {
      return NextResponse.json(
        { error: "Password already set. Use change password instead." },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await usersCollection.updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          password: hashedPassword,
          passwordChangedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ message: "Password set successfully" });
  } catch (error) {
    return handleRouteError(error);
  }
}
