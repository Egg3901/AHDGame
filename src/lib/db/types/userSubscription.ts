import type { ObjectId } from "mongodb";

export interface UserSubscription {
  _id: ObjectId;
  subscriberUserId: ObjectId;
  subscriberCharacterId: ObjectId;
  subscribedToCharacterId: ObjectId;
  createdAt: Date;
}
