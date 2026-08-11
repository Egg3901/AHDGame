import { redirect, notFound } from "next/navigation";
import { getAuthUserWithCharacter } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { WikiEditorClient } from "@/components/wiki/WikiEditorClient";

interface EditPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: EditPageProps) {
  const { slug } = await params;
  return {
    title: `Edit ${slug} | A House Divided`,
    description: "Edit wiki page",
  };
}

export default async function WikiEditPage({ params }: EditPageProps) {
  const { slug } = await params;
  const user = await getAuthUserWithCharacter();

  if (!user) {
    redirect(`/login?returnUrl=/wiki/${slug}/edit`);
  }

  const db = await getDb();
  const page = await db.collection("wikiPages").findOne({ slug });

  if (!page) {
    notFound();
  }

  // Moderators may also publish directly (same API access as admins for create/edit/delete).
  const canPublishDirectly = user.isAdmin === true || user.isModerator === true;

  // Allow editing if user is a moderator/admin or the original submitter.
  // (The schema field is `submittedBy`; an earlier version referenced a
  // non-existent `authorId`, which silently blocked every non-admin edit.)
  if (!canPublishDirectly && page.submittedBy?.toString() !== user.userId.toString()) {
    redirect(`/wiki/${slug}`);
  }

  return (
    <div className="min-h-screen bg-background pb-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Edit Wiki Page</h1>
          <p className="mt-1 text-sm text-muted">
            {canPublishDirectly
              ? "Edit and publish changes immediately."
              : "Submit changes for admin review."}
          </p>
        </div>

        <WikiEditorClient
          mode="edit"
          isAdmin={canPublishDirectly}
          initialSlug={slug}
          initialData={{
            title: page.title,
            description: page.description,
            content: page.content,
            category: page.category,
            tags: page.tags || [],
            difficulty: page.difficulty,
            featured: page.featured,
            private: page.private,
          }}
        />
      </div>
    </div>
  );
}
