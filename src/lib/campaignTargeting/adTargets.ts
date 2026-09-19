/**
 * Targeted-ad audience pickers must follow the country's Layer-1 dimension
 * order. Unique buckets are first seen from whichever cell happens to come
 * first, which interleaves age/income/education and makes the list look
 * broken.
 */
import { bucketLabel, dimensionLabelFor } from "@/lib/demographics/bucketLabels";
import { getTurnoutTargetsForCountry } from "@/lib/demographics/turnoutTargets";

export type AdTargetKey = { dimension: string; bucket: string };

export interface GroupedAdTargetOption<T extends AdTargetKey> {
  target: T;
  label: string;
}

export interface GroupedAdTargetSection<T extends AdTargetKey> {
  dim: string;
  dimLabel: string;
  options: GroupedAdTargetOption<T>[];
}

function targetId(target: AdTargetKey): string {
  return `${target.dimension}:${target.bucket}`;
}

export function groupAdTargets<T extends AdTargetKey>(
  targets: T[],
  countryId: string,
  preset?: string | null
): GroupedAdTargetSection<T>[] {
  const byId = new Map<string, T>();
  for (const target of targets) byId.set(targetId(target), target);

  const used = new Set<string>();
  const grouped: GroupedAdTargetSection<T>[] = [];

  const take = (dim: string, dimLabel: string, ids: string[]) => {
    const options: GroupedAdTargetOption<T>[] = [];
    for (const id of ids) {
      const target = byId.get(id);
      if (!target) continue;
      used.add(id);
      options.push({ target, label: bucketLabel(id, countryId) });
    }
    if (options.length) grouped.push({ dim, dimLabel, options });
  };

  for (const section of getTurnoutTargetsForCountry(countryId, preset)) {
    take(
      section.dim,
      section.dimLabel,
      section.options.map((option) => option.id)
    );
  }

  const remaining = [...byId.keys()].filter((id) => !used.has(id)).sort();
  const leftover = new Map<string, string[]>();
  for (const id of remaining) {
    const dim = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    const list = leftover.get(dim) ?? [];
    list.push(id);
    leftover.set(dim, list);
  }
  for (const [dim, ids] of leftover) {
    take(dim, dimensionLabelFor(dim, countryId), ids);
  }
  return grouped;
}

export function decorateAdTargets<T extends AdTargetKey>(
  targets: T[],
  countryId: string,
  preset?: string | null
): Array<T & { label: string; dimLabel: string }> {
  return groupAdTargets(targets, countryId, preset).flatMap((section) =>
    section.options.map((option) => ({
      ...option.target,
      label: option.label,
      dimLabel: section.dimLabel,
    }))
  );
}
