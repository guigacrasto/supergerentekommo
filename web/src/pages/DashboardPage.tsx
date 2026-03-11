import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Users, Target, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { stripFunilPrefix, buildTagParams } from '@/lib/utils';
import { TEAM_LABELS } from '@/lib/constants';
import { useFilterStore } from '@/stores/filterStore';
import { useAuthStore } from '@/stores/authStore';
import { useSSE } from '@/hooks/useSSE';
import { Card, CardHeader, CardTitle, Skeleton, LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TeamBarChart } from '@/components/features/dashboard/TeamBarChart';
import { SalesRanking } from '@/components/features/dashboard/SalesRanking';
import { RecentAlerts } from '@/components/features/dashboard/RecentAlerts';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

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

interface VendedorItem {
  nome: string;
  funil: string;
  team: string;
  grupo: string;
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

export function DashboardPage() {
  const navigate = useNavigate();
  const setAgentFilter = useFilterStore((s) => s.setAgentFilter);
  const selectedTags = useFilterStore((s) => s.selectedTags);
  const tagMode = useFilterStore((s) => s.tagMode);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const user = useAuthStore((s) => s.user);
  const { data: sseData, connected: sseConnected } = useSSE();
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [vendedores, setVendedores] = useState<VendedorItem[]>([]);
  const [activity, setActivity] = useState<ActivityTeam[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [gruposByTeam, setGruposByTeam] = useState<Record<string, string[]>>({});
  const [lastFetchTime, setLastFetchTime] = useState<string>('');

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const tagQuery = buildTagParams(selectedTags, tagMode);
      const res = await api.get<{
        summary: SummaryItem[];
        vendedores: VendedorItem[];
        dashboard: DashboardData;
        activity: ActivityTeam[];
        gruposByTeam: Record<string, string[]>;
      }>(`/reports/all${tagQuery}`);
      setSummary(res.data.summary);
      setVendedores(res.data.vendedores ?? []);
      setDashboard(res.data.dashboard);
      setActivity(res.data.activity);
      setGruposByTeam(res.data.gruposByTeam ?? {});
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[DashboardPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedTags, tagMode]);

  // SSE provides real-time data — use when available
  useEffect(() => {
    if (!sseData) return;

    const sseSummary: SummaryItem[] = sseData.teams.flatMap((t) => t.summary || []);
    setSummary(sseSummary);

    const sseVendedores: VendedorItem[] = sseData.teams.flatMap((t) => t.vendedores || []);
    setVendedores(sseVendedores);

    const agentsByTeam: Record<string, DashboardAgent[]> = {};
    for (const t of sseData.teams) {
      agentsByTeam[t.team] = t.agents || [];
    }
    setDashboard({ agentsByTeam });

    const sseGrupos: Record<string, string[]> = {};
    for (const t of sseData.teams) {
      sseGrupos[t.team] = t.grupos || [];
    }
    setGruposByTeam(sseGrupos);

    const activityData: ActivityTeam[] = sseData.teams
      .filter((t) => t.activity)
      .map((t) => ({
        team: t.team,
        label: TEAM_LABELS[t.team] || t.team,
        activity: t.activity!,
      }));
    setActivity(activityData);

    setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    setLoading(false);
  }, [sseData]);

  useEffect(() => {
    fetchData();

    if (!sseConnected) {
      const interval = setInterval(() => fetchData(true), REFRESH_INTERVAL_MS);
      return () => clearInterval(interval);
    }
  }, [fetchData, sseConnected]);

  // Collect available groups (from selected team or all teams)
  const availableGroups: string[] = teamFilter
    ? gruposByTeam[teamFilter] ?? []
    : [...new Set(Object.values(gruposByTeam).flat())].sort();

  // Reset group filter if not in available list
  const effectiveGroup = availableGroups.includes(groupFilter) ? groupFilter : '';

  // Get set of agent names that belong to the selected group
  const groupAgentNames = effectiveGroup
    ? new Set(vendedores.filter((v) => v.grupo === effectiveGroup).map((v) => v.nome))
    : null;

  // Apply team filter to data sources
  const teamFilteredSummary = teamFilter
    ? summary.filter((s) => s.team === teamFilter)
    : summary;
  const filteredActivity = teamFilter
    ? activity.filter((t) => t.team === teamFilter)
    : activity;

  // Extract unique funnel names (from team-filtered summary)
  const availableFunis = [...new Set(teamFilteredSummary.map((s) => stripFunilPrefix(s.nome)))].sort();

  // Reset funnel filter if selected funnel is no longer available
  const effectiveFunil = availableFunis.includes(selectedFunil) ? selectedFunil : '';

  // Apply funnel filter
  const filteredSummary = effectiveFunil
    ? teamFilteredSummary.filter((s) => stripFunilPrefix(s.nome) === effectiveFunil)
    : teamFilteredSummary;

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

  // Dashboard data per team (filtered by team + funnel)
  const agentsByTeam = dashboard?.agentsByTeam ?? {};
  const filteredAgentTeams = teamFilter
    ? Object.keys(agentsByTeam).filter((t) => t === teamFilter)
    : Object.keys(agentsByTeam);

  // When funnel or group is selected, re-aggregate agents from vendedores data
  const funilFilteredAgentsByTeam: Record<string, DashboardAgent[]> = {};
  if (effectiveFunil || effectiveGroup) {
    const filtered = vendedores.filter((v) => {
      const matchTeam = !teamFilter || v.team === teamFilter;
      const matchFunil = !effectiveFunil || stripFunilPrefix(v.funil) === effectiveFunil;
      const matchGroup = !groupAgentNames || groupAgentNames.has(v.nome);
      return matchTeam && matchFunil && matchGroup;
    });
    const byTeamAgent: Record<string, Record<string, DashboardAgent>> = {};
    for (const v of filtered) {
      if (!byTeamAgent[v.team]) byTeamAgent[v.team] = {};
      if (!byTeamAgent[v.team][v.nome]) {
        byTeamAgent[v.team][v.nome] = { nome: v.nome, total: 0, ganhos: 0, ganhosHoje: 0, ganhosSemana: 0, ativos: 0 };
      }
      const a = byTeamAgent[v.team][v.nome];
      a.total += v.total;
      a.ganhos += v.ganhos;
      a.ganhosHoje += v.ganhosHoje;
      a.ganhosSemana += v.ganhosSemana;
      a.ativos += v.ativos;
    }
    for (const [team, agents] of Object.entries(byTeamAgent)) {
      funilFilteredAgentsByTeam[team] = Object.values(agents).sort((a, b) => b.total - a.total);
    }
  }

  const effectiveAgentsByTeam = (effectiveFunil || effectiveGroup) ? funilFilteredAgentsByTeam : agentsByTeam;
  const effectiveAgentTeams = (effectiveFunil || effectiveGroup)
    ? Object.keys(funilFilteredAgentsByTeam)
    : filteredAgentTeams;

  // Rankings: agregar vendas (filtrado por time + funil)
  const allAgentsMap: Record<string, { nome: string; ganhosHoje: number; ganhosSemana: number }> = {};
  for (const team of effectiveAgentTeams) {
    for (const a of effectiveAgentsByTeam[team] ?? []) {
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />
        <GroupFilter grupos={availableGroups} selected={effectiveGroup} onChange={setGroupFilter} />
        <FunilFilter funis={availableFunis} />
        <TagFilter />
      </div>

      {/* KPI Cards */}
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
          label="Novos no Mês"
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
                    className="flex w-full items-center justify-between rounded-card border border-glass-border bg-surface-secondary/50 p-4 cursor-pointer transition-all duration-200 hover:bg-surface-secondary/80 hover:border-white/10 hover:shadow-card-hover"
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
                        <span className="text-body-sm text-muted">mês</span>
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
      ) : effectiveAgentTeams.length > 0 ? (
        <div className="flex flex-col gap-6">
          {effectiveAgentTeams.map((team) => (
            <TeamBarChart
              key={team}
              team={team}
              label={TEAM_LABELS[team] || team}
              agents={effectiveAgentsByTeam[team]}
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
