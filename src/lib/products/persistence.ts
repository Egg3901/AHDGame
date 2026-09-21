import type { Db } from "mongodb";
import { MongoServerError } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getProductKind } from "./catalog";
import { startProductDevelopment } from "./lifecycle";
import { MEDIA_OPERATING_MODELS } from "./types";
import type { CorporationProduct, MediaOperatingModel, ProductDraft } from "./types";

export const CORPORATION_PRODUCTS_COLLECTION = "corporationProducts";
export const CORPORATION_OPERATING_MODELS_COLLECTION = "corporationOperatingModels";

/**
 * Unique slot enforcing exactly one non-retired product per corporation.
 * `activeCorporationId` is present only while the product is non-retired, so
 * the partial filter (equality-free, `$exists`-only) is legal on standalone
 * Mongo and the constraint holds without multi-document transactions.
 */
export const ACTIVE_PRODUCT_INDEX_NAME = "unique_active_product_per_corporation_v1";
export const OPERATING_MODEL_INDEX_NAME = "unique_operating_model_per_corporation_v1";

export interface CorporationProductDocument extends CorporationProduct {
  _id: string;
  /**
   * Slot key: the owning corporation while the product is non-retired,
   * absent once retired. Retiring `$unset`s this field in the same
   * single-document write that stamps `stage: "retired"`, freeing the slot
   * atomically.
   */
  activeCorporationId?: string;
}

export interface CorporationOperatingModelDocument {
  _id: string;
  corporationId: string;
  operatingModel: MediaOperatingModel;
  acquiredTurn: number;
}

export type PersistProductResult =
  | { ok: true; product: CorporationProductDocument; idempotent?: boolean }
  | { ok: false; reason: "feature_disabled" | "unknown_product_kind" | "active_product" };

export type RetireProductResult =
  | { ok: true; product: CorporationProductDocument }
  | { ok: false; reason: "not_found" | "already_retired" };

export type AddOperatingModelResult =
  | { ok: true; model: CorporationOperatingModelDocument; idempotent?: boolean }
  | { ok: false; reason: "feature_disabled" | "unknown_operating_model" };

export function toProductDocument(product: CorporationProduct): CorporationProductDocument {
  return {
    ...product,
    _id: product.id,
    activeCorporationId: product.stage === "retired" ? undefined : product.corporationId,
  };
}

export async function getCorporationProductsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION);
}

export async function getCorporationOperatingModelsCollection(db?: Db) {
  const database = db ?? (await getDb());
  return database.collection<CorporationOperatingModelDocument>(
    CORPORATION_OPERATING_MODELS_COLLECTION
  );
}

/**
 * Idempotently ensures the product persistence indexes. Plain
 * single-collection `createIndex` calls: no sessions, no transactions, safe on
 * standalone Mongo.
 */
export async function ensureCorporationProductIndexes(db: Db): Promise<string[]> {
  const products = db.collection(CORPORATION_PRODUCTS_COLLECTION);
  const models = db.collection(CORPORATION_OPERATING_MODELS_COLLECTION);
  await products.createIndex(
    { activeCorporationId: 1 },
    {
      name: ACTIVE_PRODUCT_INDEX_NAME,
      unique: true,
      partialFilterExpression: { activeCorporationId: { $exists: true } },
    }
  );
  await models.createIndex(
    { corporationId: 1, operatingModel: 1 },
    { name: OPERATING_MODEL_INDEX_NAME, unique: true }
  );
  return [ACTIVE_PRODUCT_INDEX_NAME, OPERATING_MODEL_INDEX_NAME];
}

function isDuplicateKey(error: unknown): boolean {
  return (
    (error instanceof MongoServerError && error.code === 11000) ||
    (typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code === 11000
      : false)
  );
}

function duplicateIndexName(error: unknown): string {
  const keyPattern = (error as { keyPattern?: Record<string, unknown> } | null)?.keyPattern;
  if (keyPattern) {
    if ("activeCorporationId" in keyPattern) return ACTIVE_PRODUCT_INDEX_NAME;
    if ("_id" in keyPattern) return "_id_";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(ACTIVE_PRODUCT_INDEX_NAME)) return ACTIVE_PRODUCT_INDEX_NAME;
  if (message.includes("_id_")) return "_id_";
  return "";
}

/**
 * Starts a product project with the one-active-product invariant enforced by
 * the unique slot index: a single `insertOne`, no read-modify-write, no
 * transaction. Contending inserts fail with duplicate-key and map to
 * `active_product`. Retrying the same draft after a success (or a lost
 * response) returns the stored document with `idempotent: true`.
 *
 * Flag-off (or unknown kind) performs zero writes: the checks run before any
 * collection is touched.
 */
export async function startProductPersistent(
  db: Db,
  args: { enabled: boolean; draft: ProductDraft }
): Promise<PersistProductResult> {
  if (!args.enabled) return { ok: false, reason: "feature_disabled" };
  if (!getProductKind(args.draft.kindId)) {
    return { ok: false, reason: "unknown_product_kind" };
  }
  const built = startProductDevelopment({ enabled: true, activeProduct: null, draft: args.draft });
  if (!built.ok) return built;
  const doc = toProductDocument(built.product);

  const collection = db.collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION);
  try {
    await collection.insertOne(doc);
    return { ok: true, product: doc };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const index = duplicateIndexName(error);
    if (index === ACTIVE_PRODUCT_INDEX_NAME) {
      return { ok: false, reason: "active_product" };
    }
    // Same product id already stored: idempotent retry, not contention.
    const existing = await collection.findOne({ _id: doc._id } as never);
    if (existing && existing.corporationId === doc.corporationId) {
      return { ok: true, product: existing, idempotent: true };
    }
    return { ok: false, reason: "active_product" };
  }
}

/**
 * Retires a product and frees its corporation slot in one single-document
 * atomic update. Afterwards the corporation may start a new product.
 */
export async function retireProductPersistent(
  db: Db,
  args: { productId: string; turn: number }
): Promise<RetireProductResult> {
  const collection = db.collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION);
  const result = await collection.updateOne(
    { _id: args.productId, activeCorporationId: { $exists: true } } as never,
    {
      $set: { stage: "retired", retiredTurn: args.turn },
      $unset: { activeCorporationId: "" },
    }
  );
  if (result.matchedCount === 0) {
    const existing = await collection.findOne({ _id: args.productId } as never);
    return existing ? { ok: false, reason: "already_retired" } : { ok: false, reason: "not_found" };
  }
  const retired = await collection.findOne({ _id: args.productId } as never);
  return retired ? { ok: true, product: retired } : { ok: false, reason: "not_found" };
}

/** Reads the corporation's current non-retired product, if any. */
export async function getActiveProduct(
  db: Db,
  corporationId: string
): Promise<CorporationProductDocument | null> {
  const collection = db.collection<CorporationProductDocument>(CORPORATION_PRODUCTS_COLLECTION);
  return collection.findOne({ activeCorporationId: corporationId } as never);
}

/**
 * Attaches a Media & Entertainment operating model to a corporation. A
 * corporation may own several models; re-adding an owned model is an
 * idempotent success. Gated on the same flag as product starts.
 */
export async function addOperatingModelPersistent(
  db: Db,
  args: { enabled: boolean; corporationId: string; operatingModel: string; turn: number }
): Promise<AddOperatingModelResult> {
  if (!args.enabled) return { ok: false, reason: "feature_disabled" };
  if (!(MEDIA_OPERATING_MODELS as readonly string[]).includes(args.operatingModel)) {
    return { ok: false, reason: "unknown_operating_model" };
  }
  const model = args.operatingModel as MediaOperatingModel;
  const doc: CorporationOperatingModelDocument = {
    _id: `${args.corporationId}:${model}`,
    corporationId: args.corporationId,
    operatingModel: model,
    acquiredTurn: args.turn,
  };
  const collection = db.collection<CorporationOperatingModelDocument>(
    CORPORATION_OPERATING_MODELS_COLLECTION
  );
  try {
    await collection.insertOne(doc);
    return { ok: true, model: doc };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await collection.findOne({ _id: doc._id } as never);
    if (existing) return { ok: true, model: existing, idempotent: true };
    throw error;
  }
}

/** Lists every operating model owned by a corporation. */
export async function listOperatingModels(
  db: Db,
  corporationId: string
): Promise<CorporationOperatingModelDocument[]> {
  const collection = db.collection<CorporationOperatingModelDocument>(
    CORPORATION_OPERATING_MODELS_COLLECTION
  );
  return collection.find({ corporationId } as never).toArray();
}

export { MEDIA_OPERATING_MODELS };
export type { MediaOperatingModel };
