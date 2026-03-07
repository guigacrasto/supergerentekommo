import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, XCircle, Inbox } from 'lucide-react';
import { Card, CardHeader, CardTitle, Badge } from '@/components/ui';
import type { LucideIcon } from 'lucide-react';

interface AlertEntry {
  leadName: string;
  vendedor: string;
  dias: number;
  kommoUrl: string;
  severity: 'danger' | 'warning' | 'orange';
}

const severityConfig: Record<
  AlertEntry['severity'],
  { icon: LucideIcon; badgeVariant: 'danger' | 'warning' | 'default' }
> = {
  danger: { icon: AlertTriangle, badgeVariant: 'danger' },
  warning: { icon: Clock, badgeVariant: 'warning' },
  orange: { icon: XCircle, badgeVariant: 'warning' },
};

interface RawAlertItem {
  nome?: string;
  leadNome?: string;
  vendedor: string;
  diasSemAtividade?: number;
  diasVencida?: number;
  kommoUrl: string;
}

interface RecentAlertsProps {
  alerts48h: RawAlertItem[];
  alerts7d: RawAlertItem[];
  tarefas: RawAlertItem[];
}

function normalizeAlerts(
  items: RawAlertItem[],
  severity: AlertEntry['severity']
): AlertEntry[] {
  return items.map((item) => ({
    leadName: item.nome || item.leadNome || 'Lead sem nome',
    vendedor: item.vendedor,
    dias: item.diasSemAtividade ?? item.diasVencida ?? 0,
    kommoUrl: item.kommoUrl,
    severity,
  }));
}

export function RecentAlerts({ alerts48h, alerts7d, tarefas }: RecentAlertsProps) {
  const allAlerts: AlertEntry[] = [
    ...normalizeAlerts(alerts48h, 'danger'),
    ...normalizeAlerts(alerts7d, 'warning'),
    ...normalizeAlerts(tarefas, 'orange'),
  ].slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alertas Recentes</CardTitle>
        <Link
          to="/alerts"
          className="text-body-sm text-primary hover:text-primary-600 transition-colors font-heading font-medium"
        >
          Ver todos →
        </Link>
      </CardHeader>

      <div className="p-4">
        {allAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="h-8 w-8 text-muted mb-2" />
            <p className="text-body-md text-muted">Nenhum alerta ativo</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allAlerts.map((alert, idx) => {
              const config = severityConfig[alert.severity];
              const Icon = config.icon;

              return (
                <a
                  key={idx}
                  href={alert.kommoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-button px-3 py-2.5 transition-colors hover:bg-surface-secondary"
                >
                  <Icon className="h-4 w-4 flex-shrink-0 text-muted" />
                  <div className="flex flex-1 items-center justify-between gap-2 min-w-0">
                    <div className="flex flex-col min-w-0">
                      <span className="text-body-md font-heading font-medium truncate">
                        {alert.leadName}
                      </span>
                      <span className="text-body-sm text-muted truncate">
                        {alert.vendedor}
                      </span>
                    </div>
                    <Badge variant={config.badgeVariant} className="flex-shrink-0">
                      {alert.dias}d
                    </Badge>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
