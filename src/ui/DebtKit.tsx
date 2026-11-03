// What is genuinely the debt module's own — and nothing more.
//
// The shared shapes (Card, Chip, Field, FormBar, Stat, ToggleRow, …) moved to `AppKit`,
// where every module can reach them. What is left here is the two things only this module
// can know: its vocabulary, and how it prints money.
//
// The re-exports below exist so the debt screens keep working unchanged. New modules must
// import from `AppKit` directly — nothing outside `app/debt/` should ever mention this file.

import { useCallback, useMemo } from 'react';
import { useKit, ScreenHeader } from './AppKit';
import { debtCopy } from '../i18n/debt';
import { formatPaisa } from '../services/debt/money';

/**
 * Everything a debt screen needs: the shared kit, plus this module's copy and a Taka
 * formatter that follows the user's language for its digits.
 */
export function useDebt() {
  const kit = useKit();
  const c = useMemo(() => debtCopy(kit.language), [kit.language]);
  const money = useCallback((p: number) => formatPaisa(p, { bnDigits: kit.bn }), [kit.bn]);
  return { ...kit, c, money };
}

/** The module's header: same shape as everywhere, but "back" leads to the debt home. */
/** `onBack` lets a form route the arrow through its unsaved-changes gate first. */
export function DebtHeader({ title, subtitle, right, onBack }: { title: string; subtitle?: string; right?: React.ReactNode; onBack?: () => void }) {
  const { c } = useDebt();
  return <ScreenHeader title={title} subtitle={subtitle} right={right} backLabel={c.back} backTo="/debt" onBack={onBack} />;
}

// The shared kit, re-exported so this module's screens have one import to reach for.
export {
  Bar,
  Card,
  Chip,
  ChipGroup,
  EmptyNote,
  Field,
  FormBar,
  MultiChipGroup,
  ScreenHeader,
  Stat,
  ToggleRow,
  joinMulti,
  splitMulti,
  useKit,
} from './AppKit';
export type { AccentRole, IconName, KitStyles, ThemeAccents, ThemeColors } from './AppKit';

/** @deprecated Prefer `KitStyles` from AppKit — kept while the debt screens still name it. */
export type DebtStyles = ReturnType<typeof useKit>['s'];
