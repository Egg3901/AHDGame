import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAuthAdmin } from "@/lib/auth";
import { TasksPageClient } from "./TasksPageClient";

export default async function AdminTasksPage() {
  const user = await getAuthAdmin();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-card-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-center justify-between py-5">
            <div className="flex items-center gap-4">
              <div className="h-10 w-1 flex-shrink-0 rounded-full bg-primary" />
              <div>
                <h1 className="text-lg font-bold">Tasks</h1>
                <p className="mt-0.5 text-xs text-muted">Track bugs, features, and improvements</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          }
        >
          <TasksPageClient />
        </Suspense>
      </div>
    </div>
  );
}
