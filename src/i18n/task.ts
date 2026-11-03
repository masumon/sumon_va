import { asciiDigitsToBengali } from '../services/debt/money';

/** Bengali numerals inside Bengali text. Android mis-measures a line that mixes ASCII
 *  digits with Bengali and truncates it, so every number in a Bengali sentence is
 *  converted. English strings keep ASCII digits, which is what English readers expect. */
const bnNum = (value: number | string) => asciiDigitsToBengali(String(value));

type Language = 'en' | 'bn';

export function taskCopy(language: Language) {
  const bn = language === 'bn';
  return {
    back: bn ? 'পরিকল্পনায় ফিরুন' : 'Back to planning', planning: bn ? 'পরিকল্পনা' : 'Planning', loading: bn ? 'কাজ লোড হচ্ছে…' : 'Loading task…', notFound: bn ? 'কাজ পাওয়া যায়নি' : 'Task not found',
    detailBadge: bn ? 'কাজের বিস্তারিত' : 'TASK DETAIL', newBadge: bn ? 'নতুন কাজ' : 'NEW TASK', detailTitle: bn ? 'কাজের বিস্তারিত' : 'Task details', createTitle: bn ? 'কাজ তৈরি করুন' : 'Create task', subtitle: bn ? 'কাজের পরিকল্পনা করুন, কোনটা আগে ঠিক করুন — সব কাজ এক জায়গায়।' : 'Plan, prioritize and manage this task locally.',
    status: bn ? 'অবস্থা' : 'Status', title: bn ? 'শিরোনাম' : 'Title', titlePlaceholder: bn ? 'কাজের শিরোনাম' : 'Task title', notes: bn ? 'নোট' : 'Notes', notesPlaceholder: bn ? 'ঐচ্ছিক নোট' : 'Optional notes', priority: bn ? 'অগ্রাধিকার' : 'Priority',
    attachments: bn ? 'সংযুক্ত ফাইল' : 'Attachments',
    saveFailed: bn ? 'কাজ সংরক্ষণ করা যায়নি' : 'The task could not be saved', stagedReady: (count:number)=>bn?`${bnNum(count)}টি ফাইল প্রস্তুত হয়েছে; সংরক্ষণ করলে যুক্ত হবে`:`${count} file(s) ready; they will be attached when you save`, stagedFailed:(count:number)=>bn?`${bnNum(count)}টি ফাইল প্রস্তুত করা যায়নি`:`Unable to prepare ${count} selected file(s)`, unablePrepare:bn?'ফাইল প্রস্তুত করা যায়নি':'Unable to prepare files', unableRemoveStaged:bn?'ফাইল সরানো যায়নি':'Unable to remove staged file', attachmentSaveFailed:(count:number)=>bn?`${bnNum(count)}টি সংযুক্ত ফাইল সংরক্ষণ করা যায়নি; কাজটি নিরাপদভাবে ফিরিয়ে দেওয়া হয়েছে।`:`${count} attachment(s) could not be saved; the task was safely rolled back.`, updated:bn?'কাজ আপডেট হয়েছে':'Task updated', created:bn?'কাজ তৈরি হয়েছে':'Task created',
    cancel:bn?'বাতিল':'Cancel', saveChanges:bn?'পরিবর্তন সংরক্ষণ':'Save changes', create:bn?'কাজ তৈরি':'Create task', complete:bn?'সম্পন্ন করুন':'Mark complete', cancelTask:bn?'বাতিল করুন':'Cancel task', archive:bn?'আর্কাইভ':'Archive', reopen:bn?'আবার খুলুন':'Reopen task', moveInbox:bn?'ইনবক্সে নিন':'Move to inbox', delete:bn?'স্থায়ীভাবে মুছুন':'Delete permanently', deleteLabel:bn?'কাজ স্থায়ীভাবে মুছুন':'Delete task permanently', deleteTitle:bn?'কাজ মুছবেন?':'Delete task?', deleteDescription:bn?'এই ফোন থেকে কাজটি স্থায়ীভাবে মুছে যাবে।':'This permanently removes the task from this device.', deleteConfirm:bn?'মুছুন':'Delete', deleteCancel:bn?'বাতিল':'Cancel', error:bn?'কাজ সংরক্ষণ করা যায়নি':'The task could not be saved.',
    subtasks:bn?'ধাপ':'Steps', subtasksProgress:(done:number,total:number)=>bn?`${bnNum(done)}/${bnNum(total)} ধাপ শেষ`:`${done}/${total} steps done`, addStep:bn?'ধাপ যোগ করুন':'Add a step', stepPlaceholder:bn?'যেমন: ব্যাংকে ফোন করুন':'e.g. call the bank', removeStep:bn?'ধাপ মুছুন':'Remove step', saveTaskFirst:bn?'ধাপ যোগ করতে আগে কাজটি সংরক্ষণ করুন।':'Save the task first to add steps.', allStepsDone:bn?'সব ধাপ শেষ — কাজটি সম্পন্ন করবেন?':'All steps done — mark the task complete?', markComplete:bn?'সম্পন্ন করুন':'Mark complete',
    priorityLabels:{LOW:bn?'কম':'Low',MEDIUM:bn?'মাঝারি':'Medium',HIGH:bn?'উচ্চ':'High',URGENT:bn?'জরুরি':'Urgent'},
    repeat:bn?'পুনরাবৃত্তি':'Repeat', repeatHint:bn?'সম্পন্ন করলে পরের বারের কাজ নিজে থেকেই তৈরি হবে।':'When completed, the next one is created automatically.',
    repeatLabels:{NONE:bn?'না':'None',DAILY:bn?'প্রতিদিন':'Daily',WEEKDAYS:bn?'কর্মদিবস (রবি–বৃহস্পতি)':'Weekdays (Sun–Thu)',WEEKLY:bn?'সাপ্তাহিক':'Weekly',MONTHLY:bn?'মাসিক':'Monthly'},
    statusLabels:{INBOX:bn?'ইনবক্স':'Inbox',PLANNED:bn?'পরিকল্পিত':'Planned',IN_PROGRESS:bn?'চলমান':'In progress',COMPLETED:bn?'সম্পন্ন':'Completed',RESCHEDULED:bn?'পুনঃনির্ধারিত':'Rescheduled',CANCELLED:bn?'বাতিল':'Cancelled',ARCHIVED:bn?'আর্কাইভ':'Archived'},
  };
}
