import type { Db } from "mongodb";
import type { TaskLesson } from "../types/taskLesson";

export function getTaskLessonsCollection(db: Db) {
  return db.collection<TaskLesson>("taskLessons");
}
