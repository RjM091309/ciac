import React from 'react';
import Select, { type StylesConfig } from 'react-select';

export type AppSelectOption = {
  value: string;
  label: string;
};

type AppSelectProps = {
  options: AppSelectOption[];
  value: string;
  placeholder?: string;
  isDisabled?: boolean;
  isClearable?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
};

const createStyles = (compact: boolean): StylesConfig<AppSelectOption, false> => ({
  control: (base, state) => ({
    ...base,
    minHeight: compact ? 32 : 40,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    borderColor: state.isFocused ? 'var(--nav-active-bg)' : 'var(--input-border)',
    boxShadow: 'none',
    '&:hover': {
      borderColor: 'var(--nav-active-bg)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: compact ? '0 8px' : '0 10px',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--text)',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--text-muted)',
    fontSize: compact ? 12 : 14,
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--text)',
    fontSize: compact ? 12 : 14,
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
    padding: compact ? 6 : 8,
    color: 'var(--text-muted)',
    '&:hover': { color: 'var(--text)' },
  }),
  clearIndicator: (base) => ({
    ...base,
    padding: compact ? 6 : 8,
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
  onChange,
}: AppSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Select<AppSelectOption, false>
      options={options}
      value={selected}
      styles={createStyles(compact)}
      menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
      placeholder={placeholder}
      isDisabled={isDisabled}
      isClearable={isClearable}
      isSearchable
      onChange={(option) => onChange(option?.value ?? '')}
      noOptionsMessage={() => 'No matches found'}
    />
  );
}
