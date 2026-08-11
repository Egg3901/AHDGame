import type { Db } from "mongodb";
import type { TaskComment } from "../types/taskComment";

export function getTaskCommentsCollection(db: Db) {
  return db.collection<TaskComment>("taskComments");
}
