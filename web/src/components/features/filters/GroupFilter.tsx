import { useState } from 'react';
import { UsersRound, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GroupFilterProps {
  grupos: string[];
  selected: string;
  onChange: (group: string) => void;
}

export function GroupFilter({ grupos, selected, onChange }: GroupFilterProps) {
  const [open, setOpen] = useState(false);

  if (grupos.length === 0) return null;

  const active = selected !== '';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-button border text-body-sm font-medium transition-all duration-200 cursor-pointer',
          active
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-glass-border bg-surface-secondary/60 text-muted hover:text-[#E0E3E9] hover:border-white/10'
        )}
      >
        <UsersRound className="h-4 w-4" />
        <span>Equipe{active ? `: ${selected}` : ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-card border border-glass-border bg-surface/95 backdrop-blur-glass shadow-lg">
          {active && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-surface-secondary transition-colors cursor-pointer border-b border-glass-border"
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtro
            </button>
          )}
          {grupos.map((g) => (
            <button
              key={g}
              onClick={() => { onChange(g); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selected === g
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-surface-secondary'
              )}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
