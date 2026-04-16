'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AddressAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  apiKey?: string;
  className?: string;
}

interface Prediction {
  description: string;
  place_id: string;
}

/**
 * AddressAutocomplete — Google Places Autocomplete component.
 * Falls back to normal textarea if no API key is provided.
 * 
 * Usage:
 *   <AddressAutocomplete 
 *     value={address} 
 *     onChange={setAddress}
 *     apiKey={googleMapsApiKey}
 *   />
 */
export function AddressAutocomplete({
  value,
  onChange,
  placeholder = 'Ketik alamat untuk saran dari Google Maps...',
  disabled = false,
  apiKey,
  className,
}: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load Google Maps Places script dynamically
  useEffect(() => {
    if (!apiKey || scriptLoaded) return;

    // Check if already loaded — use callback to avoid sync setState in effect
    if ((window as any).google?.maps?.places) {
      // Already loaded by another instance, use microtask to defer setState
      queueMicrotask(() => setScriptLoaded(true));
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => console.error('[Google Maps] Failed to load script');
    document.head.appendChild(script);
  }, [apiKey, scriptLoaded]);

  const fetchPredictions = useCallback(async (input: string) => {
    if (!input.trim() || !scriptLoaded || !(window as any).google?.maps?.places) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    setIsLoading(true);
    try {
      const autocomplete = new (window as any).google.maps.places.AutocompleteService();
      autocomplete.getPlacePredictions(
        {
          input: input.trim(),
          componentRestrictions: { country: 'id' }, // Indonesia only
          types: ['street_address', 'route', 'premise', 'sublocality', 'administrative_area_level_2'],
        },
        (predictions: any[] | null, status: any) => {
          if (status === (window as any).google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(predictions.slice(0, 5));
            setShowSuggestions(true);
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
          setIsLoading(false);
        }
      );
    } catch (err) {
      console.error('[AddressAutocomplete] Error:', err);
      setSuggestions([]);
      setIsLoading(false);
    }
  }, [scriptLoaded]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    onChange(val);
    setSelectedIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPredictions(val);
    }, 300);
  };

  const handleSelectSuggestion = async (prediction: Prediction) => {
    setShowSuggestions(false);
    setIsLoading(true);
    setSelectedIndex(-1);

    try {
      // Get detailed address from PlacesService
      const service = new (window as any).google.maps.places.PlacesService(document.createElement('div'));
      service.getDetails(
        { placeId: prediction.place_id, fields: ['formatted_address'] },
        (place: any, status: any) => {
          if (status === 'OK' && place?.formatted_address) {
            onChange(place.formatted_address);
          } else {
            // Fallback to prediction description
            onChange(prediction.description);
          }
          setIsLoading(false);
        }
      );
    } catch {
      onChange(prediction.description);
      setIsLoading(false);
    }
  };

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[selectedIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  };

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If no API key, render normal textarea (fallback)
  if (!apiKey) {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={2}
        className={cn('w-full px-3 py-2 rounded-md border border-input bg-transparent text-sm resize-none', className)}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={cn(
            'w-full pl-9 pr-9 py-2 rounded-md border border-input bg-transparent text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        />
        {value && (
          <button
            type="button"
            onClick={() => { onChange(''); setSuggestions([]); setShowSuggestions(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {isLoading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
          {suggestions.map((prediction, index) => (
            <button
              key={prediction.place_id}
              type="button"
              onClick={() => handleSelectSuggestion(prediction)}
              className={cn(
                'w-full text-left px-3 py-2.5 text-sm hover:bg-accent transition-colors flex items-start gap-2',
                index === selectedIndex && 'bg-accent'
              )}
            >
              <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
              <span className="truncate">{prediction.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Type declaration for Google Maps on window
declare global {
  interface Window {
    google: any;
  }
}
