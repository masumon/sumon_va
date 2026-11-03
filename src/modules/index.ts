// Every module the app knows about.
//
// Importing this file registers them all. Adding a module means writing its declaration
// beside this one and adding a line here — nothing in Home, Settings, Reminders, search,
// the assistant or the navigation needs touching.
//
// Order matters only for ties: it is the order modules appear where nothing else sorts.

import './debt.module';
import './finance.module';
import './health.module';

export * from './registry';
export type { AccentName, IconName } from './types';
