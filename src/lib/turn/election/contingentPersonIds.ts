import { ObjectId } from "mongodb";

export type ContingentPersonRef =
  { kind: "character"; characterId: string } | { kind: "npp"; nppId: string };

export function isNppContingentId(id: string): boolean {
  return id.startsWith("npp_");
}

export function parseContingentPersonId(id: string): ContingentPersonRef {
  if (isNppContingentId(id)) {
    return { kind: "npp", nppId: id.slice(4) };
  }
  return { kind: "character", characterId: id };
}

export function toNppObjectId(id: string): ObjectId {
  if (!isNppContingentId(id)) {
    throw new Error(`Expected NPP contingent id (npp_*), got: ${id}`);
  }
  return new ObjectId(id.slice(4));
}

export function toCharacterObjectId(id: string): ObjectId {
  if (isNppContingentId(id)) {
    throw new Error(`Expected character contingent id, got NPP: ${id}`);
  }
  return new ObjectId(id);
}
