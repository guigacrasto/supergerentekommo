import { useEffect, useState } from 'react';
import { TrendingUp, Users, Target, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { stripFunilPrefix } from '@/lib/utils';
import { TEAM_LABELS } from '@/lib/constants';
import { PageSpinner, Card, CardHeader, CardTitle } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TeamPieChart } from '@/components/features/dashboard/TeamPieChart';
import { SalesRanking } from '@/components/features/dashboard/SalesRanking';
import { RecentAlerts } from '@/components/features/dashboard/RecentAlerts';

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

export function DashboardPage() {
  const [summary, setSummary] = useState<SummaryItem[]>([]);
  const [activity, setActivity] = useState<ActivityTeam[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const [summaryRes, activityRes, dashboardRes] = await Promise.all([
          api.get<SummaryItem[]>('/reports/summary'),
          api.get<ActivityTeam[]>('/reports/activity'),
          api.get<DashboardData>('/reports/dashboard'),
        ]);
        if (!cancelled) {
          setSummary(summaryRes.data);
          setActivity(activityRes.data);
          setDashboard(dashboardRes.data);
        }
      } catch (err) {
        console.error('[DashboardPage] Erro ao carregar dados:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <PageSpinner />;
  }

  // KPI calculations
  const totalNovosHoje = summary.reduce((sum, s) => sum + s.novosHoje, 0);
  const totalAtivos = summary.reduce((sum, s) => sum + s.ativos, 0);
  const totalNovosMes = summary.reduce((sum, s) => sum + s.novosMes, 0);
  const totalAlertas = activity.reduce(
    (sum, t) =>
      sum +
      t.activity.leadsAbandonados48h.length +
      t.activity.leadsEmRisco7d.length +
      t.activity.tarefasVencidas.length,
    0
  );

  // Group summary by team
  const teams = ['azul', 'amarela'] as const;
  const teamSummaries = teams
    .map((team) => ({
      team,
      label: TEAM_LABELS[team] || team,
      pipelines: summary.filter((s) => s.team === team),
    }))
    .filter((ts) => ts.pipelines.length > 0);

  // Flatten alerts for RecentAlerts
  const allAlerts48h = activity.flatMap((t) => t.activity.leadsAbandonados48h);
  const allAlerts7d = activity.flatMap((t) => t.activity.leadsEmRisco7d);
  const allTarefas = activity.flatMap((t) => t.activity.tarefasVencidas);

  // Dashboard data per team
  const agentsByTeam = dashboard?.agentsByTeam ?? {};
  const availableTeams = Object.keys(agentsByTeam);
  const hasBothTeams = availableTeams.length >= 2;

  // Rankings: agregar vendas de todas as equipes por agente
  const allAgentsMap: Record<string, { nome: string; ganhosHoje: number; ganhosSemana: number }> = {};
  for (const agents of Object.values(agentsByTeam)) {
    for (const a of agents) {
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
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Leads Novos Hoje"
          value={totalNovosHoje}
          icon={TrendingUp}
          accent="primary"
        />
        <KPICard
          label="Leads Ativos"
          value={totalAtivos}
          icon={Users}
          accent="info"
        />
        <KPICard
          label="Novos no Mes"
          value={totalNovosMes}
          icon={Target}
          accent="success"
        />
        <KPICard
          label="Alertas Ativos"
          value={totalAlertas}
          icon={AlertTriangle}
          accent={totalAlertas > 0 ? 'danger' : 'success'}
        />
      </div>

      {/* Team Summary Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
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
                <div
                  key={`${p.team}-${p.nome}`}
                  className="flex items-center justify-between rounded-button border border-glass-border bg-surface-secondary p-4"
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
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Pie Charts — 2 graficos por equipe (so mostra se tem acesso a 2 equipes) */}
      {hasBothTeams && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {availableTeams.map((team) => (
            <TeamPieChart
              key={team}
              team={team}
              label={TEAM_LABELS[team] || team}
              agents={agentsByTeam[team]}
              color={TEAM_COLORS[team] || '#9566F2'}
            />
          ))}
        </div>
      )}

      {/* Top Vendas — dados reais */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SalesRanking title="Top Vendas — Hoje" data={rankingHoje} />
        <SalesRanking title="Top Vendas — Semana" data={rankingSemana} />
      </div>

      {/* Alertas Recentes */}
      <RecentAlerts
        alerts48h={allAlerts48h}
        alerts7d={allAlerts7d}
        tarefas={allTarefas}
      />
    </div>
  );
}
