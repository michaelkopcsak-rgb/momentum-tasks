import { google } from './google.js';
import { microsoft } from './microsoft.js';
import { ics } from './ics.js';

export const PROVIDERS = { google, microsoft, ics };

// What people pick during onboarding. Yahoo and Apple don't offer a sign-in API that a
// web app can use for calendar and tasks, so they go through the calendar-file import.
export const CHOICES = [
  { id: 'google', provider: 'google', name: 'Google', detail: 'Gmail, Google Calendar, Google Tasks', mono: 'G' },
  { id: 'microsoft', provider: 'microsoft', name: 'Microsoft', detail: 'Outlook.com, Hotmail, Live, Microsoft 365', mono: 'M' },
  { id: 'yahoo', provider: 'ics', name: 'Yahoo', detail: 'Yahoo Mail, Yahoo Calendar', mono: 'Y' },
  { id: 'apple', provider: 'ics', name: 'Apple iCloud', detail: 'iCloud Mail, Apple Calendar', mono: 'A' },
  { id: 'other', provider: 'ics', name: 'Something else', detail: 'Any calendar that can export an .ics file', mono: '…' },
];

export const SOURCE = {
  gcal: { icon: 'event', label: 'Google Calendar' },
  gtask: { icon: 'task_alt', label: 'Google Tasks' },
  mscal: { icon: 'event', label: 'Outlook Calendar' },
  mstask: { icon: 'task_alt', label: 'Microsoft To Do' },
  ics: { icon: 'event_note', label: 'Imported calendar' },
  local: { icon: 'edit_note', label: 'Momentum' },
};
