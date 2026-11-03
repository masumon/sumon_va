export type AppLanguage='bn'|'en';
/** The zone the app falls back to, and the one it ships set to. */
export const BANGLADESH_TIME_ZONE='Asia/Dhaka' as const;

/**
 * The clock the whole app runs on.
 *
 * Not the phone's zone, and not a constant either. Someone who moves — or who keeps their
 * accounts in Dhaka while sitting in Riyadh — needs their days to keep falling where their
 * life does, so this is a setting, and every day key, month total, due date and overdue
 * count in the app is evaluated against whatever it holds. Set once from AppPreferences on
 * load and on change; nothing else has to thread it through.
 */
let activeZone:string=BANGLADESH_TIME_ZONE;
export function setTimeZonePreference(zone:string):void{activeZone=isValidTimeZone(zone)?zone:BANGLADESH_TIME_ZONE;}
export function appTimeZone():string{return activeZone;}
/** Does this runtime actually know the zone? An unknown name would throw on every format. */
export function isValidTimeZone(zone:string):boolean{try{new Intl.DateTimeFormat('en-US',{timeZone:zone});return true;}catch{return false;}}
/** "GMT+6" for the zone as it stands today — read from the runtime, never hard-coded. */
export function timeZoneOffsetLabel(zone:string=activeZone):string{
  try{
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(new Date());
    const name=parts.find(p=>p.type==='timeZoneName')?.value??'';
    return name.replace('GMT','GMT').replace(/:00$/u,'')||'GMT';
  }catch{return 'GMT';}
}
/** The city half of an IANA name, spaced out: "Asia/Dhaka" → "Dhaka". */
export function timeZoneCity(zone:string=activeZone):string{
  const tail=zone.split('/').pop()??zone;
  return tail.replace(/_/gu,' ');
}
/**
 * The one clock the whole app runs on.
 *
 * Not the phone's timezone: a person who lands in Dubai has not moved their household
 * accounts to Dubai, and a day that changes under them would file this evening's expense
 * under tomorrow. Every day key, month key, due date and overdue count in this app is
 * evaluated here, which is why Settings states it plainly rather than leaving it implied.
 */
export function timeZoneLabel(_language:AppLanguage):string{return `${timeZoneCity()} (${timeZoneOffsetLabel()})`;}
/** Step a `YYYY-MM` key back or forward whole months without ever touching a Date. */
export function shiftMonthKey(monthKey:string,delta:number):string{const[y,m]=monthKey.split('-').map(Number);if(!y||!m)return monthKey;const total=y*12+(m-1)+delta;return `${Math.floor(total/12)}-${String((total%12)+1).padStart(2,'0')}`;}
// App-wide clock preference. Set once from AppPreferences on load / change; every time
// formatter reads it so no call site has to thread it through. Default matches the old
// behaviour (12-hour AM/PM).
let hour12Default=true;
export function setTimeFormatPreference(mode:'12'|'24'):void{hour12Default=mode==='12';}
export function isHour12():boolean{return hour12Default;}
const localeFor=(language:AppLanguage)=>language==='bn'?'bn-BD':'en-BD';
function toDate(value:string|Date):Date{const date=value instanceof Date?value:new Date(value);if(Number.isNaN(date.getTime()))throw new Error('Invalid date/time value');return date;}
const format=(value:string|Date,language:AppLanguage,options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat(localeFor(language),{...options,timeZone:activeZone}).format(toDate(value));
function dhakaCalendarParts(value:string|Date):{year:number;month:number;day:number}{const date=toDate(value);const parts=new Intl.DateTimeFormat('en-US',{timeZone:activeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const year=Number(parts.find(part=>part.type==='year')?.value);const month=Number(parts.find(part=>part.type==='month')?.value);const day=Number(parts.find(part=>part.type==='day')?.value);if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day))throw new Error('Invalid Bangladesh calendar date');return{year,month,day};}
function dhakaCalendarDay(value:string|Date):number{const{year,month,day}=dhakaCalendarParts(value);return Date.UTC(year,month-1,day);}
/** The calendar day (YYYY-MM-DD) for `value` in Asia/Dhaka — the one true "which day" key. */
export function bangladeshDateKey(value:string|Date):string{const{year,month,day}=dhakaCalendarParts(value);return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;}
export function bangladeshMonthKey(value:string|Date=new Date()):string{const{year,month}=dhakaCalendarParts(value);return `${year}-${String(month).padStart(2,'0')}`;}
// ── Bengali, written by the app itself ────────────────────────────────────────
//
// RC.4 QA: dates and times came out as "22 Sep, 2026, 11:30 AM" or "২০ সেপ, ২০২৬, ৬:৪২ PM"
// in Bengali mode — the phone's Intl data is patchy for bn-BD (English "AM/PM", sometimes
// English months). Bengali is therefore composed here from the zone's plain numbers: Bengali
// digits, full month names, and the part of the day people actually say instead of AM/PM.
// English keeps using Intl. Every screen goes through these functions, so they all agree.
const BN_DIGITS='০১২৩৪৫৬৭৮৯';
const bnDigits=(v:string|number)=>String(v).replace(/[0-9]/gu,d=>BN_DIGITS[Number(d)]!);
const BN_MONTHS=['জানুয়ারি','ফেব্রুয়ারি','মার্চ','এপ্রিল','মে','জুন','জুলাই','আগস্ট','সেপ্টেম্বর','অক্টোবর','নভেম্বর','ডিসেম্বর'];
const BN_WEEKDAYS=['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];
function zoneWall(value:string|Date):{year:number;month:number;day:number;weekday:number;hour:number;minute:number}{
  const{year,month,day}=dhakaCalendarParts(value);
  const[hh='0',mm='0']=zonedClock(value).split(':');
  return{year,month,day,weekday:new Date(Date.UTC(year,month-1,day)).getUTCDay(),hour:Number(hh),minute:Number(mm)};
}
/** সকাল/দুপুর/বিকাল/সন্ধ্যা/রাত — the words the Assistant's own parser reads back. */
export function bnDayPart(hour:number):string{return hour<4?'রাত':hour<6?'ভোর':hour<12?'সকাল':hour<15?'দুপুর':hour<18?'বিকাল':hour<20?'সন্ধ্যা':'রাত';}
function bnClock(hour:number,minute:number):string{
  const mm=String(minute).padStart(2,'0');
  if(!hour12Default)return bnDigits(`${String(hour).padStart(2,'0')}:${mm}`);
  return `${bnDayPart(hour)} ${bnDigits(((hour+11)%12)+1)}:${bnDigits(mm)}`;
}
const bnDate=(w:{year:number;month:number;day:number})=>`${bnDigits(w.day)} ${BN_MONTHS[w.month-1]}, ${bnDigits(w.year)}`;
export function formatBangladeshDate(value:string|Date,language:AppLanguage):string{if(language==='bn')return bnDate(zoneWall(value));return format(value,language,{year:'numeric',month:'long',day:'numeric'});}
export function formatBangladeshDateTime(value:string|Date,language:AppLanguage):string{if(language==='bn'){const w=zoneWall(value);return `${bnDate(w)}, ${bnClock(w.hour,w.minute)}`;}return format(value,language,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:hour12Default});}
export function formatBangladeshTime(value:string|Date,language:AppLanguage):string{if(language==='bn'){const w=zoneWall(value);return bnClock(w.hour,w.minute);}return format(value,language,{hour:'numeric',minute:'2-digit',hour12:hour12Default});}
export function formatBangladeshWeekdayDate(value:string|Date,language:AppLanguage):string{if(language==='bn'){const w=zoneWall(value);return `${BN_WEEKDAYS[w.weekday]}, ${bnDate(w)}`;}return format(value,language,{weekday:'short',year:'numeric',month:'long',day:'numeric'});}
export function formatBangladeshMonthYear(value:string|Date,language:AppLanguage):string{if(language==='bn'){const w=zoneWall(value);return `${BN_MONTHS[w.month-1]} ${bnDigits(w.year)}`;}return format(value,language,{year:'numeric',month:'long'});}
export function formatBangladeshWeekday(value:string|Date,language:AppLanguage):string{if(language==='bn')return BN_WEEKDAYS[zoneWall(value).weekday]!;return format(value,language,{weekday:'long'});}
export function formatBangladeshNumber(value:number,language:AppLanguage):string{return new Intl.NumberFormat(localeFor(language)).format(value);}
export function formatBangladeshRelativeDate(value:string|Date,language:AppLanguage,now=new Date()):string{const diff=Math.round((dhakaCalendarDay(value)-dhakaCalendarDay(now))/86400000);if(language==='bn'){if(diff===0)return 'আজ';if(diff===1)return 'আগামীকাল';if(diff===-1)return 'গতকাল';}else{if(diff===0)return 'Today';if(diff===1)return 'Tomorrow';if(diff===-1)return 'Yesterday';}return formatBangladeshDate(value,language);}

/**
 * How far ahead of UTC the app's zone is at a given moment, in minutes.
 *
 * Derived from the runtime rather than stored, so a zone that changes its clocks in
 * summer is handled without this file knowing which zones those are.
 */
export function zoneOffsetMinutes(at:Date=new Date(),zone:string=activeZone):number{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(at);
  const get=(t:string)=>Number(parts.find(p=>p.type===t)?.value);
  const asUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour')%24,get('minute'),get('second'));
  return Math.round((asUtc-at.getTime())/60000);
}

/**
 * A wall-clock time on a calendar day, in the app's zone, as a real instant.
 *
 * Three places used to write their own `+06:00`, which is both a duplicate and a lie the
 * moment the zone is anything else. Resolved twice on purpose: the first pass finds the
 * offset near the answer, the second re-checks it at the corrected instant, which is what
 * makes a clock-change morning come out right.
 */
export function zonedInstant(dayKey:string,hhmm='00:00'):string{
  const[y=1970,m=1,d=1]=dayKey.split('-').map(Number);
  const[h=0,min=0]=hhmm.split(':').map(Number);
  const wall=Date.UTC(y,m-1,d,h,min,0);
  let ms=wall-zoneOffsetMinutes(new Date(wall))*60000;
  ms=wall-zoneOffsetMinutes(new Date(ms))*60000;
  return new Date(ms).toISOString();
}

/** The wall-clock `HH:MM` an instant falls on in the app's zone — the inverse of `zonedInstant`. */
export function zonedClock(value:string|Date):string{
  const date=toDate(value);
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:activeZone,hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date);
  const get=(t:string)=>parts.find(p=>p.type===t)?.value??'00';
  // 'en-GB' renders midnight as "24" in some runtimes; the app stores it as "00:00".
  return `${(get('hour')==='24'?'00':get('hour')).padStart(2,'0')}:${get('minute').padStart(2,'0')}`;
}

/**
 * The instant a day's money or health movement is filed at — the app's business date.
 *
 * Two clocks meet here. The ledgers think in calendar days ("2026-09-06"); the money book
 * stores an instant, and every month total is a prefix of that instant. Anchoring a bare
 * day at noon UTC — early evening in Dhaka — puts it unambiguously inside that day
 * whichever way a reader slices the string, which is why the entry screens have always
 * written it that way.
 *
 * What was missing was the empty case. "No date given" fell back to `new Date()` in UTC,
 * so anything recorded between midnight and six in the morning in Dhaka was filed on
 * yesterday's date — and on the first of the month, into last month's totals. Today here
 * means today in Dhaka, and is then anchored like any other day.
 *
 * A value that already carries a time is left exactly as it is: a caller that went to the
 * trouble of saying when something happened is not second-guessed.
 */
export function businessInstant(day?:string|null,today:Date=new Date()):string{
  if(!day)return `${bangladeshDateKey(today)}T12:00:00.000Z`;
  return day.length<=10?`${day}T12:00:00.000Z`:day;
}

/**
 * A stored day key as a person would say it — "6 September 2026", not "2026-09-06".
 *
 * Screens were printing the raw key straight into a subtitle. It is unambiguous and it is
 * also not how anybody reads a date, and the digits stayed Latin on a Bengali screen.
 * Falls back to the key itself rather than throwing, so a malformed row is still shown.
 */
export function formatDayKey(value:string|null|undefined,language:AppLanguage):string{
  if(!value)return '';
  try{return formatBangladeshDate(value.length<=10?`${value}T12:00:00.000Z`:value,language);}catch{return value.slice(0,10);}
}
