import type { Db } from "mongodb";
import type { Task } from "../types/task";

export function getTasksCollection(db: Db) {
  return db.collection<Task>("tasks");
}
