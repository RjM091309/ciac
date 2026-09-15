import React, { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../../lib/googleMapsLoader';

/**
 * Plain text input that upgrades to Google Places suggestions once the Maps
 * script loads (VITE_GOOGLE_MAPS_API_KEY set) — degrades to a normal
 * free-text field with no key configured, so the form never hard-depends on
 * it. Restricted to PH addresses since every business this portal tracks is
 * Philippines-based.
 *
 * Renders its own dropdown via AutocompleteService rather than the legacy
 * `google.maps.places.Autocomplete` widget — that widget (and the
 * `.pac-container` it injects into document.body) is Google's pre-2025
 * approach, and doesn't render any suggestions for API keys provisioned
 * after Google's March 2025 cutoff (confirmed live: AutocompleteService
 * itself returns real predictions with a deprecation warning, but the
 * widget silently shows nothing). Building the list here also sidesteps
 * `.pac-container`'s z-index/positioning quirks inside modals for free.
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const serviceRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestIdRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [suggestions, setSuggestions] = useState<{ placeId: string; description: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    const loader = loadGoogleMaps();
    if (!loader) return; // no API key configured — stays a plain input
    let cancelled = false;
    loader
      .then((google) => {
        if (cancelled) return;
        serviceRef.current = new google.maps.places.AutocompleteService();
        setReady(true);
      })
      .catch(() => {
        // Script failed to load (bad key, network, etc.) — plain input still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  function fetchSuggestions(input: string) {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!serviceRef.current || !input.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      const requestId = ++requestIdRef.current;
      serviceRef.current!.getPlacePredictions(
        { input, componentRestrictions: { country: 'ph' } },
        (predictions, status) => {
          if (requestId !== requestIdRef.current) return; // superseded by a newer keystroke
          if (status !== 'OK' || !predictions) {
            setSuggestions([]);
            setOpen(false);
            return;
          }
          setSuggestions(predictions.map((p) => ({ placeId: p.place_id, description: p.description })));
          setHighlighted(0);
          setOpen(true);
        }
      );
    }, 250);
  }

  function selectSuggestion(description: string) {
    onChange(description);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          fetchSuggestions(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (!open || !suggestions.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            selectSuggestion(suggestions[highlighted].description);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        style={style}
        autoComplete="off"
        title={ready ? 'Start typing to search addresses' : undefined}
      />
      {open && suggestions.length > 0 ? (
        <ul
          className="absolute left-0 right-0 mt-1.5 max-h-60 overflow-y-auto rounded-xl border py-1.5 text-xs shadow-lg"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)', zIndex: 9999 }}
        >
          {suggestions.map((s, i) => (
            <li key={s.placeId}>
              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg cursor-pointer"
                style={{
                  backgroundColor: i === highlighted ? 'var(--selected-bg)' : 'transparent',
                  color: 'var(--text-secondary)',
                }}
                onMouseEnter={() => setHighlighted(i)}
                onMouseDown={(e) => {
                  // mousedown (not click) so this fires before the input's blur/outside-click handler.
                  e.preventDefault();
                  selectSuggestion(s.description);
                }}
              >
                {s.description}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
