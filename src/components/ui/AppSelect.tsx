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
  onChange: (value: string) => void;
};

const styles: StylesConfig<AppSelectOption, false> = {
  control: (base, state) => ({
    ...base,
    minHeight: 40,
    backgroundColor: 'transparent',
    borderColor: state.isFocused ? 'var(--nav-active-bg)' : 'var(--input-border)',
    boxShadow: 'none',
    '&:hover': {
      borderColor: 'var(--nav-active-bg)',
    },
  }),
  valueContainer: (base) => ({
    ...base,
    padding: '0 10px',
  }),
  input: (base) => ({
    ...base,
    color: 'var(--text)',
  }),
  placeholder: (base) => ({
    ...base,
    color: 'var(--text-muted)',
    fontSize: 14,
  }),
  singleValue: (base) => ({
    ...base,
    color: 'var(--text)',
    fontSize: 14,
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
    fontSize: 13,
    backgroundColor: state.isSelected ? 'var(--nav-active-bg)' : state.isFocused ? 'var(--selected-bg)' : 'transparent',
    color: state.isSelected ? 'var(--nav-active-text)' : 'var(--text)',
    cursor: 'pointer',
  }),
  indicatorSeparator: () => ({
    display: 'none',
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: 'var(--text-muted)',
    '&:hover': { color: 'var(--text)' },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: 'var(--text-muted)',
    '&:hover': { color: 'var(--text)' },
  }),
};

export function AppSelect({
  options,
  value,
  placeholder = 'Select...',
  isDisabled = false,
  isClearable = true,
  onChange,
}: AppSelectProps) {
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Select<AppSelectOption, false>
      options={options}
      value={selected}
      styles={styles}
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
