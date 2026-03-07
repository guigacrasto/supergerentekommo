import { useEffect, useState, useCallback } from 'react';
import { Brain, Loader2, RefreshCw, Archive, Clock, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { EmptyState, Button, Badge } from '@/components/ui';
import { AgentScoreCard } from '@/components/features/insights/AgentScoreCard';
import { ConversationCard } from '@/components/features/insights/ConversationCard';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { AgenteFilter } from '@/components/features/filters/AgenteFilter';
import { cn } from '@/lib/utils';

interface ConversationInsight {
  leadId: number;
  leadNome: string;
  vendedor: string;
  kommoUrl?: string;
  sentimentScore: number;
  qualityScore: number;
  resumo: string;
  pontosPositivos: string[];
  pontosMelhoria: string[];
  analisadoEm: string;
}

interface AgentInsightSummary {
  nome: string;
  team: string;
  mediaSentimento: number;
  mediaQualidade: number;
  totalAnalisados: number;
  insights: ConversationInsight[];
}

interface InsightsResponse {
  insights: AgentInsightSummary[];
  processing: boolean;
}

interface FiltersResponse {
  funis: string[];
  agentes: string[];
}

interface SavedReport {
  id: string;
  team: string;
  funil: string;
  agente: string;
  data: AgentInsightSummary[];
  createdAt: string;
  archived: boolean;
}

const STORAGE_KEY = 'sg_insights_history';

function loadHistory(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return [];
}

function saveHistory(reports: SavedReport[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
}

export function InsightsPage() {
  const user = useAuthStore((s) => s.user);
  const userTeams = user?.teams ?? [];

  // Filter state
  const [teamFilter, setTeamFilter] = useState('');
  const [funilFilter, setFunilFilter] = useState('');
  const [agenteFilter, setAgenteFilter] = useState('');
  const [funis, setFunis] = useState<string[]>([]);
  const [agentes, setAgentes] = useState<string[]>([]);

  // Data state
  const [data, setData] = useState<AgentInsightSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

  // History/archive state
  const [tab, setTab] = useState<'atual' | 'historico' | 'arquivados'>('atual');
  const [history, setHistory] = useState<SavedReport[]>(loadHistory);
  const [viewingReport, setViewingReport] = useState<SavedReport | null>(null);

  // Fetch available funis/agentes when team changes
  const fetchFilters = useCallback(async (team: string) => {
    if (!team) {
      setFunis([]);
      setAgentes([]);
      return;
    }
    try {
      const res = await api.get<FiltersResponse>('/insights/filters', {
        params: { team },
      });
      setFunis(res.data.funis);
      setAgentes(res.data.agentes);
    } catch (err) {
      console.error('[InsightsPage] Erro ao carregar filtros:', err);
    }
  }, []);

  useEffect(() => {
    fetchFilters(teamFilter);
    setFunilFilter('');
    setAgenteFilter('');
  }, [teamFilter, fetchFilters]);

  const handleGenerate = async () => {
    if (!teamFilter) return;

    setLoading(true);
    setHasGenerated(true);
    setTab('atual');
    setViewingReport(null);

    try {
      const res = await api.get<InsightsResponse>('/insights/conversations', {
        params: {
          team: teamFilter,
          funil: funilFilter || undefined,
          agente: agenteFilter || undefined,
        },
      });
      const { insights, processing: isProcessing } = res.data;
      setData(insights);
      setProcessing(isProcessing);
      if (insights.length > 0) {
        setSelectedAgent(insights[0].nome);
      }

      // Save to history
      if (insights.length > 0) {
        const report: SavedReport = {
          id: Date.now().toString(),
          team: teamFilter,
          funil: funilFilter,
          agente: agenteFilter,
          data: insights,
          createdAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
          archived: false,
        };
        const newHistory = [report, ...history];
        setHistory(newHistory);
        saveHistory(newHistory);
      }
    } catch (err) {
      console.error('[InsightsPage] Erro ao gerar insights:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = (reportId: string) => {
    const updated = history.map((r) =>
      r.id === reportId ? { ...r, archived: !r.archived } : r
    );
    setHistory(updated);
    saveHistory(updated);
  };

  const handleDeleteReport = (reportId: string) => {
    const updated = history.filter((r) => r.id !== reportId);
    setHistory(updated);
    saveHistory(updated);
    if (viewingReport?.id === reportId) setViewingReport(null);
  };

  const handleViewReport = (report: SavedReport) => {
    setViewingReport(report);
    setData(report.data);
    setSelectedAgent(report.data[0]?.nome || null);
    setHasGenerated(true);
    setTab('atual');
  };

  // Poll while processing
  useEffect(() => {
    if (!processing) return;

    const timer = setInterval(async () => {
      try {
        const res = await api.get<InsightsResponse>('/insights/conversations', {
          params: {
            team: teamFilter,
            funil: funilFilter || undefined,
            agente: agenteFilter || undefined,
          },
        });
        setData(res.data.insights);
        setProcessing(res.data.processing);
        if (res.data.insights.length > 0 && !selectedAgent) {
          setSelectedAgent(res.data.insights[0].nome);
        }
      } catch { /* ignore */ }
    }, 15_000);

    return () => clearInterval(timer);
  }, [processing, teamFilter, funilFilter, agenteFilter, selectedAgent]);

  const activeHistory = history.filter((r) => !r.archived);
  const archivedHistory = history.filter((r) => r.archived);

  const selected = data.find((a) => a.nome === selectedAgent);
  const conversations = selected?.insights ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="font-heading text-heading-lg">Insights de Atendimento</h1>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-card border border-glass-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <TimeFilter teams={userTeams} selected={teamFilter} onChange={setTeamFilter} />

          {funis.length > 0 && (
            <FunilDropdown funis={funis} selected={funilFilter} onChange={setFunilFilter} />
          )}

          {agentes.length > 0 && (
            <AgenteFilter agentes={agentes} selected={agenteFilter} onChange={setAgenteFilter} />
          )}
        </div>

        <Button
          variant="primary"
          size="sm"
          disabled={!teamFilter || loading}
          loading={loading}
          onClick={handleGenerate}
        >
          <RefreshCw className="h-4 w-4" />
          {hasGenerated ? 'Atualizar Insights' : 'Gerar Insights'}
        </Button>

        {!teamFilter && (
          <span className="text-body-sm text-muted">
            Selecione um Time para gerar insights
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-glass-border">
        <button
          onClick={() => { setTab('atual'); setViewingReport(null); }}
          className={cn(
            'px-4 py-2.5 text-body-md font-medium border-b-2 transition-colors cursor-pointer',
            tab === 'atual'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          Atual
        </button>
        <button
          onClick={() => setTab('historico')}
          className={cn(
            'px-4 py-2.5 text-body-md font-medium border-b-2 transition-colors cursor-pointer',
            tab === 'historico'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-foreground'
          )}
        >
          Histórico
          {activeHistory.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-surface-secondary text-xs text-muted">
              {activeHistory.length}
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
          {archivedHistory.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded-full bg-surface-secondary text-xs text-muted">
              {archivedHistory.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'atual' && (
        <>
          {!hasGenerated && (
            <EmptyState
              icon={Brain}
              title="Selecione os filtros e gere insights"
              description="Escolha o Time, Funil e Agente acima e clique em 'Gerar Insights' para analisar as conversas."
            />
          )}

          {loading && (
            <div className="flex flex-col items-center gap-4 py-16">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-body-md text-muted text-center max-w-md">
                Analisando conversas com IA... Isso pode levar alguns minutos.
              </p>
            </div>
          )}

          {hasGenerated && !loading && data.length === 0 && (
            <EmptyState
              icon={Brain}
              title="Nenhum insight encontrado"
              description="Nenhuma conversa relevante foi encontrada para os filtros selecionados."
            />
          )}

          {hasGenerated && !loading && data.length > 0 && (
            <>
              {viewingReport && (
                <div className="flex items-center gap-2 text-body-sm text-muted">
                  <Clock className="h-4 w-4" />
                  Visualizando relatório de {viewingReport.createdAt}
                  {viewingReport.funil && ` | Funil: ${viewingReport.funil}`}
                  {viewingReport.agente && ` | Agente: ${viewingReport.agente}`}
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
                {/* Agent list */}
                <div className="flex flex-col gap-3">
                  <h2 className="font-heading text-heading-sm text-muted">Agentes</h2>
                  {data.map((agent) => (
                    <AgentScoreCard
                      key={agent.nome}
                      nome={agent.nome}
                      team={agent.team}
                      mediaSentimento={agent.mediaSentimento}
                      mediaQualidade={agent.mediaQualidade}
                      totalAnalisados={agent.totalAnalisados}
                      isSelected={selectedAgent === agent.nome}
                      onClick={() => setSelectedAgent(agent.nome)}
                    />
                  ))}
                </div>

                {/* Conversations */}
                <div className="flex flex-col gap-4">
                  <h2 className="font-heading text-heading-sm text-muted">
                    Conversas analisadas — {selected?.nome ?? ''}
                  </h2>
                  {conversations.length === 0 ? (
                    <p className="text-body-md text-muted py-8 text-center">
                      Selecione um agente para ver as conversas.
                    </p>
                  ) : (
                    conversations.map((c) => (
                      <ConversationCard
                        key={c.leadId}
                        {...c}
                      />
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'historico' && (
        <ReportList
          reports={activeHistory}
          onView={handleViewReport}
          onArchive={handleArchive}
          onDelete={handleDeleteReport}
          emptyTitle="Nenhum relatório no histórico"
          emptyDescription="Gere insights para que os relatórios apareçam aqui."
        />
      )}

      {tab === 'arquivados' && (
        <ReportList
          reports={archivedHistory}
          onView={handleViewReport}
          onArchive={handleArchive}
          onDelete={handleDeleteReport}
          emptyTitle="Nenhum relatório arquivado"
          emptyDescription="Seus relatórios arquivados aparecerão aqui."
        />
      )}
    </div>
  );
}

// Simple funil dropdown (local state, not from filterStore, to keep insights page independent)
function FunilDropdown({
  funis,
  selected,
  onChange,
}: {
  funis: string[];
  selected: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = selected !== '';

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
        <span>Funil{active ? `: ${selected}` : ''}</span>
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
          {funis.map((funil) => (
            <button
              key={funil}
              onClick={() => { onChange(funil); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selected === funil
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

function ReportList({
  reports,
  onView,
  onArchive,
  onDelete,
  emptyTitle,
  emptyDescription,
}: {
  reports: SavedReport[];
  onView: (r: SavedReport) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (reports.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {reports.map((report) => {
        const totalConversas = report.data.reduce((s, a) => s + a.totalAnalisados, 0);
        const avgQuality = report.data.length > 0
          ? report.data.reduce((s, a) => s + a.mediaQualidade, 0) / report.data.length
          : 0;

        return (
          <div
            key={report.id}
            className="group flex items-center gap-4 rounded-card border border-glass-border bg-surface p-4 hover:bg-surface-secondary/30 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-heading text-heading-sm">{report.createdAt}</span>
                <Badge variant="default">{report.team}</Badge>
                {report.funil && <Badge variant="default">{report.funil}</Badge>}
                {report.agente && <Badge variant="default">{report.agente}</Badge>}
              </div>
              <div className="flex items-center gap-3 mt-1 text-body-sm text-muted">
                <span>{report.data.length} agente{report.data.length !== 1 ? 's' : ''}</span>
                <span>{totalConversas} conversa{totalConversas !== 1 ? 's' : ''}</span>
                <span>Qualidade média: {avgQuality.toFixed(1)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onView(report)}>
                Ver
              </Button>
              <button
                onClick={() => onArchive(report.id)}
                title={report.archived ? 'Desarquivar' : 'Arquivar'}
                className="p-2 rounded-button text-muted hover:text-foreground hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                <Archive className="h-4 w-4" />
              </button>
              <button
                onClick={() => onDelete(report.id)}
                title="Excluir"
                className="p-2 rounded-button text-muted hover:text-danger hover:bg-surface-secondary transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
