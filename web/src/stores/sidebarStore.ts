import { create } from 'zustand';

const STORAGE_KEY = 'sg_sidebar_collapsed';

interface SidebarState {
  collapsed: boolean;
  mobileOpen: boolean;
  toggle: () => void;
  openMobile: () => void;
  closeMobile: () => void;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: localStorage.getItem(STORAGE_KEY) === 'true',
  mobileOpen: false,

  toggle: () =>
    set((state) => {
      const next = !state.collapsed;
      localStorage.setItem(STORAGE_KEY, String(next));
      return { collapsed: next };
    }),

  openMobile: () => set({ mobileOpen: true }),
  closeMobile: () => set({ mobileOpen: false }),
}));
