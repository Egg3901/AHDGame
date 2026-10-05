import type { ClientSession, Db, Document, ObjectId } from "mongodb";
import { resumeFundCommandAudit, type FundCommandAudit } from "./playerCommandAudit";
import { statusResponse } from "@/lib/api/errors";

export interface FundCommandRequest {
  fundId: string;
  kind: "subscribe" | "redeem";
  units: number;
  payCurrency?: string;
}

interface FundCommand extends Document {
  _id: string;
  request: FundCommandRequest;
  state: "pending" | "completed";
  createdAt: Date;
  response?: { status: number; body: Record<string, unknown> };
  audit?: FundCommandAudit;
}

const COLLECTION = "indexFundCommands";

export function pendingFundCommandResponse(operationId: string): Response {
  return statusResponse(409, {
    pending: true,
    operationId,
    error:
      "This fund order has an unconfirmed outcome. Cash or units may already have moved. Retry this same order to check its status; do not place a replacement order. If it remains pending, contact support with the order ID.",
  });
}

/** Claims never expire: an unknown standalone outcome must not be executed twice. */
export async function claimFundCommand(
  db: Db,
  characterId: ObjectId,
  operationId: string,
  request: FundCommandRequest
): Promise<{ key: string; response?: Response }> {
  const key = `fund:${characterId}:${operationId}`;
  const commands = db.collection<FundCommand>(COLLECTION);
  try {
    await commands.insertOne({
      _id: key,
      request,
      state: "pending",
      createdAt: new Date(),
    });
    return { key };
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000))
      throw error;
  }
  const existing = await commands.findOne({ _id: key });
  if (!existing || JSON.stringify(existing.request) !== JSON.stringify(request)) {
    return {
      key,
      response: statusResponse(409, {
        error: "This order ID belongs to a different fund order.",
        pending: true,
        operationId,
      }),
    };
  }
  if (existing.state === "completed" && existing.response) {
    await resumeFundCommandAudit(db, key);
    return {
      key,
      response: statusResponse(existing.response.status, existing.response.body),
    };
  }
  return { key, response: pendingFundCommandResponse(operationId) };
}

/** With a session, the response and financial writes commit or abort together. */
export async function completeFundCommand(
  db: Db,
  key: string,
  body: Record<string, unknown>,
  status = 200,
  session?: ClientSession,
  audit?: FundCommandAudit
): Promise<void> {
  await db.collection<FundCommand>(COLLECTION).updateOne(
    { _id: key, state: "pending" },
    {
      $set: {
        state: "completed",
        response: { status, body },
        completedAt: new Date(),
        ...(audit ? { audit } : {}),
      },
    },
    session ? { session } : undefined
  );
}

/** Retain the accepted valuation before FX or fund writes for status reconciliation. */
export async function recordFundCommandQuote(
  db: Db,
  key: string,
  quote: Record<string, string | number | boolean>
): Promise<void> {
  await db
    .collection<FundCommand>(COLLECTION)
    .updateOne({ _id: key, state: "pending", quote: { $exists: false } }, { $set: { quote } });
}
