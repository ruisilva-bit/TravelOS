import type { ReactNode } from "react";

/** Colour families for service categories; the CSS tokens are `--category-<tone>`. */
export const CATEGORY_TONES = [
  "flight",
  "accommodation",
  "transfer",
  "activity",
  "insurance",
  "car",
  "other",
] as const;

export type CategoryTone = (typeof CATEGORY_TONES)[number];

export interface CategoryChipProps {
  readonly tone: CategoryTone;
  readonly children: ReactNode;
}

/** A small colour-coded label. The text always carries the meaning; colour only reinforces it. */
export function CategoryChip({ tone, children }: CategoryChipProps) {
  return (
    <span className="ds-category-chip" data-category={tone}>
      {children}
    </span>
  );
}
