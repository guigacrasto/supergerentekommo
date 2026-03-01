import { create } from 'zustand';
import type { AlertFilter, AlertEquipeFilter } from '@/types';

interface FilterState {
  filterAgente: string;
  filterFunil: string;
  filterEquipe: string;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  fromDate: string;
  toDate: string;
  alertFilter: AlertFilter;
  alertEquipeFilter: AlertEquipeFilter;
  setAgentFilter: (key: 'filterAgente' | 'filterFunil' | 'filterEquipe', value: string) => void;
  setSort: (col: string) => void;
  setDateRange: (from: string, to: string) => void;
  setAlertFilter: (filter: AlertFilter) => void;
  setAlertEquipeFilter: (filter: AlertEquipeFilter) => void;
  clearAgentFilters: () => void;
  clearDateRange: () => void;
}

function getDefaultDates() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: now.toISOString().slice(0, 10),
  };
}

export const useFilterStore = create<FilterState>((set) => ({
  filterAgente: '',
  filterFunil: '',
  filterEquipe: '',
  sortCol: null,
  sortDir: 'asc',
  ...getDefaultDates(),
  alertFilter: 'todos',
  alertEquipeFilter: 'todas',

  setAgentFilter: (key, value) => set({ [key]: value }),

  setSort: (col) =>
    set((state) => ({
      sortCol: col,
      sortDir: state.sortCol === col && state.sortDir === 'asc' ? 'desc' : 'asc',
    })),

  setDateRange: (fromDate, toDate) => set({ fromDate, toDate }),

  setAlertFilter: (alertFilter) => set({ alertFilter }),

  setAlertEquipeFilter: (alertEquipeFilter) => set({ alertEquipeFilter }),

  clearAgentFilters: () =>
    set({ filterAgente: '', filterFunil: '', filterEquipe: '' }),

  clearDateRange: () => set(getDefaultDates()),
}));
