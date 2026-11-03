import type { AppLanguage } from './date-time';

// The screen's own list of tools lives in app/more.tsx; only its title is shared here.
export const moreCopy = {
  bn: { title: 'আরও' },
  en: { title: 'More' },
} as const;

export function more(language: AppLanguage) { return moreCopy[language]; }
