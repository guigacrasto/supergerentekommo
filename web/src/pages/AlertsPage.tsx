import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { LiveTimestamp } from '@/components/ui';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { AlertList } from '@/components/features/alerts/AlertList';
import { AlertHistoryModal } from '@/components/features/alerts/AlertHistoryModal';
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

interface ActivityTeamData {
  team: string;
  label: string;
  activity: {
    leadsAbandonados48h: RawAlertLead[];
    leadsEmRisco7d: RawAlertLead[];
    tarefasVencidas: RawAlertTask[];
  };
}

type AlertFilter = 'todos' | 'risco48h' | 'risco7d' | 'tarefas';

const ALERT_TYPES: Array<{ value: AlertFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'risco48h', label: '+48h' },
  { value: 'risco7d', label: '+7 dias' },
  { value: 'tarefas', label: 'Tarefas' },
];

const STORAGE_KEY_ARCHIVED = 'sg_archived_alerts';
const STORAGE_KEY_HISTORY = 'sg_alert_history';

function loadArchived(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ARCHIVED);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveArchived(keys: Set<string>) {
  localStorage.setItem(STORAGE_KEY_ARCHIVED, JSON.stringify([...keys]));
}

function loadHistory(): Record<string, Array<{ type: string; date: string }>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveHistory(history: Record<string, Array<{ type: string; date: string }>>) {
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
}

export function AlertsPage() {
  const [data, setData] = useState<ActivityTeamData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetchTime, setLastFetchTime] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [alertFilter, setAlertFilter] = useState<AlertFilter>('todos');
  const [tab, setTab] = useState<'ativos' | 'arquivados'>('ativos');
  const [archivedKeys, setArchivedKeys] = useState<Set<string>>(loadArchived);
  const [alertHistory, setAlertHistory] = useState<Record<string, Array<{ type: string; date: string }>>>(loadHistory);
  const [historyModal, setHistoryModal] = useState<number | null>(null);

  const user = useAuthStore((s) => s.user);
  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<ActivityTeamData[]>('/reports/activity');
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[AlertsPage] Erro ao carregar alertas:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleArchive = (key: string, leadId: number, type: string) => {
    const newArchived = new Set(archivedKeys);
    newArchived.add(key);
    setArchivedKeys(newArchived);
    saveArchived(newArchived);

    const newHistory = { ...alertHistory };
    const leadKey = String(leadId);
    if (!newHistory[leadKey]) newHistory[leadKey] = [];
    newHistory[leadKey].push({
      type,
      date: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    });
    setAlertHistory(newHistory);
    saveHistory(newHistory);
  };

  const handleCountClick = (leadId: number) => {
    setHistoryModal(leadId);
  };

  // Filter by team
  const filteredTeams = data.filter(
    (t) => !teamFilter || t.team === teamFilter
  );

  // Aggregate alerts across teams
  const alerts48h =
    alertFilter === 'todos' || alertFilter === 'risco48h'
      ? filteredTeams.flatMap((t) => t.activity.leadsAbandonados48h)
      : [];

  const alerts7d =
    alertFilter === 'todos' || alertFilter === 'risco7d'
      ? filteredTeams.flatMap((t) => t.activity.leadsEmRisco7d)
      : [];

  const tarefas =
    alertFilter === 'todos' || alertFilter === 'tarefas'
      ? filteredTeams.flatMap((t) => t.activity.tarefasVencidas)
      : [];

  const modalHistory = historyModal !== null ? (alertHistory[String(historyModal)] || []) : [];

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={setTeamFilter} />

        <div className="flex items-center gap-1.5">
          {ALERT_TYPES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setAlertFilter(value)}
              className={cn(
                'px-3 py-1.5 rounded-button text-body-sm font-medium transition-colors cursor-pointer',
                alertFilter === value
                  ? 'bg-primary text-white'
                  : 'bg-surface-secondary text-muted hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs: Ativos / Arquivados */}
      <div className="flex items-center gap-1 border-b border-glass-border">
        <button
          onClick={() => setTab('ativos')}
          className={cn(
            'px-4 py-2.5 text-body-md font-medium border-b-2 transition-colors cursor-pointer',
            tab === 'ativos'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          Ativos
        </button>
        <button
          onClick={() => setTab('arquivados')}
          className={cn(
            'px-4 py-2.5 text-body-md font-medium border-b-2 transition-colors cursor-pointer',
            tab === 'arquivados'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          Arquivados
          {archivedKeys.size > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-surface-secondary text-xs text-muted">
              {archivedKeys.size}
            </span>
          )}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <AlertList
          alerts48h={alerts48h}
          alerts7d={alerts7d}
          tarefas={tarefas}
          archivedKeys={archivedKeys}
          alertHistory={alertHistory}
          onArchive={handleArchive}
          onCountClick={handleCountClick}
          showArchived={tab === 'arquivados'}
        />
      )}

      {historyModal !== null && (
        <AlertHistoryModal
          leadId={historyModal}
          history={modalHistory}
          onClose={() => setHistoryModal(null)}
        />
      )}
    </div>
  );
}
