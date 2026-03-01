import { create } from 'zustand';
import type { Message, Mentor } from '@/types';

interface ChatState {
  messages: Message[];
  sessionId: string | null;
  loading: boolean;
  availableMentors: Mentor[];
  selectedMentorIds: string[];
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setSessionId: (id: string | null) => void;
  setLoading: (loading: boolean) => void;
  setMentors: (mentors: Mentor[]) => void;
  setSelectedMentorIds: (ids: string[]) => void;
  resetChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  sessionId: null,
  loading: false,
  availableMentors: [],
  selectedMentorIds: [],

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setMessages: (messages) => set({ messages }),

  setSessionId: (sessionId) => set({ sessionId }),

  setLoading: (loading) => set({ loading }),

  setMentors: (mentors) => set({ availableMentors: mentors }),

  setSelectedMentorIds: (selectedMentorIds) =>
    set({ selectedMentorIds, messages: [], sessionId: null }),

  resetChat: () =>
    set({ messages: [], sessionId: null, selectedMentorIds: [] }),
}));
