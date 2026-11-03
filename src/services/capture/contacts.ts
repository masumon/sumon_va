// Pulling a person out of the phone's own contact book.
//
// A person is a shared foundation — a creditor, a doctor, a landlord and a teacher are all
// the same row — so this lives here rather than inside any one module.
//
// Typing a name and an eleven-digit number for somebody already in your phone is pure
// friction, and a mistyped number is the reason a reminder never reaches anyone. So the
// picker returns everything the record can use: name, number, email and address.
//
// The permission is asked for right before the picker opens, never before, and only from
// a screen that has already explained why on the same page — never on app launch, never
// in the background. Once it is granted the same chosen contact is re-read once more so
// the email and postal address come across too; still one contact, never the address book.

// The default `expo-contacts` export moved `presentContactPickerAsync` behind a new
// class-based API; calling the old function-style method from that import now throws
// instead of warning. The legacy import keeps the function-style API this file uses,
// confirmed to export the same functions (`getContactsAsync`, `getContactByIdAsync`,
// `presentContactPickerAsync`, `getPermissionsAsync`, `requestPermissionsAsync`, `Fields`).
import * as Contacts from 'expo-contacts/legacy';
import { Linking } from 'react-native';

export interface PickedContact {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export type ContactPickResult =
  | { status: 'picked'; contact: PickedContact }
  | { status: 'cancelled' }
  // `blocked` distinguishes a first "no" — where tapping again reopens the system dialog —
  // from a permanent "don't ask again", where Android will never show that dialog a
  // second time and the only way back is the phone's own Settings. A screen that cannot
  // tell the two apart offers the same button forever even after it has become a dead end.
  | { status: 'denied'; blocked: boolean }
  | { status: 'unavailable' };

/** Keep digits and a leading +, so "+880 17-1234 5678" stores as "+8801712345678". */
export function tidyPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+]/gu, '').replace(/(?!^)\+/gu, '');
  return cleaned || null;
}

/** One readable line out of the parts a phone stores separately. */
interface AddressLike { street?: string; city?: string; region?: string; postalCode?: string; country?: string }

/** Only the fields this file reads, so both of expo-contacts' contact shapes satisfy it. */
interface ContactLike {
  id?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: { number?: string }[];
  emails?: { email?: string }[];
  addresses?: AddressLike[];
}

function flattenAddress(address: AddressLike | undefined): string | null {
  if (!address) return null;
  const line = [address.street, address.city, address.region, address.postalCode, address.country]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');
  return line || null;
}

function shape(contact: ContactLike): PickedContact | null {
  const name = (contact.name ?? [contact.firstName, contact.lastName].filter(Boolean).join(' ')).trim();
  const phone = tidyPhone(contact.phoneNumbers?.[0]?.number);
  const email = contact.emails?.[0]?.email?.trim() || null;
  const address = flattenAddress(contact.addresses?.[0]);
  if (!name && !phone) return null;
  return { name: name || (phone ?? ''), phone, email, address };
}

/**
 * Contacts whose name contains what has been typed so far — for a suggestion list under
 * a name field, not a picker screen.
 *
 * Silent by design: called on every keystroke, so it must never itself throw or prompt.
 * Without the permission it simply returns nothing, the same as an empty phone book,
 * rather than interrupting someone mid-sentence to ask for access. A screen that wants the
 * permission still has the explicit "Pick from contacts" button for that.
 */
export async function searchContacts(query: string, limit = 5): Promise<PickedContact[]> {
  const name = query.trim();
  if (name.length < 2) return [];
  try {
    const granted = (await Contacts.getPermissionsAsync().catch(() => ({ granted: false }))).granted;
    if (!granted) return [];
    const { data } = await Contacts.getContactsAsync({
      name,
      pageSize: limit,
      fields: [Contacts.Fields.Name, Contacts.Fields.FirstName, Contacts.Fields.LastName, Contacts.Fields.PhoneNumbers],
    });
    const seen = new Set<string>();
    const out: PickedContact[] = [];
    for (const contact of data as ContactLike[]) {
      const picked = shape(contact);
      if (!picked || seen.has(picked.name + picked.phone)) continue;
      seen.add(picked.name + picked.phone);
      out.push(picked);
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Open the system contact picker and return the chosen person.
 *
 * `ask` decides whether a missing contacts permission raises the system dialog. Pass true
 * only from a screen where the reason is on the page. Every call site in this app does —
 * the picker's own result handler needs the permission to read the chosen contact back
 * (see below), so there is no path in which opening the picker without it would work.
 */
export async function pickContact(ask = true): Promise<ContactPickResult> {
  try {
    // Permission first, unconditionally — and this time for a reason confirmed in
    // expo-contacts' own Android source, not assumed from its behaviour. Launching the
    // system picker (`ACTION_PICK`) genuinely needs no permission; but the moment a
    // contact is chosen, this module's own result handler reads it back with a direct
    // `ContentResolver.query(ContactsContract.Data.CONTENT_URI, ...)` — and that throws a
    // SecurityException without READ_CONTACTS, from inside the picker's own callback,
    // after the picker has already opened and closed. Trying the picker first and only
    // asking on a caught throw is too late: the throw happens one step downstream of the
    // call this function can catch, so it surfaced as the picker opening, a contact being
    // tapped, and then nothing happening at all.
    let permission = await Contacts.getPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true }));
    if (!permission.granted && ask) {
      permission = await Contacts.requestPermissionsAsync().catch(() => ({ granted: false, canAskAgain: true }));
    }
    if (!permission.granted) return { status: 'denied', blocked: !permission.canAskAgain };

    const chosen = await Contacts.presentContactPickerAsync();
    if (!chosen) return { status: 'cancelled' };

    const basic = shape(chosen as ContactLike);

    // Widen the same one contact. Anything that fails here is not a failure of the pick —
    // the user still gets the name and number they asked for.
    if (chosen.id) {
      try {
        const full = await Contacts.getContactByIdAsync(chosen.id, [
          Contacts.Fields.Name,
          Contacts.Fields.FirstName,
          Contacts.Fields.LastName,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Emails,
          Contacts.Fields.Addresses,
        ]);
        const enriched = full ? shape(full as ContactLike) : null;
        if (enriched) return { status: 'picked', contact: enriched };
      } catch {
        // Fall through to what the picker already gave us.
      }
    }

    if (!basic) return { status: 'cancelled' };
    return { status: 'picked', contact: basic };
  } catch (error) {
    // "Could not open contacts" used to say nothing more than that. If this still
    // happens on a phone where the permission is granted, the cause is one step further
    // down — an OEM contacts app, or a stale Activity result callback — and this line in
    // `adb logcat` is what tells us which.
    console.error('[pickContact] unavailable:', error);
    return { status: 'unavailable' };
  }
}

/**
 * What to tell someone after a `{ status: 'denied' }` result, and whether there is
 * anything left to tap. Shared by every screen with a "pick from contacts" button so the
 * message — and the one-tap way out of a permanently blocked permission — reads the same
 * everywhere rather than four hand-written copies drifting apart.
 */
export function describeContactDenial(
  bn: boolean, blocked: boolean,
): { message: string; action?: { label: string; onPress: () => void } } {
  if (blocked) {
    // Android will not show its own dialog a second time once this happens; the only way
    // back is the phone's Settings page, so the snackbar's action goes straight there
    // instead of repeating a button that has become a dead end.
    return {
      message: bn
        ? 'ফোনবুকের অনুমতি বন্ধ আছে — সেটিংস থেকে চালু করুন, অথবা নামটা হাতে লিখে দিন'
        : 'Contacts access is blocked — allow it from Settings, or just type the name instead',
      action: { label: bn ? 'সেটিংস' : 'Settings', onPress: () => void Linking.openSettings().catch(() => {}) },
    };
  }
  return {
    message: bn
      ? 'ফোনবুকের অনুমতি নেই — নামটা হাতে লিখে দিন'
      : 'No contacts permission — just type the name instead',
  };
}
