import { Pencil, Trash2 } from 'lucide-react';
import { Card, Badge, Button } from '@/components/ui';
import type { Mentor } from '@/types';

interface MentorListProps {
  mentors: Mentor[];
  onEdit: (mentor: Mentor) => void;
  onDelete: (id: string) => void;
}

export function MentorList({ mentors, onEdit, onDelete }: MentorListProps) {
  const handleDelete = (mentor: Mentor) => {
    if (confirm(`Tem certeza que deseja excluir o mentor "${mentor.name}"?`)) {
      onDelete(mentor.id);
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {mentors.map((mentor) => (
        <Card
          key={mentor.id}
          className={`p-5 flex flex-col gap-3 ${!mentor.is_active ? 'opacity-50' : ''}`}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-heading text-heading-sm">{mentor.name}</h4>
            <Badge variant={mentor.is_active ? 'success' : 'danger'}>
              {mentor.is_active ? 'Ativo' : 'Inativo'}
            </Badge>
          </div>

          <p className="text-body-sm text-muted flex-1">{mentor.description}</p>

          <div className="flex items-center gap-2 pt-2 border-t border-glass-border">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(mentor)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleDelete(mentor)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
