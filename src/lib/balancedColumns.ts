import type React from 'react';

/** Column count for `count` items with at most `max` per row, picked so the
 * last row never holds a single card when a better split exists (7 cards at
 * max 4 -> 4 + 3, not 4 + 3 empty; 5 at max 4 -> 3 + 2). One row whenever
 * everything fits. Falls back to `max` (the last card then stretches). */
export function balancedColumns(count: number, max: number): number {
  if (count <= 0) return 1;
  if (count <= max) return count;
  for (let cols = max; cols >= 2; cols -= 1) {
    const rest = count % cols;
    if (rest === 0 || rest >= 2) return cols;
  }
  return max;
}

/** Inline CSS variables for a `.balanced-row` (src/index.css) — per-breakpoint
 * maximums in, balanced column counts out. */
export function balancedRowStyle(
  count: number,
  max: { base: number; sm?: number; lg?: number; xl?: number }
): React.CSSProperties {
  const vars: Record<string, number> = { '--bal-cols-base': balancedColumns(count, max.base) };
  if (max.sm) vars['--bal-cols-sm'] = balancedColumns(count, max.sm);
  if (max.lg) vars['--bal-cols-lg'] = balancedColumns(count, max.lg);
  if (max.xl) vars['--bal-cols-xl'] = balancedColumns(count, max.xl);
  return vars as React.CSSProperties;
}
