import { useState } from 'react';
import { User, X, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgenteFilterProps {
  agentes: string[];
  selected: string;
  onChange: (agente: string) => void;
}

export function AgenteFilter({ agentes, selected, onChange }: AgenteFilterProps) {
  const [open, setOpen] = useState(false);

  if (agentes.length <= 1) return null;

  const active = selected !== '' && agentes.includes(selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-button border text-body-sm font-medium transition-colors cursor-pointer',
          active
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-glass-border bg-surface-secondary text-muted hover:text-foreground'
        )}
      >
        <User className="h-4 w-4" />
        <span>Agente{active ? `: ${selected}` : ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-card border border-glass-border bg-surface shadow-lg">
          {active && (
            <button
              onClick={() => { onChange(''); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-surface-secondary transition-colors cursor-pointer border-b border-glass-border"
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtro
            </button>
          )}
          {agentes.map((agente) => (
            <button
              key={agente}
              onClick={() => { onChange(agente); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selected === agente
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-surface-secondary'
              )}
            >
              {agente}
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
