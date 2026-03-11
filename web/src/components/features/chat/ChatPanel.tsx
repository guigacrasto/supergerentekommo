import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chatStore';
import type { ChatResponse } from '@/types';
import { MentorSelector } from './MentorSelector';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';

function getWelcomeMessage(
  mentorIds: string[],
  mentorNames: Map<string, string>
): string {
  if (mentorIds.length === 0) {
    return 'Ola! Sou o assistente inteligente do SuperGerente. Tenho acesso aos dados reais dos seus funis — leads, conversoes, agentes e muito mais. O que deseja saber?';
  }
  if (mentorIds.length === 1) {
    const name = mentorNames.get(mentorIds[0]) || 'o mentor';
    return `Ola! Sou ${name}. Como posso ajudar?`;
  }
  return `Conselho ativado com ${mentorIds.length} mentores. Faca sua pergunta.`;
}

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages);
  const sessionId = useChatStore((s) => s.sessionId);
  const loading = useChatStore((s) => s.loading);
  const selectedMentorIds = useChatStore((s) => s.selectedMentorIds);
  const availableMentors = useChatStore((s) => s.availableMentors);
  const addMessage = useChatStore((s) => s.addMessage);
  const setSessionId = useChatStore((s) => s.setSessionId);
  const setLoading = useChatStore((s) => s.setLoading);

  const scrollRef = useRef<HTMLDivElement>(null);

  const mentorNames = new Map(
    availableMentors.map((m) => [m.id, m.name])
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // Show welcome message when no messages
  const showWelcome = messages.length === 0;

  const handleSend = async (text: string) => {
    addMessage({ role: 'user', content: text });
    setLoading(true);

    try {
      const res = await api.post<ChatResponse>('/chat', {
        message: text,
        sessionId,
        mentorIds: selectedMentorIds.length > 0 ? selectedMentorIds : undefined,
      });

      addMessage({
        role: 'assistant',
        content: res.data.response,
        data: res.data.data,
      });
      setSessionId(res.data.sessionId);
    } catch (err) {
      addMessage({
        role: 'assistant',
        content: 'Desculpe, ocorreu um erro ao processar sua mensagem. Tente novamente.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <MentorSelector />

      <div ref={scrollRef} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        {showWelcome && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-surface-secondary/80 border border-glass-border px-4 py-3 text-body-md">
              <p>{getWelcomeMessage(selectedMentorIds, mentorNames)}</p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-md bg-surface-secondary/80 border border-glass-border px-4 py-3 text-body-md animate-pulse">
              ...
            </div>
          </div>
        )}
      </div>

      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  );
}
