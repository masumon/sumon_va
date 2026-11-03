import { create } from 'zustand';

/** Whether the side drawer is open. One tiny store so the header, the drawer and the layout agree. */
export const useShell = create<{ drawer: boolean; tick: number; open: () => void; close: () => void; refresh: () => void }>((set) => ({
  drawer: false,
  tick: 0,
  /** Bumped by the header's refresh button: every open screen reloads. */
  refresh: () => set((s) => ({ tick: s.tick + 1 })),
  open: () => set({ drawer: true }),
  close: () => set({ drawer: false }),
}));
