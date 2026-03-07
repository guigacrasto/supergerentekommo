import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Users, TrendingUp, Target, Percent } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { AgenteFilter } from '@/components/features/filters/AgenteFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

interface DailyMetrics {
  team: string;
  leadsDia: number;
  leadsMes: number;
  vendasDia: number;
  vendasMes: number;
  perdidasDia: number;
  perdidasMes: number;
  conversaoDia: string;
  conversaoMes: string;
}

interface DailyResponse {
  metrics: DailyMetrics[];
  funis: string[];
  agentes: string[];
  grupos: string[];
}

export function DiarioPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<DailyMetrics[]>([]);
  const [funis, setFunis] = useState<string[]>([]);
  const [agentes, setAgentes] = useState<string[]>([]);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [selectedAgente, setSelectedAgente] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [teamFilter, setTeamFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (date: string, funil: string, agente: string, group: string) => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ date });
      if (funil) params.set('funil', funil);
      if (agente) params.set('agente', agente);
      if (group) params.set('group', group);
      const res = await api.get<DailyResponse>(`/reports/daily?${params.toString()}`);
      setData(res.data.metrics);
      setFunis(res.data.funis ?? []);
      setAgentes(res.data.agentes ?? []);
      setGrupos(res.data.grupos ?? []);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[DiarioPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedDate, selectedFunil, selectedAgente, groupFilter);
  }, [selectedDate, selectedFunil, selectedAgente, groupFilter, fetchData]);

  const filtered = teamFilter ? data.filter((d) => d.team === teamFilter) : data;

  const totals = filtered.reduce(
    (acc, d) => ({
      leadsDia: acc.leadsDia + d.leadsDia,
      leadsMes: acc.leadsMes + d.leadsMes,
      vendasDia: acc.vendasDia + d.vendasDia,
      vendasMes: acc.vendasMes + d.vendasMes,
      perdidasDia: acc.perdidasDia + d.perdidasDia,
      perdidasMes: acc.perdidasMes + d.perdidasMes,
    }),
    { leadsDia: 0, leadsMes: 0, vendasDia: 0, vendasMes: 0, perdidasDia: 0, perdidasMes: 0 }
  );

  const conversaoDia = totals.leadsDia > 0
    ? ((totals.vendasDia / totals.leadsDia) * 100).toFixed(1) + '%'
    : '0.0%';
  const conversaoMes = totals.leadsMes > 0
    ? ((totals.vendasMes / totals.leadsMes) * 100).toFixed(1) + '%'
    : '0.0%';

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />
        <GroupFilter grupos={grupos} selected={groupFilter} onChange={setGroupFilter} />
        <FunilFilter funis={funis} />
        <AgenteFilter agentes={agentes} selected={selectedAgente} onChange={setSelectedAgente} />
        <TagFilter />
      </div>

      {/* KPI Cards — Row 1: Dia | Row 2: Mês */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <KPICard
          label="Leads Dia"
          value={totals.leadsDia}
          icon={Users}
          accent="primary"
          loading={loading}
        />
        <KPICard
          label="Vendas Dia"
          value={totals.vendasDia}
          icon={TrendingUp}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Conversão Dia"
          value={conversaoDia}
          icon={Percent}
          accent="warning"
          loading={loading}
        />
        <KPICard
          label="Leads Mês"
          value={totals.leadsMes}
          icon={Users}
          accent="info"
          loading={loading}
        />
        <KPICard
          label="Vendas Mês"
          value={totals.vendasMes}
          icon={Target}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Conversão Mês"
          value={conversaoMes}
          icon={Percent}
          accent="warning"
          loading={loading}
        />
      </div>
    </div>
  );
}
