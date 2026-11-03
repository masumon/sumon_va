import type { AppLanguage } from '../i18n/date-time';
import type { MemoryKind } from '../types/memory-model';
import type { IconName } from '../ui/AppIcon';

// Starter shapes for a new memory — a title-less prompt the user fills in. Purely a
// convenience: picking one just pre-fills the editor fields, nothing is saved yet.

export type MemoryTemplate = {
  id: string;
  icon: IconName;
  kind: MemoryKind;
  label: { bn: string; en: string };
  body: { bn: string; en: string };
  tags: string[];
};

export const MEMORY_TEMPLATES: MemoryTemplate[] = [
  {
    id: 'meeting',
    icon: 'account-group-outline',
    kind: 'EVENT',
    label: { bn: 'মিটিং নোট', en: 'Meeting note' },
    body: {
      bn: 'মিটিং — \nকার সাথে: \nসিদ্ধান্ত: \nপরের ধাপ: ',
      en: 'Meeting — \nWith: \nDecisions: \nNext steps: ',
    },
    tags: ['meeting'],
  },
  {
    id: 'idea',
    icon: 'lightbulb-on-outline',
    kind: 'REFLECTION',
    label: { bn: 'আইডিয়া', en: 'Idea' },
    body: {
      bn: 'আইডিয়া: \nকেন কাজে লাগবে: \nপ্রথম ধাপ: ',
      en: 'Idea: \nWhy it matters: \nFirst step: ',
    },
    tags: ['idea'],
  },
  {
    id: 'person',
    icon: 'card-account-details-outline',
    kind: 'FACT',
    label: { bn: 'পরিচিত মানুষ', en: 'Person' },
    body: {
      bn: 'নাম: \nকীভাবে পরিচয়: \nমনে রাখার মতো: ',
      en: 'Name: \nHow we met: \nWorth remembering: ',
    },
    tags: ['people'],
  },
  {
    id: 'reading',
    icon: 'book-open-page-variant-outline',
    kind: 'NOTE',
    label: { bn: 'বই / উদ্ধৃতি', en: 'Book / quote' },
    body: {
      bn: 'শিরোনাম: \nলেখক: \nমূল কথা: ',
      en: 'Title: \nAuthor: \nTakeaway: ',
    },
    tags: ['reading'],
  },
];

export function templateBody(t: MemoryTemplate, language: AppLanguage): string {
  return t.body[language];
}
