import type { ObjectId } from "mongodb";

export type LessonCategory = "bug" | "design" | "process" | "technical" | "general";

export interface TaskLesson {
  _id: ObjectId;
  taskId: ObjectId | null; // null for general (non-task-specific) lessons
  lesson: string;
  category: LessonCategory;
  tags: string[];
  createdAt: Date;
}
