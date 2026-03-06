import { useState } from 'react';
import { Filter, X, ChevronDown } from 'lucide-react';
import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';

interface FunilFilterProps {
  funis: string[];
}

export function FunilFilter({ funis }: FunilFilterProps) {
  const [open, setOpen] = useState(false);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const setSelectedFunil = useFilterStore((s) => s.setSelectedFunil);

  if (funis.length <= 1) return null;

  const active = selectedFunil !== '' && funis.includes(selectedFunil);

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
        <Filter className="h-4 w-4" />
        <span>Funil{active ? `: ${selectedFunil}` : ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-card border border-glass-border bg-surface shadow-lg">
          {active && (
            <button
              onClick={() => { setSelectedFunil(''); setOpen(false); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-surface-secondary transition-colors cursor-pointer border-b border-glass-border"
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtro
            </button>
          )}
          {funis.map((funil) => (
            <button
              key={funil}
              onClick={() => { setSelectedFunil(funil); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selectedFunil === funil
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-surface-secondary'
              )}
            >
              {funil}
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
