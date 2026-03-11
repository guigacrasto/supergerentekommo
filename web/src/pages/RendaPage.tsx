import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Users, TrendingUp, Calendar, CalendarRange } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

interface IncomeRow {
  faixa: string;
  volume: number;
  fechamentos: number;
  conversao: string;
  ticketMedio: number;
}

interface IncomeData {
  faixas: IncomeRow[];
  totalVolume: number;
  totalFechamentos: number;
  pctConversao: string;
  ticketMedioGeral: number;
  funis: string[];
  grupos: string[];
}

interface PeriodIncome {
  totalVolume: number;
  totalFechamentos: number;
  pctConversao: string;
  ticketMedioGeral: number;
}

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getMondayOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

function getFirstOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export function RendaPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<IncomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getToday);
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');

  const [periodData, setPeriodData] = useState<{
    mes: PeriodIncome | null;
    semana: PeriodIncome | null;
    dia: PeriodIncome | null;
  }>({ mes: null, semana: null, dia: null });
  const [periodLoading, setPeriodLoading] = useState(true);

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (fromDate: string, toDate: string, funil: string, team: string, group: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (funil) params.funil = funil;
      if (team) params.team = team;
      if (group) params.group = group;
      const res = await api.get<IncomeData>('/reports/income', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[RendaPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPeriods = useCallback(async (funil: string, team: string, group: string) => {
    try {
      setPeriodLoading(true);
      const today = getToday();
      const commonParams: Record<string, string> = {};
      if (funil) commonParams.funil = funil;
      if (team) commonParams.team = team;
      if (group) commonParams.group = group;

      const [mesRes, semanaRes, diaRes] = await Promise.all([
        api.get<IncomeData>('/reports/income', { params: { ...commonParams, from: getFirstOfMonth(), to: today } }),
        api.get<IncomeData>('/reports/income', { params: { ...commonParams, from: getMondayOfWeek(), to: today } }),
        api.get<IncomeData>('/reports/income', { params: { ...commonParams, from: today, to: today } }),
      ]);

      setPeriodData({
        mes: { totalVolume: mesRes.data.totalVolume, totalFechamentos: mesRes.data.totalFechamentos, pctConversao: mesRes.data.pctConversao, ticketMedioGeral: mesRes.data.ticketMedioGeral },
        semana: { totalVolume: semanaRes.data.totalVolume, totalFechamentos: semanaRes.data.totalFechamentos, pctConversao: semanaRes.data.pctConversao, ticketMedioGeral: semanaRes.data.ticketMedioGeral },
        dia: { totalVolume: diaRes.data.totalVolume, totalFechamentos: diaRes.data.totalFechamentos, pctConversao: diaRes.data.pctConversao, ticketMedioGeral: diaRes.data.ticketMedioGeral },
      });
    } catch (err) {
      console.error('[RendaPage] Erro ao carregar períodos:', err);
    } finally {
      setPeriodLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(from, to, selectedFunil, teamFilter, groupFilter);
  }, [from, to, selectedFunil, teamFilter, groupFilter, fetchData]);

  useEffect(() => {
    fetchPeriods(selectedFunil, teamFilter, groupFilter);
  }, [selectedFunil, teamFilter, groupFilter, fetchPeriods]);

  const faixas = data?.faixas ?? [];
  const funis = data?.funis ?? [];
  const grupos = data?.grupos ?? [];

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-foreground focus:outline-none focus:border-primary transition-colors"
          />
          <span className="text-muted text-body-sm">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />
        <GroupFilter grupos={grupos} selected={groupFilter} onChange={setGroupFilter} />
        <FunilFilter funis={funis} />
        <TagFilter />
      </div>

      {/* KPI Cards — 4 rows of 2 */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KPICard
          label="Volume Total"
          value={data?.totalVolume}
          icon={Users}
          accent="danger"
          loading={loading}
        />
        <KPICard
          label="Fechamentos Total"
          value={data?.totalFechamentos}
          icon={TrendingUp}
          accent="danger"
          loading={loading}
        />
        <KPICard
          label="Volume Mês"
          value={periodData.mes?.totalVolume}
          icon={Calendar}
          accent="warning"
          loading={periodLoading}
        />
        <KPICard
          label="Fechamentos Mês"
          value={periodData.mes?.totalFechamentos}
          icon={TrendingUp}
          accent="warning"
          loading={periodLoading}
        />
        <KPICard
          label="Volume Semana"
          value={periodData.semana?.totalVolume}
          icon={CalendarRange}
          accent="info"
          loading={periodLoading}
        />
        <KPICard
          label="Fechamentos Semana"
          value={periodData.semana?.totalFechamentos}
          icon={TrendingUp}
          accent="info"
          loading={periodLoading}
        />
        <KPICard
          label="Volume Dia"
          value={periodData.dia?.totalVolume}
          icon={CalendarDays}
          accent="primary"
          loading={periodLoading}
        />
        <KPICard
          label="Fechamentos Dia"
          value={periodData.dia?.totalFechamentos}
          icon={TrendingUp}
          accent="primary"
          loading={periodLoading}
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-max min-w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-3 py-2.5 text-left font-medium">Faixa</th>
              <th className="px-3 py-2.5 text-right font-medium">Volume</th>
              <th className="px-3 py-2.5 text-right font-medium">Fechamentos</th>
              <th className="px-3 py-2.5 text-right font-medium">Conversão %</th>
              <th className="px-3 py-2.5 text-right font-medium">Ticket Médio</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-3 py-2.5">
                    <Skeleton className="h-5 w-32" />
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right">
                    <Skeleton className="ml-auto h-5 w-12" />
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right">
                    <Skeleton className="ml-auto h-5 w-12" />
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right">
                    <Skeleton className="ml-auto h-5 w-16" />
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right">
                    <Skeleton className="ml-auto h-5 w-20" />
                  </td>
                </tr>
              ))
            ) : faixas.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-t border-glass-border px-3 py-8 text-center text-muted text-body-md">
                  Nenhum dado encontrado no período selecionado.
                </td>
              </tr>
            ) : (
              faixas.map((faixa) => (
                <tr key={faixa.faixa} className="hover:bg-surface-secondary/50 transition-colors">
                  <td className="border-t border-glass-border px-3 py-2.5 text-body-md text-foreground font-medium">
                    {faixa.faixa}
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right text-body-md text-foreground">
                    {faixa.volume}
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right text-body-md text-foreground">
                    {faixa.fechamentos}
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right text-body-md text-foreground">
                    {faixa.conversao}
                  </td>
                  <td className="border-t border-glass-border px-3 py-2.5 text-right text-body-md text-foreground">
                    R$ {faixa.ticketMedio.toLocaleString('pt-BR')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
