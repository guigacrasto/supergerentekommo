import { useEffect, useState, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { LiveTimestamp } from '@/components/ui';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { AlertList } from '@/components/features/alerts/AlertList';
import type { AlertTab } from '@/components/features/alerts/AlertList';
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
    leadsDDDProibido: RawAlertLead[];
  };
}

type AlertFilter = 'todos' | 'risco48h' | 'risco7d' | 'tarefas' | 'ddd';

const ALERT_TYPES: Array<{ value: AlertFilter; label: string }> = [
  { value: 'todos', label: 'Todos' },
  { value: 'risco48h', label: '+48h' },
  { value: 'risco7d', label: '+7 dias' },
  { value: 'tarefas', label: 'Tarefas' },
  { value: 'ddd', label: 'DDD Proibido' },
];

const STORAGE_KEY_ARCHIVED = 'sg_archived_alerts';
const STORAGE_KEY_COMPLETED = 'sg_completed_alerts';
const STORAGE_KEY_HISTORY = 'sg_alert_history';

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function saveSet(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s]));
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
  const [tab, setTab] = useState<AlertTab>('ativos');
  const [archivedKeys, setArchivedKeys] = useState<Set<string>>(() => loadSet(STORAGE_KEY_ARCHIVED));
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(() => loadSet(STORAGE_KEY_COMPLETED));
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

      // Auto-remover leads concluidos que voltaram a ter alerta
      // Se um lead concluido aparece nos alertas novos, remove do concluido
      const allAlertLeadKeys = new Set<string>();
      for (const td of res.data) {
        for (const a of td.activity.leadsAbandonados48h) allAlertLeadKeys.add(`48h-${a.id}`);
        for (const a of td.activity.leadsEmRisco7d) allAlertLeadKeys.add(`7d-${a.id}`);
        for (const t of td.activity.tarefasVencidas) allAlertLeadKeys.add(`task-${t.id}`);
        for (const a of (td.activity.leadsDDDProibido || [])) allAlertLeadKeys.add(`ddd-${a.id}`);
      }

      // Nao precisa remover automaticamente — o lead concluido que continua
      // no alerta fica como concluido. So volta pra ativo se tiver um NOVO alerta
      // (com key diferente). A logica eh: se a key do concluido nao existe mais
      // nos alertas atuais, podemos limpar. Mas se ainda existe, manter.
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
    saveSet(STORAGE_KEY_ARCHIVED, newArchived);

    // Remove de concluidos se estiver la
    const newCompleted = new Set(completedKeys);
    newCompleted.delete(key);
    setCompletedKeys(newCompleted);
    saveSet(STORAGE_KEY_COMPLETED, newCompleted);

    addHistoryEntry(leadId, type, 'Arquivado');
  };

  const handleComplete = (key: string, leadId: number, type: string) => {
    const newCompleted = new Set(completedKeys);
    newCompleted.add(key);
    setCompletedKeys(newCompleted);
    saveSet(STORAGE_KEY_COMPLETED, newCompleted);

    addHistoryEntry(leadId, type, 'Concluído');
  };

  const addHistoryEntry = (leadId: number, type: string, action: string) => {
    const newHistory = { ...alertHistory };
    const leadKey = String(leadId);
    if (!newHistory[leadKey]) newHistory[leadKey] = [];
    newHistory[leadKey].push({
      type: `${action}: ${type}`,
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

  // Extrair vendedores unicos pra referencia (nao filtramos por vendedor aqui,
  // mas os dados ficam disponiveis se precisar no futuro)

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

  const alertsDDD =
    alertFilter === 'todos' || alertFilter === 'ddd'
      ? filteredTeams.flatMap((t) => t.activity.leadsDDDProibido || [])
      : [];

  // Contadores por tab
  const countForTab = useMemo(() => {
    const allKeys: string[] = [];
    for (const td of filteredTeams) {
      for (const a of td.activity.leadsAbandonados48h) allKeys.push(`48h-${a.id}`);
      for (const a of td.activity.leadsEmRisco7d) allKeys.push(`7d-${a.id}`);
      for (const t of td.activity.tarefasVencidas) allKeys.push(`task-${t.id}`);
      for (const a of (td.activity.leadsDDDProibido || [])) allKeys.push(`ddd-${a.id}`);
    }

    let concluidos = 0;
    let arquivados = 0;
    for (const k of allKeys) {
      if (completedKeys.has(k)) concluidos++;
      if (archivedKeys.has(k)) arquivados++;
    }
    return { concluidos, arquivados };
  }, [filteredTeams, completedKeys, archivedKeys]);

  const modalHistory = historyModal !== null ? (alertHistory[String(historyModal)] || []) : [];

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={setTeamFilter} />
        <TagFilter />

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

      {/* Tabs: Ativos / Concluidos / Arquivados */}
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
          onClick={() => setTab('concluidos')}
          className={cn(
            'px-4 py-2.5 text-body-md font-medium border-b-2 transition-colors cursor-pointer',
            tab === 'concluidos'
              ? 'border-success text-success'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          Concluídos
          {countForTab.concluidos > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-success/10 text-xs text-success">
              {countForTab.concluidos}
            </span>
          )}
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
          {countForTab.arquivados > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-surface-secondary text-xs text-muted">
              {countForTab.arquivados}
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
          alertsDDD={alertsDDD}
          archivedKeys={archivedKeys}
          completedKeys={completedKeys}
          alertHistory={alertHistory}
          onArchive={handleArchive}
          onComplete={handleComplete}
          onCountClick={handleCountClick}
          tab={tab}
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
