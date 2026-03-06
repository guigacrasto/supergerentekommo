import { useEffect, useState } from 'react';
import { Tag, X, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useFilterStore } from '@/stores/filterStore';
import { cn } from '@/lib/utils';

interface TagItem {
  id: number;
  name: string;
  team: string;
}

export function TagFilter() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [open, setOpen] = useState(false);
  const selectedTags = useFilterStore((s) => s.selectedTags);
  const setSelectedTags = useFilterStore((s) => s.setSelectedTags);
  const tagMode = useFilterStore((s) => s.tagMode);
  const setTagMode = useFilterStore((s) => s.setTagMode);

  useEffect(() => {
    api.get<TagItem[]>('/reports/tags')
      .then((res) => {
        // Deduplicate tags by name (same tag can appear in multiple teams)
        const unique = new Map<string, TagItem>();
        for (const t of res.data) {
          if (!unique.has(t.name)) unique.set(t.name, t);
        }
        setTags(Array.from(unique.values()));
      })
      .catch(() => {});
  }, []);

  const toggleTag = (id: number) => {
    if (selectedTags.includes(id)) {
      setSelectedTags(selectedTags.filter((t) => t !== id));
    } else {
      setSelectedTags([...selectedTags, id]);
    }
  };

  const clearAll = () => setSelectedTags([]);

  if (tags.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-button border text-body-sm font-medium transition-colors cursor-pointer',
          selectedTags.length > 0
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-glass-border bg-surface-secondary text-muted hover:text-foreground'
        )}
      >
        <Tag className="h-4 w-4" />
        <span>Tags{selectedTags.length > 0 ? ` (${selectedTags.length})` : ''}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[280px] overflow-y-auto rounded-card border border-glass-border bg-surface shadow-lg">
          {selectedTags.length > 0 && (
            <button
              onClick={clearAll}
              className="flex w-full items-center gap-2 px-3 py-2 text-body-sm text-danger hover:bg-surface-secondary transition-colors cursor-pointer border-b border-glass-border"
            >
              <X className="h-3.5 w-3.5" />
              Limpar filtro
            </button>
          )}
          {selectedTags.length > 0 && (
            <div className="flex items-center gap-1 px-3 py-2 border-b border-glass-border">
              <span className="text-body-sm text-muted mr-1">Modo:</span>
              <button
                onClick={() => setTagMode('or')}
                className={cn(
                  'px-2 py-0.5 rounded text-body-sm font-medium transition-colors cursor-pointer',
                  tagMode === 'or'
                    ? 'bg-primary text-white'
                    : 'bg-surface-secondary text-muted hover:text-foreground'
                )}
              >
                Qualquer
              </button>
              <button
                onClick={() => setTagMode('and')}
                className={cn(
                  'px-2 py-0.5 rounded text-body-sm font-medium transition-colors cursor-pointer',
                  tagMode === 'and'
                    ? 'bg-primary text-white'
                    : 'bg-surface-secondary text-muted hover:text-foreground'
                )}
              >
                Todas
              </button>
            </div>
          )}
          {tags.map((tag) => (
            <label
              key={tag.id}
              className="flex items-center gap-2 px-3 py-2 text-body-sm text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedTags.includes(tag.id)}
                onChange={() => toggleTag(tag.id)}
                className="rounded border-glass-border accent-primary"
              />
              {tag.name}
            </label>
          ))}
        </div>
      )}

      {/* Backdrop to close dropdown */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
