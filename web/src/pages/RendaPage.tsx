import { useEffect, useState, useCallback } from 'react';
import { CalendarDays } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp } from '@/components/ui';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';
import { cn } from '@/lib/utils';

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

const ACCENT_COLORS: Record<string, string> = {
  'Até R$ 2.000': 'border-l-success',
  'R$ 2.001 a R$ 5.000': 'border-l-accent-blue',
  'R$ 5.001 a R$ 10.000': 'border-l-primary',
  'R$ 10.001 a R$ 20.000': 'border-l-warning',
  'Acima de R$ 20.000': 'border-l-danger',
  'Não informado': 'border-l-muted',
};

const PIE_COLORS: Record<string, string> = {
  'Até R$ 2.000': '#22C55E',
  'R$ 2.001 a R$ 5.000': '#3B82F6',
  'R$ 5.001 a R$ 10.000': '#9566F2',
  'R$ 10.001 a R$ 20.000': '#F59E0B',
  'Acima de R$ 20.000': '#EF4444',
  'Não informado': '#64748B',
};

interface PieSlice {
  name: string;
  value: number;
}

function buildPieData(rows: IncomeRow[] | null): PieSlice[] {
  if (!rows) return [];
  return rows
    .filter((r) => r.volume > 0)
    .map((r) => ({ name: r.faixa, value: r.volume }));
}

function IncomePieChart({ title, data, loading: isLoading }: { title: string; data: PieSlice[]; loading: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-glass-border bg-surface p-4">
        <span className="text-[10px] uppercase tracking-wider text-muted font-medium">{title}</span>
        <Skeleton className="h-[140px] w-[140px] rounded-full" />
      </div>
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-card border border-glass-border bg-surface p-4">
        <span className="text-[10px] uppercase tracking-wider text-muted font-medium">{title}</span>
        <div className="flex h-[140px] w-[140px] items-center justify-center">
          <span className="text-body-sm text-muted">Sem dados</span>
        </div>
        <span className="text-lg font-heading font-bold text-foreground">0</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1 rounded-card border border-glass-border bg-surface p-4">
      <span className="text-[10px] uppercase tracking-wider text-muted font-medium">{title}</span>
      <div className="h-[140px] w-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={65}
              dataKey="value"
              stroke="none"
              paddingAngle={2}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={PIE_COLORS[entry.name] || '#64748B'} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: '#22182D',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#E0E3E9',
              }}
              formatter={(value: number | undefined, name: string | undefined) => [
                `${value ?? 0} (${((Number(value ?? 0) / total) * 100).toFixed(1)}%)`,
                name ?? '',
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <span className="text-lg font-heading font-bold text-foreground">{total.toLocaleString('pt-BR')}</span>
    </div>
  );
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
    mes: IncomeRow[] | null;
    semana: IncomeRow[] | null;
    dia: IncomeRow[] | null;
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
        mes: mesRes.data.faixas,
        semana: semanaRes.data.faixas,
        dia: diaRes.data.faixas,
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

  // Build lookup maps for period data
  function getFaixaPeriod(periodFaixas: IncomeRow[] | null, faixaName: string): IncomeRow | null {
    if (!periodFaixas) return null;
    return periodFaixas.find((f) => f.faixa === faixaName) || null;
  }

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

      {/* Pie Charts: TOTAL | MÊS | SEMANA | DIA */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <IncomePieChart title="Total" data={buildPieData(faixas)} loading={loading} />
        <IncomePieChart title="Mês" data={buildPieData(periodData.mes)} loading={periodLoading} />
        <IncomePieChart title="Semana" data={buildPieData(periodData.semana)} loading={periodLoading} />
        <IncomePieChart title="Dia" data={buildPieData(periodData.dia)} loading={periodLoading} />
      </div>

      {/* Legenda */}
      {!loading && (
        <div className="flex flex-wrap items-center gap-3">
          {faixas.filter((f) => f.volume > 0).map((f) => (
            <div key={f.faixa} className="flex items-center gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: PIE_COLORS[f.faixa] || '#64748B' }} />
              <span className="text-body-xs text-muted">{f.faixa}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-bracket KPI rows: TOTAL | MÊS | SEMANA | DIA */}
      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-card" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {faixas.map((faixa) => {
            const mes = getFaixaPeriod(periodData.mes, faixa.faixa);
            const semana = getFaixaPeriod(periodData.semana, faixa.faixa);
            const dia = getFaixaPeriod(periodData.dia, faixa.faixa);
            const accent = ACCENT_COLORS[faixa.faixa] || 'border-l-muted';

            return (
              <div
                key={faixa.faixa}
                className={cn(
                  'rounded-card border border-glass-border bg-surface border-l-4 px-4 py-3',
                  accent
                )}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-heading text-body-md font-semibold text-foreground">
                    {faixa.faixa}
                  </span>
                  <span className="text-body-xs text-muted">
                    Conv. {faixa.conversao} · Ticket R$ {faixa.ticketMedio.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-3">
                  {/* TOTAL (date range) */}
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Total</span>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-lg font-heading font-bold text-foreground">{faixa.volume}</span>
                      <span className="text-body-xs text-success font-medium">{faixa.fechamentos} fech.</span>
                    </div>
                  </div>
                  {/* MÊS */}
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Mês</span>
                    <div className="flex items-baseline gap-1.5">
                      {periodLoading ? (
                        <Skeleton className="h-5 w-16" />
                      ) : (
                        <>
                          <span className="text-lg font-heading font-bold text-foreground">{mes?.volume ?? 0}</span>
                          <span className="text-body-xs text-success font-medium">{mes?.fechamentos ?? 0} fech.</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* SEMANA */}
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Semana</span>
                    <div className="flex items-baseline gap-1.5">
                      {periodLoading ? (
                        <Skeleton className="h-5 w-16" />
                      ) : (
                        <>
                          <span className="text-lg font-heading font-bold text-foreground">{semana?.volume ?? 0}</span>
                          <span className="text-body-xs text-success font-medium">{semana?.fechamentos ?? 0} fech.</span>
                        </>
                      )}
                    </div>
                  </div>
                  {/* DIA */}
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted font-medium">Dia</span>
                    <div className="flex items-baseline gap-1.5">
                      {periodLoading ? (
                        <Skeleton className="h-5 w-16" />
                      ) : (
                        <>
                          <span className="text-lg font-heading font-bold text-foreground">{dia?.volume ?? 0}</span>
                          <span className="text-body-xs text-success font-medium">{dia?.fechamentos ?? 0} fech.</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
