import { useState } from 'react';
import { Users, X, ChevronDown } from 'lucide-react';
import { TEAM_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface TimeFilterProps {
  teams: string[];
  selected: string;
  onChange: (team: string) => void;
}

export function TimeFilter({ teams, selected, onChange }: TimeFilterProps) {
  const [open, setOpen] = useState(false);

  if (teams.length <= 1) return null;

  const active = selected !== '';
  const label = active ? TEAM_LABELS[selected] || selected : '';

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
        <Users className="h-4 w-4" />
        <span>Time{active ? `: ${label}` : ''}</span>
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
          {teams.map((team) => (
            <button
              key={team}
              onClick={() => { onChange(team); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selected === team
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-surface-secondary'
              )}
            >
              {TEAM_LABELS[team] || team}
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
