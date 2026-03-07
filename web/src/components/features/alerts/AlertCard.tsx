import { AlertTriangle, Clock, ListChecks, Archive, Check } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { LucideIcon } from 'lucide-react';

const severityConfig: Record<
  string,
  { icon: LucideIcon; badgeVariant: 'danger' | 'warning' | 'info' }
> = {
  danger: { icon: AlertTriangle, badgeVariant: 'danger' },
  warning: { icon: Clock, badgeVariant: 'warning' },
  info: { icon: ListChecks, badgeVariant: 'info' },
};

function formatTempo(updatedAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - updatedAt;
  if (diff < 0) return '0h';
  const dias = Math.floor(diff / 86400);
  const horas = Math.floor((diff % 86400) / 3600);
  if (dias === 0) return `${horas}h`;
  return `${dias}d ${horas}h`;
}

interface AlertCardProps {
  leadName: string;
  vendedor: string;
  timestamp: number;
  kommoUrl: string;
  severity: 'danger' | 'warning' | 'info';
  alertCount?: number;
  onArchive?: () => void;
  onComplete?: () => void;
  onCountClick?: () => void;
}

export function AlertCard({
  leadName,
  vendedor,
  timestamp,
  kommoUrl,
  severity,
  alertCount,
  onArchive,
  onComplete,
  onCountClick,
}: AlertCardProps) {
  const config = severityConfig[severity];
  const Icon = config.icon;
  const tempo = formatTempo(timestamp);

  return (
    <div className="flex items-center gap-3 rounded-button border border-glass-border bg-surface px-4 py-3 transition-colors hover:bg-surface-secondary group">
      <Icon className="h-4 w-4 flex-shrink-0 text-muted" />
      <a
        href={kommoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-1 items-center gap-2 min-w-0"
      >
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-body-md font-heading font-medium truncate">
            {leadName}
          </span>
          <span className="text-body-sm text-muted truncate">
            {vendedor}
          </span>
        </div>
      </a>
      <div className="flex items-center gap-2 flex-shrink-0">
        {alertCount !== undefined && alertCount > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onCountClick?.(); }}
            className="flex items-center justify-center h-6 min-w-[24px] px-1.5 rounded-full bg-primary/20 text-primary text-xs font-bold cursor-pointer hover:bg-primary/30 transition-colors"
            title={`${alertCount} alertas anteriores`}
          >
            {alertCount}
          </button>
        )}
        <Badge variant={config.badgeVariant} className="flex-shrink-0">
          {tempo}
        </Badge>
        {onComplete && (
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-button text-muted hover:text-success hover:bg-success/10 transition-all cursor-pointer"
            title="Marcar como concluído"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        {onArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-button text-muted hover:text-foreground hover:bg-surface-secondary transition-all cursor-pointer"
            title="Arquivar alerta"
          >
            <Archive className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
