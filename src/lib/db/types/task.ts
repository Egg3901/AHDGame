import type { ObjectId } from "mongodb";

export type TaskType = "bug" | "feature" | "improvement";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  _id: ObjectId;
  title: string; // Max 200 chars
  description: string; // Markdown supported
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  createdBy: ObjectId; // User ID
  completedAt?: Date; // Set when status becomes "completed"
}
