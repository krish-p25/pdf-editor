import { useEffect, useState } from 'react';

/**
 * Below this width the side panels become slide-over drawers. Matches
 * Tailwind's `md` breakpoint, so CSS and layout logic switch together.
 */
export const NARROW_QUERY = '(max-width: 767px)';

/** Whether a media query currently matches, updating as it changes. */
export function useMediaQuery(query: string): boolean {
  const read = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (!window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}
