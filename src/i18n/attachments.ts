import { asciiDigitsToBengali } from '../services/debt/money';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and truncates it, so every number in a Bengali sentence is
 *  converted. English strings keep ASCII digits, which is what English readers expect. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

type Language = 'en' | 'bn';
/** The messages AttachmentPanel shows; the gallery itself (FileGallery) carries its own words. */
export function attachmentCopy(language: Language) {
  const bn = language === 'bn';
  return {
    loadError: bn ? 'ফাইলগুলো দেখানো যায়নি' : 'Could not show the files',
    added: (count: number) => (bn ? `${bnNum(count)}টি যোগ হয়েছে` : `${count} added`),
    addError: bn ? 'যোগ করা যায়নি' : 'Could not add it',
    removed: bn ? 'মুছে ফেলা হয়েছে' : 'Removed',
    removeError: bn ? 'মোছা যায়নি' : 'Could not remove it',
    shareError: bn ? 'শেয়ার করা যায়নি' : 'Could not share it',
    problem: bn ? 'ফাইলে সমস্যা' : 'A problem with the files',
    retry: bn ? 'আবার চেষ্টা করুন' : 'Try again',
  };
}
