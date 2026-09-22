import React from 'react';
import Select, { type StylesConfig } from 'react-select';

export type AppSelectOption = {
  value: string;
  label: string;
  /** Optional secondary text (e.g. an officer's department). When any option has
   * one (even empty), the menu renders two aligned columns — label | detail — and
   * search also matches the detail. Options without it render exactly as before. */
  detail?: string;
};

type AppSelectProps = {
  options: AppSelectOption[];
  value: string;
  placeholder?: string;
  isDisabled?: boolean;
  isClearable?: boolean;
  compact?: boolean;
  /** Control border radius. Defaults to the pill shape used across the app;
   * pass '0.5rem' to match app-form-control in dense forms that mix
   * selects/date pickers with plain inputs (e.g. the Locator edit form). */
  radius?: string;
  /** Overrides the compact/non-compact default control height. Pass 28 to
   * match app-form-control-sm's rendered height exactly (e.g. the Locator
   * edit form, where selects sit next to plain inputs in the same row). */
  minHeight?: number;
  /** Drops the control's own border/radius/background so it can be dropped
   * into an app-form-control wrapper div that supplies them instead — for
   * pixel-matching a plain text field it sits beside (e.g. the Locator edit
   * form). Pair with a wrapper div and a smaller minHeight (the wrapper's
   * own 1px border no longer overlaps the control's). */
  boxed?: boolean;
  onChange: (value: string) => void;
};

const createStyles = (compact: boolean, radius: string, minHeight: number | undefined, boxed: boolean): StylesConfig<AppSelectOption, false> => ({
  control: (base, state) => ({
    ...base,
    minHeight: minHeight ?? (compact ? 32 : 40),
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderStyle: 'solid',
    borderWidth: boxed ? 0 : '1px',
    borderColor: state.isFocused ? 'var(--nav-active-bg)' : 'var(--input-border)',
    borderRadius: boxed ? 0 : radius,
    boxShadow: 'none',
    outline: 'none',
    '&:hover': {
      borderColor: 'var(--nav-active-bg)',
      borderWidth: boxed ? 0 : '1px',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: boxed ? '0 8px' : compact ? '0 8px' : '0 10px',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--text)',
    cursor: 'pointer',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--text-muted)',
    fontSize: compact ? 12 : 14,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--text)',
    fontSize: compact ? 12 : 14,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--input-border)',
    boxShadow: '0 10px 30px rgba(0,0,0,.25)',
    overflow: 'hidden',
  }),
  menuList: (base) => ({
    ...base,
    scrollbarWidth: 'thin',
    scrollbarColor: 'var(--border) transparent',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: compact ? 12 : 13,
    backgroundColor: state.isSelected ? 'var(--nav-active-bg)' : state.isFocused ? 'var(--selected-bg)' : 'transparent',
    color: state.isSelected ? 'var(--nav-active-text)' : 'var(--text)',
    cursor: 'pointer',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base) => ({
    ...base,
    padding: boxed ? 3 : compact ? 6 : 8,
    color: 'var(--text-muted)',
    '&:hover': { color: 'var(--text)' },
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: boxed ? 3 : compact ? 6 : 8,
    color: 'var(--text-muted)',
    '&:hover': { color: 'var(--text)' },
  }),
});

export function AppSelect({
  options,
  value,
  placeholder = 'Select...',
  isDisabled = false,
  isClearable = true,
  compact = false,
  radius = '1.5rem',
  minHeight,
  boxed = false,
  onChange,
}: AppSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  const hasDetail = options.some((option) => option.detail !== undefined);

  return (
    <Select<AppSelectOption, false>
      options={options}
      value={selected}
      styles={createStyles(compact, radius, minHeight, boxed)}
      className={boxed ? 'flex-1 min-w-0' : undefined}
      classNamePrefix="app-select"
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      menuPlacement="auto"
      menuPosition="fixed"
      placeholder={placeholder}
      isDisabled={isDisabled}
      isClearable={isClearable}
      isSearchable
      onChange={(option) => onChange(option?.value ?? '')}
      noOptionsMessage={() => 'No matches found'}
      {...(hasDetail
        ? {
            filterOption: (option: { data: AppSelectOption }, input: string) => {
              const q = input.trim().toLowerCase();
              if (!q) return true;
              return `${option.data.label} ${option.data.detail ?? ''}`.toLowerCase().includes(q);
            },
            formatOptionLabel: (option: AppSelectOption, { context }: { context: 'menu' | 'value' }) =>
              context === 'menu' ? (
                <div className="grid items-center gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                  <span className="truncate" title={option.label}>
                    {option.label}
                  </span>
                  <span
                    className="truncate text-[11px] uppercase tracking-wide"
                    style={{ opacity: 0.65 }}
                    title={option.detail || undefined}
                  >
                    {option.detail || '—'}
                  </span>
                </div>
              ) : (
                <span>{option.detail ? `${option.label} — ${option.detail}` : option.label}</span>
              ),
          }
        : {})}
    />
  );
}
