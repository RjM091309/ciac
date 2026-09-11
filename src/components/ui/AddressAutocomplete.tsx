import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../lib/googleMapsLoader';

/**
 * Plain text input that upgrades to a Google Places autocomplete once the
 * Maps script loads (VITE_GOOGLE_MAPS_API_KEY set) — degrades to a normal
 * free-text field with no key configured, so the form never hard-depends on
 * it. Restricted to PH addresses since every business this portal tracks is
 * Philippines-based.
 */
export function AddressAutocomplete({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  style,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loader = loadGoogleMaps();
    if (!loader) return; // no API key configured — stays a plain input
    let cancelled = false;
    loader
      .then((google) => {
        if (cancelled || !inputRef.current) return;
        autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address'],
          componentRestrictions: { country: 'ph' },
        });
        autocompleteRef.current.addListener('place_changed', () => {
          const place = autocompleteRef.current?.getPlace();
          if (place?.formatted_address) onChange(place.formatted_address);
        });
        setReady(true);
      })
      .catch(() => {
        // Script failed to load (bad key, network, etc.) — plain input still works.
      });
    return () => {
      cancelled = true;
      if (autocompleteRef.current && (window as any).google?.maps?.event) {
        (window as any).google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
    };
  }, [onChange]);

  return (
    <input
      ref={inputRef}
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      style={style}
      autoComplete="off"
      title={ready ? 'Start typing to search addresses' : undefined}
    />
  );
}
