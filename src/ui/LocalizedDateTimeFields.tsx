// The task editor's date and time fields.
//
// These used to be the one place in the app that opened the *native* `@expo/ui` picker,
// while thirteen debt and health screens opened the app's own calendar. Two pickers meant
// two behaviours from one gesture: the native dialog was wired `is24Hour={false}`, so the
// 12/24-hour setting could not reach it; it read the phone's locale rather than the app's
// language, so a Bengali screen opened an English dialog; and it resolved dates against the
// device timezone while every other date in this app is resolved against the app's own
// zone setting — which is how an 11pm due date could be filed on the wrong day abroad.
//
// So there is one picker now. These are thin wrappers that translate the task editor's
// stored shapes (a day key here, a full ISO instant there) to and from the shared fields.

import { AppDateField } from './AppDateField';
import { AppTimeField } from './AppTimeField';
import { useAppPreferences } from '../app/AppPreferences';
import { bangladeshDateKey, zonedClock, zonedInstant } from '../i18n/date-time';

export function PlannedDateField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  return (
    <AppDateField
      label={bn ? 'পরিকল্পিত তারিখ' : 'Planned date'}
      value={value || null}
      onChange={(next) => onChange(next ?? '')}
      placeholder={bn ? 'তারিখ বাছাই করুন' : 'Choose date'}
    />
  );
}

export function DueDateTimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { language } = useAppPreferences();
  const bn = language === 'bn';
  // Both halves are read back out of the same stored instant rather than held in their own
  // state, so a value edited somewhere else in the editor cannot drift out of the fields.
  const parsed = value ? new Date(value) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  const day = valid ? bangladeshDateKey(valid) : null;
  const clock = valid ? zonedClock(valid) : null;

  return (
    <>
      <AppDateField
        label={bn ? 'শেষ তারিখ' : 'Due date'}
        value={day}
        onChange={(next) => onChange(next ? zonedInstant(next, clock ?? '09:00') : '')}
        placeholder={bn ? 'তারিখ বাছাই করুন' : 'Choose date'}
        clearable
      />
      <AppTimeField
        label={bn ? 'শেষ সময়' : 'Due time'}
        value={clock}
        // A time with no date has nothing to attach to, so picking one before a date is
        // taken as meaning today — the day someone setting a due time almost always means.
        onChange={(next) => onChange(next ? zonedInstant(day ?? bangladeshDateKey(new Date()), next) : '')}
        placeholder={bn ? 'সময় বাছাই করুন' : 'Choose time'}
      />
    </>
  );
}
