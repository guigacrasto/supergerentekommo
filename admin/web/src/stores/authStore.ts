import { create } from 'zustand';
import type { User } from '@/types';
import { STORAGE_KEYS } from '@/lib/constants';

interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

function readStoredAuth(): { token: string; user: User } | null {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const userStr = localStorage.getItem(STORAGE_KEYS.user);
  if (token && userStr) {
    try {
      return { token, user: JSON.parse(userStr) as User };
    } catch {
      return null;
    }
  }
  return null;
}

const stored = readStoredAuth();

export const useAuthStore = create<AuthState>((set) => ({
  token: stored?.token ?? null,
  user: stored?.user ?? null,
  isAuthenticated: !!stored,

  login: (token, user) => {
    localStorage.setItem(STORAGE_KEYS.token, token);
    localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem(STORAGE_KEYS.token);
    localStorage.removeItem(STORAGE_KEYS.user);
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
