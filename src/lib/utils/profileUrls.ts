// src/lib/utils/profileUrls.ts
import { isHexObjectIdString } from "./objectIdHex";

type IdLike = string | { toString(): string };

/**
 * Build URL for character profile page.
 * Prefers sequentialId, falls back to ObjectId for unmigrated data.
 */
export function buildCharacterHref(character: { sequentialId?: number; _id?: IdLike }): string {
  if (character.sequentialId) {
    return `/character/${character.sequentialId}`;
  }
  return `/character/${character._id?.toString()}`;
}

/**
 * Build URL for NPP profile page.
 * Prefers sequentialId, falls back to ObjectId for unmigrated data.
 */
export function buildNppHref(npp: { sequentialId?: number; _id?: IdLike }): string {
  if (npp.sequentialId) {
    return `/politicians/npp/${npp.sequentialId}`;
  }
  return `/politicians/npp/${npp._id?.toString()}`;
}

/**
 * Format NPP ID for display contexts (e.g., "NPP-1" in candidate lists).
 * Note: URLs use plain numbers (/politicians/npp/1), this is for display only.
 */
export function formatNppDisplayId(sequentialId: number): string {
  return `NPP-${sequentialId}`;
}

type ParsedId = { type: "sequential"; value: number } | { type: "objectId"; value: string };

/**
 * Parse character ID from URL parameter.
 * Returns null for invalid IDs.
 */
export function parseCharacterId(id: string): ParsedId | null {
  // Numeric = sequential ID
  if (/^\d+$/.test(id)) {
    return { type: "sequential", value: parseInt(id, 10) };
  }
  // 24-char hex = ObjectId (legacy)
  if (isHexObjectIdString(id)) {
    return { type: "objectId", value: id };
  }
  return null;
}

/**
 * Parse NPP ID from URL parameter.
 * Returns null for invalid IDs.
 */
export function parseNppId(id: string): ParsedId | null {
  // Numeric = sequential ID
  if (/^\d+$/.test(id)) {
    return { type: "sequential", value: parseInt(id, 10) };
  }
  // 24-char hex = ObjectId (legacy)
  if (isHexObjectIdString(id)) {
    return { type: "objectId", value: id };
  }
  return null;
}
