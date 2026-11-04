import { create } from 'zustand';
import { setCustomModules, type CustomApp } from './modules';

/** Whether the side drawer is open. One tiny store so the header, the drawer and the layout agree. */
export const useShell = create<{ drawer: boolean; tick: number; customApps: CustomApp[]; setCustomApps: (apps: CustomApp[]) => void; open: () => void; close: () => void; refresh: () => void }>((set) => ({
  drawer: false,
  tick: 0,
  /** Apps the owner added himself. Setting them also makes them real modules (see modules.ts), so every screen can find them. */
  customApps: [],
  setCustomApps: (apps) => { setCustomModules(apps); set({ customApps: apps }); },
  /** Bumped by the header's refresh button: every open screen reloads. */
  refresh: () => set((s) => ({ tick: s.tick + 1 })),
  open: () => set({ drawer: true }),
  close: () => set({ drawer: false }),
}));
