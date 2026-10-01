import React, { useMemo, useState } from 'react';

// Requirement Category sub-tabs shared by every screen that lists a
// requirement checklist (Assessment Compliance tab, locator portal,
// Registered Locator Documents tab) — same grouping as the Requirements
// page tree: "All" first, then each category A–Z, uncategorized/ad-hoc last.

type Categorized = { category_id?: number | null; category_name?: string | null };

export type RequirementGroup<T> = { key: string; name: string; items: T[] };

const ALL = '__all__';
const NONE = '__none__';

export function groupRequirementsByCategory<T extends Categorized>(items: T[]): RequirementGroup<T>[] {
  const map = new Map<string, RequirementGroup<T>>();
  for (const item of items) {
    const key = item.category_id != null ? String(item.category_id) : NONE;
    const group = map.get(key) || { key, name: item.category_name || 'Other Requirements', items: [] };
    group.items.push(item);
    map.set(key, group);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.key === NONE ? 1 : b.key === NONE ? -1 : a.name.localeCompare(b.name)
  );
}

/** Groups `items` and tracks the selected sub-tab. Falls back to "All" when
 * the selected category disappears (e.g. its last item moved). `showTabs`
 * is false when everything sits in a single category. */
export function useRequirementGroups<T extends Categorized>(items: T[]) {
  const [activeKey, setActiveKey] = useState(ALL);
  const groups = useMemo(() => groupRequirementsByCategory(items), [items]);
  const tabs = useMemo<RequirementGroup<T>[]>(() => [{ key: ALL, name: 'All', items }, ...groups], [items, groups]);
  const current = tabs.find((t) => t.key === activeKey) || tabs[0];
  return {
    tabs,
    current,
    isAll: current.key === ALL,
    setActiveKey,
    showTabs: items.length > 0 && groups.length > 1,
  };
}

export function RequirementGroupTabs<T>({
  tabs,
  activeKey,
  onChange,
  isDone,
  isFlagged,
  doneLabel = 'verified',
  flaggedLabel = 'has rejected items',
}: {
  tabs: RequirementGroup<T>[];
  activeKey: string;
  onChange: (key: string) => void;
  // Counted as "done" in each tab's done/total badge (verified, uploaded…).
  isDone: (item: T) => boolean;
  // Any flagged item puts a red dot on the tab (e.g. a rejected requirement).
  isFlagged?: (item: T) => boolean;
  doneLabel?: string;
  flaggedLabel?: string;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 -mb-1" role="tablist" aria-label="Requirement categories">
      {tabs.map((g) => {
        const selected = g.key === activeKey;
        const done = g.items.filter(isDone).length;
        const flagged = isFlagged ? g.items.some(isFlagged) : false;
        return (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(g.key)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] border cursor-pointer whitespace-nowrap transition-colors"
            style={
              selected
                ? {
                    backgroundColor: 'var(--nav-active-bg)',
                    color: 'var(--nav-active-text)',
                    borderColor: 'var(--nav-active-bg)',
                    fontWeight: 600,
                  }
                : { borderColor: 'var(--border)', color: 'var(--text-muted)' }
            }
            title={`${done} of ${g.items.length} ${doneLabel}${flagged ? ` · ${flaggedLabel}` : ''}`}
          >
            {flagged ? <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: '#ef4444' }} /> : null}
            {g.name}
            <span className="tabular-nums opacity-75">
              {done}/{g.items.length}
            </span>
          </button>
        );
      })}
    </div>
  );
}
