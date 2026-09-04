"use client";

import { useState } from "react";
import { Button, Input, Label } from "@/components/ui";

import {
  isValidCustomOrganizationSlug,
  INTERNATIONAL_ORGANIZATION_ORDER,
  INTERNATIONAL_ORGANIZATIONS,
} from "@/lib/constants/internationalOrganizations";
import {
  CREATABLE_ORGANIZATION_CATEGORIES,
  ORGANIZATION_CATEGORY_META,
  type OrganizationCategory,
} from "@/lib/constants/orgCategory";
import type { OrgViewerInfo } from "../orgTypes";
import { useEntityName } from "../useEntityName";

/** Derive a URL-safe, lowercase org id from the short name (players never see the slug). */
function slugifyOrgName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

interface FormState {
  name: string;
  shortName: string;
  description: string;
  charter: string;
  leadershipTitle: string;
  category: OrganizationCategory;
}

const EMPTY_FORM: FormState = {
  name: "",
  shortName: "",
  description: "",
  charter: "",
  leadershipTitle: "Secretary-General",
  category: "political",
};

/** Player-facing reserved short names, derived from the catalogue so it cannot go stale. */
const BUILT_IN_ORG_SHORT_NAMES = INTERNATIONAL_ORGANIZATION_ORDER.map(
  (id) => INTERNATIONAL_ORGANIZATIONS[id].shortName
).join(", ");

/**
 * "Found a new international organization" form, available to a foreign minister
 * / head of government. The lowercase URL id is derived from the short name. On
 * success calls `onCreated(orgId)` (the index routes to the new org's page).
 */
export function CreateOrgForm({
  viewer,
  onCreated,
}: {
  viewer: OrgViewerInfo | null;
  onCreated: (orgId: string) => void;
}) {
  const entityName = useEntityName();
  const viewerCountry = viewer?.foreignMinisterOf ?? viewer?.headOfGovernmentOf ?? null;
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const LOGO_MAX_BYTES = 2 * 1024 * 1024;
  const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  async function uploadLogo(file: File) {
    setLogoError(null);
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError("Use a PNG, JPEG, WebP, or GIF image.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError("Logo must be under 2 MB.");
      return;
    }
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("orgId", slugifyOrgName(form.shortName.trim()));
      const res = await fetch("/api/upload/org-logo", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Upload failed");
      setLogoPath(body.url as string);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLogoUploading(false);
    }
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setLogoPath(null);
    setLogoError(null);
  }

  async function submit() {
    if (!viewerCountry) return;
    const id = slugifyOrgName(form.shortName.trim());
    if (!isValidCustomOrganizationSlug(id)) {
      setError(
        `Short name must be 2-5 letters/digits and not match a built-in org (${BUILT_IN_ORG_SHORT_NAMES}).`
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/country/${viewerCountry}/international-organizations/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id,
          name: form.name.trim(),
          shortName: form.shortName.trim(),
          description: form.description.trim(),
          charter: form.charter.trim(),
          leadershipTitle: form.leadershipTitle.trim(),
          category: form.category,
          ...(logoPath ? { logoPath } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Failed to create organization");
      setShowForm(false);
      resetForm();
      if (body?.organizationId) onCreated(body.organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organization");
    } finally {
      setSubmitting(false);
    }
  }

  if (!viewerCountry) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          variant={showForm ? "ghost" : "primary"}
          size="md"
          onClick={() => {
            setShowForm((v) => !v);
            setError(null);
          }}
        >
          {showForm ? "Cancel" : "Found new organization"}
        </Button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
          <h3 className="text-sm font-semibold text-foreground">
            Found a new international organization
          </h3>
          <p className="mt-1 text-xs text-muted">
            {entityName(viewerCountry)} will become the sole founding member. Other countries can
            apply to join.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="org-name">Full name</Label>
              <Input
                id="org-name"
                placeholder="East Asia Pact"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                maxLength={80}
              />
            </div>
            <div>
              <Label htmlFor="org-shortName">Short name</Label>
              <Input
                id="org-shortName"
                placeholder="EAP"
                value={form.shortName}
                onChange={(e) => update("shortName", e.target.value)}
                maxLength={5}
              />
              <p className="mt-1 text-[11px] text-muted">
                Up to 5 characters. Forms the page address (lowercased) — e.g. EAP → /eap.
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="org-description">Description</Label>
              <textarea
                id="org-description"
                rows={2}
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                maxLength={500}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                placeholder="Short summary of the organization's purpose."
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="org-charter">Charter</Label>
              <textarea
                id="org-charter"
                rows={4}
                value={form.charter}
                onChange={(e) => update("charter", e.target.value)}
                maxLength={2000}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none"
                placeholder="Founding principles, obligations, scope."
              />
            </div>
            <div>
              <Label htmlFor="org-title">Leadership title</Label>
              <Input
                id="org-title"
                placeholder="Secretary-General"
                value={form.leadershipTitle}
                onChange={(e) => update("leadershipTitle", e.target.value)}
                maxLength={60}
              />
            </div>
            <div>
              <Label htmlFor="org-category">Category</Label>
              <select
                id="org-category"
                value={form.category}
                onChange={(e) => update("category", e.target.value as OrganizationCategory)}
                className="mt-1 w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              >
                {CREATABLE_ORGANIZATION_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ORGANIZATION_CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted">
                {ORGANIZATION_CATEGORY_META[form.category].blurb}
              </p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="org-logo">Logo (optional)</Label>
              <div className="mt-1 flex items-center gap-3">
                {logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPath}
                    alt="Organization logo preview"
                    className="h-12 w-12 rounded-lg border border-card-border object-contain"
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-card-border text-[10px] text-muted">
                    none
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <input
                    id="org-logo"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    disabled={logoUploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadLogo(f);
                    }}
                    className="text-xs text-muted file:mr-2 file:rounded-md file:border file:border-card-border file:bg-card file:px-2 file:py-1 file:text-xs file:text-foreground"
                  />
                  {logoPath && (
                    <button
                      type="button"
                      onClick={() => setLogoPath(null)}
                      className="self-start text-[11px] text-muted hover:text-foreground"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {logoUploading ? "Uploading…" : "Square works best. PNG/JPEG/WebP/GIF, up to 2 MB."}
              </p>
              {logoError && <p className="mt-1 text-[11px] text-error">{logoError}</p>}
            </div>
          </div>
          {error && <p className="mt-3 text-xs text-error">{error}</p>}
          <div className="mt-4 flex gap-2">
            <Button variant="primary" size="md" onClick={submit} isLoading={submitting}>
              Found organization
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                setShowForm(false);
                resetForm();
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
