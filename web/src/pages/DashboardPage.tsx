import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Users, Target, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { stripFunilPrefix, buildTagParams } from '@/lib/utils';
import { TEAM_LABELS } from '@/lib/constants';
import { useFilterStore } from '@/stores/filterStore';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardHeader, CardTitle, Chip, Skeleton, LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TeamBarChart } from '@/components/features/dashboard/TeamBarChart';
import { SalesRanking } from '@/components/features/dashboard/SalesRanking';
import { RecentAlerts } from '@/components/features/dashboard/RecentAlerts';
import { TagFilter } from '@/components/features/filters/TagFilter';

interface SummaryItem {
  nome: string;
  team: string;
  novosHoje: number;
  novosMes: number;
  ativos: number;
}

interface ActivityTeam {
  team: string;
  label: string;
  activity: {
    leadsAbandonados48h: Array<{
      id: number;
      nome: string;
      vendedor: string;
      diasSemAtividade: number;
      kommoUrl: string;
    }>;
    leadsEmRisco7d: Array<{
      id: number;
      nome: string;
      vendedor: string;
      diasSemAtividade: number;
      kommoUrl: string;
    }>;
    tarefasVencidas: Array<{
      id: number;
      texto: string;
      vendedor: string;
      leadId: number;
      leadNome: string;
      diasVencida: number;
      kommoUrl: string;
    }>;
  };
}

interface DashboardAgent {
  nome: string;
  total: number;
  ganhos: number;
  ganhosHoje: number;
  ganhosSemana: number;
  ativos: number;
}

interface DashboardData {
  agentsByTeam: Record<string, DashboardAgent[]>;
}

const TEAM_COLORS: Record<string, string> = {
  azul: '#1F74EC',
  amarela: '#F9AA3C',
};

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

type TeamFilter = '' | 'azul' | 'amarela';

export function DashboardPage() {
  const navigate = useNavigate();
  const setAgentFilter = useFilterStore((s) => s.setAgentFilter);
  const selectedTags = useFilterStore((s) => s.selectedTags);
  const tagMode = useFilterStore((s) => s.tagMode);
  const user = useAuthStore((s) => s.user);
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [activity, setActivity] = useState<ActivityTeam[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('');
  const [lastFetchTime, setLastFetchTime] = useState<string>('');

  const userTeams = user?.teams ?? [];
  const hasMultipleTeams = userTeams.length > 1;

  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const tagQuery = buildTagParams(selectedTags, tagMode);
      const [summaryRes, activityRes, dashboardRes] = await Promise.all([
        api.get<SummaryItem[]>(`/reports/summary${tagQuery}`),
        api.get<ActivityTeam[]>(`/reports/activity${tagQuery}`),
        api.get<DashboardData>(`/reports/dashboard${tagQuery}`),
      ]);
      setSummary(summaryRes.data);
      setActivity(activityRes.data);
      setDashboard(dashboardRes.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[DashboardPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedTags, tagMode]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Apply team filter to data sources
  const filteredSummary = teamFilter
    ? summary.filter((s) => s.team === teamFilter)
    : summary;
  const filteredActivity = teamFilter
    ? activity.filter((t) => t.team === teamFilter)
    : activity;

  // KPI calculations (filtered)
  const totalNovosHoje = filteredSummary.reduce((sum, s) => sum + s.novosHoje, 0);
  const totalAtivos = filteredSummary.reduce((sum, s) => sum + s.ativos, 0);
  const totalNovosMes = filteredSummary.reduce((sum, s) => sum + s.novosMes, 0);
  const totalAlertas = filteredActivity.reduce(
    (sum, t) =>
      sum +
      t.activity.leadsAbandonados48h.length +
      t.activity.leadsEmRisco7d.length +
      t.activity.tarefasVencidas.length,
    0
  );

  // Group summary by team
  const teams = ['azul', 'amarela'] as const;
  const visibleTeams = teamFilter ? [teamFilter] as const : teams;

  const teamSummaries = visibleTeams
    .map((team) => ({
      team,
      label: TEAM_LABELS[team] || team,
      pipelines: filteredSummary.filter((s) => s.team === team),
    }))
    .filter((ts) => ts.pipelines.length > 0);

  // Flatten alerts for RecentAlerts (filtered)
  const allAlerts48h = filteredActivity.flatMap((t) => t.activity.leadsAbandonados48h);
  const allAlerts7d = filteredActivity.flatMap((t) => t.activity.leadsEmRisco7d);
  const allTarefas = filteredActivity.flatMap((t) => t.activity.tarefasVencidas);

  // Dashboard data per team (filtered)
  const agentsByTeam = dashboard?.agentsByTeam ?? {};
  const filteredAgentTeams = teamFilter
    ? Object.keys(agentsByTeam).filter((t) => t === teamFilter)
    : Object.keys(agentsByTeam);

  // Rankings: agregar vendas (filtrado por equipe)
  const allAgentsMap: Record<string, { nome: string; ganhosHoje: number; ganhosSemana: number }> = {};
  for (const team of filteredAgentTeams) {
    for (const a of agentsByTeam[team] ?? []) {
      if (!allAgentsMap[a.nome]) {
        allAgentsMap[a.nome] = { nome: a.nome, ganhosHoje: 0, ganhosSemana: 0 };
      }
      allAgentsMap[a.nome].ganhosHoje += a.ganhosHoje;
      allAgentsMap[a.nome].ganhosSemana += a.ganhosSemana;
    }
  }

  const rankingHoje = Object.values(allAgentsMap).map((a) => ({
    nome: a.nome,
    vendas: a.ganhosHoje,
  }));

  const rankingSemana = Object.values(allAgentsMap).map((a) => ({
    nome: a.nome,
    vendas: a.ganhosSemana,
  }));

  return (
    <div className="flex flex-col gap-6">
      {/* Live timestamp indicator */}
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Team filter tabs + Tag filter */}
      <div className="flex flex-wrap items-center gap-4">
        {hasMultipleTeams && (
          <div className="flex items-center gap-2">
            <Chip active={teamFilter === ''} onClick={() => setTeamFilter('')}>
              Todas as Equipes
            </Chip>
            {userTeams.includes('azul') && (
              <Chip active={teamFilter === 'azul'} onClick={() => setTeamFilter('azul')}>
                Equipe Azul
              </Chip>
            )}
            {userTeams.includes('amarela') && (
              <Chip active={teamFilter === 'amarela'} onClick={() => setTeamFilter('amarela')}>
                Equipe Amarela
              </Chip>
            )}
          </div>
        )}

        <TagFilter />
      </div>

      {/* KPI Cards — show skeleton during loading */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Leads Novos Hoje"
          value={totalNovosHoje}
          icon={TrendingUp}
          accent="primary"
          loading={loading}
        />
        <KPICard
          label="Leads Ativos"
          value={totalAtivos}
          icon={Users}
          accent="info"
          loading={loading}
        />
        <KPICard
          label="Novos no Mes"
          value={totalNovosMes}
          icon={Target}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Alertas Ativos"
          value={totalAlertas}
          icon={AlertTriangle}
          accent={totalAlertas > 0 ? 'danger' : 'success'}
          loading={loading}
        />
      </div>

      {/* Team Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-5 w-28" />
              </CardHeader>
              <div className="flex flex-col gap-3 p-5">
                {[1, 2, 3].map((j) => (
                  <Skeleton key={j} className="h-16 w-full rounded-button" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : teamSummaries.length > 0 ? (
        <div className={teamSummaries.length > 1 ? 'grid grid-cols-1 gap-6 sm:grid-cols-2' : ''}>
          {teamSummaries.map(({ team, label, pipelines: pipes }) => (
            <Card key={team}>
              <CardHeader>
                <CardTitle
                  className={
                    team === 'azul' ? 'text-accent-blue' : 'text-warning'
                  }
                >
                  {label}
                </CardTitle>
              </CardHeader>
              <div className="flex flex-col gap-3 p-5">
                {pipes.map((p) => (
                  <button
                    key={`${p.team}-${p.nome}`}
                    type="button"
                    onClick={() => {
                      setAgentFilter('filterFunil', stripFunilPrefix(p.nome));
                      navigate('/agents');
                    }}
                    className="flex w-full items-center justify-between rounded-button border border-glass-border bg-surface-secondary p-4 cursor-pointer transition-colors hover:bg-surface-secondary/80 hover:border-primary/40"
                  >
                    <span className="font-heading text-heading-sm">
                      {stripFunilPrefix(p.nome)}
                    </span>
                    <div className="flex items-center gap-6">
                      <div className="flex flex-col items-center">
                        <span className="font-heading text-heading-sm text-primary">
                          {p.novosHoje}
                        </span>
                        <span className="text-body-sm text-muted">hoje</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="font-heading text-heading-sm">
                          {p.novosMes}
                        </span>
                        <span className="text-body-sm text-muted">mes</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="font-heading text-heading-sm">
                          {p.ativos}
                        </span>
                        <span className="text-body-sm text-muted">ativos</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Bar Charts */}
      {loading ? (
        <Card className="p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-48 w-full" />
        </Card>
      ) : filteredAgentTeams.length > 0 ? (
        <div className="flex flex-col gap-6">
          {filteredAgentTeams.map((team) => (
            <TeamBarChart
              key={team}
              team={team}
              label={TEAM_LABELS[team] || team}
              agents={agentsByTeam[team]}
              color={TEAM_COLORS[team] || '#9566F2'}
            />
          ))}
        </div>
      ) : null}

      {/* Top Vendas */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-5 w-40 mb-4" />
              {[1, 2, 3].map((j) => (
                <Skeleton key={j} className="h-8 w-full mb-2" />
              ))}
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SalesRanking title="Top Vendas — Hoje" data={rankingHoje} />
          <SalesRanking title="Top Vendas — Semana" data={rankingSemana} />
        </div>
      )}

      {/* Alertas Recentes */}
      {!loading && (
        <RecentAlerts
          alerts48h={allAlerts48h}
          alerts7d={allAlerts7d}
          tarefas={allTarefas}
        />
      )}
    </div>
  );
}
