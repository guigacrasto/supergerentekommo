import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { AgenteFilter } from '@/components/features/filters/AgenteFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

interface LossMotivo {
  loss_reason_id: number;
  nome: string;
  count: number;
  pct: string;
}

interface LossReasonsData {
  motivos: LossMotivo[];
  porAgente: Array<{
    nome: string;
    total: number;
    motivos: Array<{ loss_reason_id: number; nome: string; count: number }>;
  }>;
  totalPerdidos: number;
  funis: string[];
  agentes: string[];
  grupos: string[];
}

const BAR_COLORS = [
  '#9566F2', '#E05D6F', '#4ECDC4', '#FFE66D', '#FF6B6B',
  '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#87CEEB',
  '#FF8C42', '#98D8C8', '#F7DC6F', '#BB8FCE', '#82E0AA',
];

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LossReasonsPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<LossReasonsData | null>(null);
  const [selectedAgente, setSelectedAgente] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getToday);
  const [teamFilter, setTeamFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (fromDate: string, toDate: string, funil: string, agente: string, team: string, group: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (funil) params.funil = funil;
      if (agente) params.agente = agente;
      if (team) params.team = team;
      if (group) params.group = group;
      const res = await api.get<LossReasonsData>('/reports/loss-reasons', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[LossReasonsPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(from, to, selectedFunil, selectedAgente, teamFilter, groupFilter);
  }, [from, to, selectedFunil, selectedAgente, teamFilter, groupFilter, fetchData]);

  const funis = data?.funis ?? [];
  const agentes = data?.agentes ?? [];
  const grupos = data?.grupos ?? [];
  const motivos = data?.motivos ?? [];
  const totalPerdidos = data?.totalPerdidos ?? 0;

  // Ordenar do maior pro menor e preparar dados para o grafico
  const chartData = [...motivos]
    .sort((a, b) => b.count - a.count)
    .map((m) => ({
      nome: m.nome,
      count: m.count,
      pct: totalPerdidos > 0 ? ((m.count / totalPerdidos) * 100).toFixed(1) : '0.0',
    }));

  const chartHeight = Math.max(300, chartData.length * 48 + 40);

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
        <AgenteFilter agentes={agentes} selected={selectedAgente} onChange={setSelectedAgente} />
        <TagFilter />
      </div>

      {/* KPI Card */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="Total Perdidos"
          value={data?.totalPerdidos}
          icon={XCircle}
          accent="danger"
          loading={loading}
        />
      </div>

      {/* Horizontal Bar Chart */}
      <div className="rounded-card border border-glass-border bg-surface p-6">
        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-8 flex-1" />
              </div>
            ))}
          </div>
        ) : motivos.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-muted text-body-md">
            Nenhum dado encontrado no período selecionado.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 80, left: 10, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="nome"
                width={220}
                tick={{ fill: '#E0E3E9', fontSize: 13 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{
                  backgroundColor: '#22182D',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  color: '#fff',
                }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#fff', fontWeight: 600 }}
                formatter={(value: any, _name: any, props: any) => [
                  `${value} leads (${props.payload.pct}%)`,
                  'Volume',
                ]}
              />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                barSize={28}
                label={{
                  position: 'right',
                  fill: '#9CA3AF',
                  fontSize: 13,
                  formatter: (value: any) => {
                    const item = chartData.find((d) => d.count === Number(value));
                    return `${value}  (${item?.pct ?? 0}%)`;
                  },
                }}
              >
                {chartData.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={BAR_COLORS[index % BAR_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
