import type { PlayerMail } from "@/lib/db/types";

export type PlayerMailView = Omit<
  PlayerMail,
  "_id" | "fromCharacterId" | "toUserId" | "toCharacterId" | "createdAt"
> & {
  _id: string;
  fromCharacterId: string | null;
  toUserId: string;
  toCharacterId: string;
  createdAt: string;
};

export function serializePlayerMail(mail: PlayerMail): PlayerMailView {
  return {
    ...mail,
    _id: mail._id.toString(),
    fromCharacterId: mail.fromCharacterId?.toString() ?? null,
    toUserId: mail.toUserId.toString(),
    toCharacterId: mail.toCharacterId.toString(),
    createdAt: mail.createdAt.toISOString(),
  };
}
