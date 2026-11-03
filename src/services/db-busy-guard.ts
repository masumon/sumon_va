// A backup or restore does a large, concentrated burst of native SQLite calls against the
// one shared connection — many tables, many rows, one after another. `SchedulerBootstrap`'s
// own foreground scheduler independently calls the database every time the app becomes
// active again, which genuinely happens mid-restore: `pickBackupBundle()` opens the native
// document picker, backgrounding the app, and returning from it fires exactly that
// AppState "active" transition — right as a restore's own heavy writes are in flight.
//
// This is a narrow, targeted guard around that one concrete collision, not a general
// serialization queue for every database call the app makes.
//
// The counter is the real gate (`isDbBusy`) and is kept exactly as simple as the version
// already proven correct under nesting — `applyRestoreArchive` runs inside `performRestore`,
// both guarded, and a Set/label-keyed gate would have let the inner call's `end` clear the
// outer call's guard early if both happened to share a name. `activeLabels` is a separate,
// purely additive list alongside it, tracking *which* operations are in flight so `endDbBurst`
// can remove the right one by name — it never affects whether the gate is open or shut.

let busyCount = 0;
const activeLabels: string[] = [];

export function beginDbBurst(label = 'unnamed'): void {
  busyCount += 1;
  activeLabels.push(label);
}

export function endDbBurst(label = 'unnamed'): void {
  busyCount = Math.max(0, busyCount - 1);
  const index = activeLabels.lastIndexOf(label);
  if (index !== -1) activeLabels.splice(index, 1);
}

export function isDbBusy(): boolean { return busyCount > 0; }
