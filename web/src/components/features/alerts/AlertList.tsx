import { useState } from 'react';
import { AlertTriangle, Clock, ListChecks, CheckCircle2, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui';
import { AlertCard } from './AlertCard';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RawAlertLead {
  id: number;
  nome: string;
  vendedor: string;
  diasSemAtividade: number;
  updatedAt?: number;
  kommoUrl: string;
}

interface RawAlertTask {
  id: number;
  texto: string;
  vendedor: string;
  leadId: number;
  leadNome: string;
  diasVencida: number;
  completeTill?: number;
  kommoUrl: string;
}

interface AlertListProps {
  alerts48h: RawAlertLead[];
  alerts7d: RawAlertLead[];
  tarefas: RawAlertTask[];
  archivedKeys: Set<string>;
  alertHistory: Record<string, Array<{ type: string; date: string }>>;
  onArchive: (key: string, leadId: number, type: string) => void;
  onCountClick: (leadId: number) => void;
  showArchived: boolean;
}

interface SectionConfig {
  title: string;
  icon: LucideIcon;
  severity: 'danger' | 'warning' | 'info';
  borderColor: string;
}

const sections: SectionConfig[] = [
  {
    title: 'Leads sem atividade +48h',
    icon: AlertTriangle,
    severity: 'danger',
    borderColor: 'border-l-danger',
  },
  {
    title: 'Leads em risco +7 dias',
    icon: Clock,
    severity: 'warning',
    borderColor: 'border-l-warning',
  },
  {
    title: 'Tarefas vencidas',
    icon: ListChecks,
    severity: 'info',
    borderColor: 'border-l-accent-blue',
  },
];

function CollapsibleSection({
  config,
  items,
  archivedKeys,
  alertHistory,
  onArchive,
  onCountClick,
  showArchived,
}: {
  config: SectionConfig;
  items: Array<{
    key: string;
    leadId: number;
    leadName: string;
    vendedor: string;
    timestamp: number;
    kommoUrl: string;
    type: string;
  }>;
  archivedKeys: Set<string>;
  alertHistory: Record<string, Array<{ type: string; date: string }>>;
  onArchive: (key: string, leadId: number, type: string) => void;
  onCountClick: (leadId: number) => void;
  showArchived: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const filteredItems = showArchived
    ? items.filter((item) => archivedKeys.has(item.key))
    : items.filter((item) => !archivedKeys.has(item.key));

  if (filteredItems.length === 0) return null;

  const Icon = config.icon;

  return (
    <div className={`rounded-card border border-glass-border bg-surface border-l-4 ${config.borderColor}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 border-b border-glass-border px-5 py-4 cursor-pointer hover:bg-surface-secondary/30 transition-colors"
      >
        <Icon className="h-5 w-5 text-muted" />
        <span className="font-heading text-heading-sm">
          {config.title}
        </span>
        <Badge variant="default" className="ml-2">
          {filteredItems.length}
        </Badge>
        <ChevronDown className={cn(
          'ml-auto h-5 w-5 text-muted transition-transform',
          collapsed && '-rotate-90'
        )} />
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-2 p-4">
          {filteredItems.map((item) => {
            const leadHistory = alertHistory[String(item.leadId)] || [];
            return (
              <AlertCard
                key={item.key}
                leadName={item.leadName}
                vendedor={item.vendedor}
                timestamp={item.timestamp}
                kommoUrl={item.kommoUrl}
                severity={config.severity}
                alertCount={leadHistory.length}
                onArchive={showArchived ? undefined : () => onArchive(item.key, item.leadId, item.type)}
                onCountClick={leadHistory.length > 0 ? () => onCountClick(item.leadId) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AlertList({
  alerts48h,
  alerts7d,
  tarefas,
  archivedKeys,
  alertHistory,
  onArchive,
  onCountClick,
  showArchived,
}: AlertListProps) {
  const now = Math.floor(Date.now() / 1000);

  const sectionData = [
    {
      config: sections[0],
      items: alerts48h.map((a) => ({
        key: `48h-${a.id}`,
        leadId: a.id,
        leadName: a.nome,
        vendedor: a.vendedor,
        timestamp: a.updatedAt || (now - a.diasSemAtividade * 86400),
        kommoUrl: a.kommoUrl,
        type: '+48h',
      })),
    },
    {
      config: sections[1],
      items: alerts7d.map((a) => ({
        key: `7d-${a.id}`,
        leadId: a.id,
        leadName: a.nome,
        vendedor: a.vendedor,
        timestamp: a.updatedAt || (now - a.diasSemAtividade * 86400),
        kommoUrl: a.kommoUrl,
        type: '+7d',
      })),
    },
    {
      config: sections[2],
      items: tarefas.map((t) => ({
        key: `task-${t.id}`,
        leadId: t.leadId,
        leadName: t.leadNome,
        vendedor: `${t.vendedor} \u00B7 ${t.texto}`,
        timestamp: t.completeTill || (now - t.diasVencida * 86400),
        kommoUrl: t.kommoUrl,
        type: 'tarefa',
      })),
    },
  ];

  const hasItems = sectionData.some((s) => {
    const filtered = showArchived
      ? s.items.filter((item) => archivedKeys.has(item.key))
      : s.items.filter((item) => !archivedKeys.has(item.key));
    return filtered.length > 0;
  });

  if (!hasItems) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-card bg-success/10 p-4">
          <CheckCircle2 className="h-10 w-10 text-success" />
        </div>
        <h3 className="font-heading text-heading-sm mb-1">
          {showArchived ? 'Nenhum alerta arquivado' : 'Tudo em dia!'}
        </h3>
        <p className="text-body-md text-muted">
          {showArchived ? 'Seus alertas arquivados aparecerão aqui.' : 'Nenhum alerta ativo no momento.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {sectionData.map(({ config, items }) => (
        <CollapsibleSection
          key={config.severity}
          config={config}
          items={items}
          archivedKeys={archivedKeys}
          alertHistory={alertHistory}
          onArchive={onArchive}
          onCountClick={onCountClick}
          showArchived={showArchived}
        />
      ))}
    </div>
  );
}
