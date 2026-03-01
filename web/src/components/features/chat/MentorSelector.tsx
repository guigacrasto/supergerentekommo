import { Chip } from '@/components/ui';
import { useChatStore } from '@/stores/chatStore';

export function MentorSelector() {
  const availableMentors = useChatStore((s) => s.availableMentors);
  const selectedMentorIds = useChatStore((s) => s.selectedMentorIds);
  const setSelectedMentorIds = useChatStore((s) => s.setSelectedMentorIds);

  const activeMentors = availableMentors.filter((m) => m.is_active);
  const isDefault = selectedMentorIds.length === 0;
  const isCouncil =
    activeMentors.length > 0 &&
    selectedMentorIds.length === activeMentors.length;

  const handleDefault = () => {
    setSelectedMentorIds([]);
  };

  const handleCouncil = () => {
    setSelectedMentorIds(activeMentors.map((m) => m.id));
  };

  const handleToggleMentor = (mentorId: string) => {
    const next = selectedMentorIds.includes(mentorId)
      ? selectedMentorIds.filter((id) => id !== mentorId)
      : [...selectedMentorIds, mentorId];
    setSelectedMentorIds(next);
  };

  if (activeMentors.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-glass-border px-4 py-3 light:border-glass-border-light">
      <Chip active={isDefault} onClick={handleDefault}>
        Padrao
      </Chip>

      {activeMentors.length >= 2 && (
        <Chip active={isCouncil} onClick={handleCouncil}>
          Conselho Completo
        </Chip>
      )}

      {activeMentors.map((mentor) => (
        <Chip
          key={mentor.id}
          active={selectedMentorIds.includes(mentor.id)}
          onClick={() => handleToggleMentor(mentor.id)}
          title={mentor.description}
        >
          {mentor.name}
        </Chip>
      ))}
    </div>
  );
}
