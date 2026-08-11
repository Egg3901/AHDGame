import type { ObjectId } from "mongodb";
import type { TaskStatus } from "./task";

export type CommentAuthor = "user" | "claude";

export interface TaskComment {
  _id: ObjectId;
  taskId: ObjectId;
  body: string;
  author: CommentAuthor;
  statusChange?: TaskStatus; // set when this comment triggered a status update
  createdAt: Date;
}
