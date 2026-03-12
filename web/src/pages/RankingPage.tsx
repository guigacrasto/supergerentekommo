import { useEffect, useState, useCallback } from 'react';
import {
  Trophy,
  Users,
  Medal,
  ChevronDown,
  X,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Skeleton, LiveTimestamp, EmptyState } from '@/components/ui';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

/* ---------- Types ---------- */

interface RankingTime {
  nome: string;
  bts: number;
  faturamento: number;
  ticketMedio: number;
  leads: number;
  conversao: number;
}

interface RankingAgente {
  nome: string;
  grupo: string;
  bts: number;
  faturamento: number;
  ticketMedio: number;
}

interface RankingAgenteTime {
  nome: string;
  bts: number;
  faturamento: number;
  ticketMedio: number;
}

interface RankingData {
  rankingTimes: RankingTime[];
  rankingAgentes: RankingAgente[];
  rankingPorTime: Record<string, RankingAgenteTime[]>;
  grupos: string[];
}

/* ---------- Constants ---------- */

const PIE_COLORS = [
  '#9566F2', '#1F74EC', '#F9AA3C', '#10B981', '#EF4444',
  '#8B5CF6', '#3B82F6', '#F59E0B', '#06B6D4', '#EC4899',
  '#14B8A6', '#A855F7', '#F97316', '#22D3EE', '#E879F9',
];

const MEDAL_COLORS: Record<number, string> = {
  0: '#F9AA3C', // ouro
  1: '#959CA6', // prata
  2: '#BE6E00', // bronze
};

type Tab = 'times' | 'agentes' | 'porTime';

/* ---------- Helpers ---------- */

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });
}

/* ---------- Team Selector ---------- */

function TeamSelector({ teams, selected, onChange }: { teams: string[]; selected: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  if (teams.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 px-4 py-2.5 rounded-button border text-body-md font-medium transition-colors cursor-pointer',
          selected
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-glass-border bg-surface-secondary text-muted hover:text-foreground'
        )}
      >
        <Users className="h-4 w-4" />
        <span>{selected || 'Selecionar Time'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-h-[280px] overflow-y-auto rounded-card border border-glass-border bg-surface shadow-lg">
          {teams.map((team) => (
            <button
              key={team}
              onClick={() => { onChange(team); setOpen(false); }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-body-sm transition-colors cursor-pointer',
                selected === team
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-surface-secondary'
              )}
            >
              {team}
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

/* ---------- KPI Card ---------- */

function KpiCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-card border border-glass-border bg-surface p-4">
      <p className="text-body-sm text-muted">{label}</p>
      <p className="font-heading text-heading-md mt-1">{value}</p>
      {sub && <p className="text-body-sm text-muted mt-0.5">{sub}</p>}
    </div>
  );
}

/* ---------- Pie Chart Component ---------- */

function RankingPieChart({ data, dataKey, nameKey, title }: { data: Array<Record<string, unknown>>; dataKey: string; nameKey: string; title: string }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-card border border-glass-border bg-surface p-5">
      <h4 className="font-heading text-body-md font-semibold mb-4">{title}</h4>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey={dataKey}
            nameKey={nameKey}
            cx="50%"
            cy="50%"
            outerRadius={100}
            label={({ name, percent }: any) =>
              `${name ?? ''} (${((percent ?? 0) * 100).toFixed(0)}%)`
            }
            labelLine={false}
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number | undefined, name: string | undefined) => {
              const v = value ?? 0;
              const n = name ?? '';
              if (dataKey === 'faturamento') return [formatCurrency(v), n];
              return [v, n];
            }}
            contentStyle={{ backgroundColor: '#1A1A2E', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', color: '#E0E3E9' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Position Badge ---------- */

function PositionBadge({ position }: { position: number }) {
  const medalColor = MEDAL_COLORS[position];
  if (medalColor) {
    return (
      <span className="inline-flex items-center justify-center">
        <Medal className="h-5 w-5" style={{ color: medalColor }} />
      </span>
    );
  }
  return <span className="text-body-md text-muted font-medium">{position + 1}</span>;
}

/* ---------- Skeleton Table ---------- */

function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="border-t border-glass-border px-4 py-3">
              <Skeleton className="h-5 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/* ---------- Tab: Ranking de Times ---------- */

function TabTimes({ data, loading }: { data: RankingData | null; loading: boolean }) {
  type SortKey = 'nome' | 'bts' | 'faturamento' | 'ticketMedio' | 'leads' | 'conversao';
  const [sortKey, setSortKey] = useState<SortKey>('bts');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'nome'); }
  };

  const SortHeader = ({ label, field, align = 'right' }: { label: string; field: SortKey; align?: string }) => (
    <th
      className={`px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const rows = data?.rankingTimes ?? [];
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'nome') cmp = a.nome.localeCompare(b.nome, 'pt-BR');
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? cmp : -cmp;
  });

  // Pie chart data (filter out zero BTs for cleaner chart)
  const pieDataBts = rows.filter((r) => r.bts > 0).map((r) => ({ nome: r.nome, bts: r.bts }));
  const pieDataFat = rows.filter((r) => r.faturamento > 0).map((r) => ({ nome: r.nome, faturamento: r.faturamento }));

  return (
    <>
      {/* Pie charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingPieChart data={pieDataBts} dataKey="bts" nameKey="nome" title="Distribuição de BTs por Time" />
        <RankingPieChart data={pieDataFat} dataKey="faturamento" nameKey="nome" title="Distribuição de Faturamento por Time" />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-center font-medium w-12">#</th>
              <SortHeader label="Time" field="nome" align="left" />
              <SortHeader label="BTs" field="bts" />
              <SortHeader label="Faturamento" field="faturamento" />
              <SortHeader label="Ticket Médio" field="ticketMedio" />
              <SortHeader label="Leads" field="leads" />
              <SortHeader label="Conversão %" field="conversao" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={7} />
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="border-t border-glass-border px-4 py-8 text-center text-muted">
                  Nenhum dado encontrado.
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const originalIdx = rows.findIndex((r) => r.nome === row.nome);
                return (
                  <tr key={row.nome} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="border-t border-glass-border px-4 py-3 text-center">
                      <PositionBadge position={originalIdx} />
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-body-md font-medium text-foreground">
                      {row.nome}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md font-medium text-foreground">
                      {row.bts}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                      {formatCurrency(row.faturamento)}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                      {formatCurrency(row.ticketMedio)}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                      {row.leads}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                      {row.conversao}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Tab: Ranking de Agentes ---------- */

function TabAgentes({ data, loading }: { data: RankingData | null; loading: boolean }) {
  type SortKey = 'nome' | 'grupo' | 'bts' | 'faturamento' | 'ticketMedio';
  const [sortKey, setSortKey] = useState<SortKey>('bts');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'nome' || key === 'grupo'); }
  };

  const SortHeader = ({ label, field, align = 'right' }: { label: string; field: SortKey; align?: string }) => (
    <th
      className={`px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const rows = data?.rankingAgentes ?? [];
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'nome' || sortKey === 'grupo') cmp = a[sortKey].localeCompare(b[sortKey], 'pt-BR');
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? cmp : -cmp;
  });

  // Top 10 for pie charts + others
  const top10Bts = rows.filter((r) => r.bts > 0).slice(0, 10);
  const othersBts = rows.filter((r) => r.bts > 0).slice(10).reduce((sum, r) => sum + r.bts, 0);
  const pieBts = [...top10Bts.map((r) => ({ nome: r.nome, bts: r.bts }))];
  if (othersBts > 0) pieBts.push({ nome: 'Outros', bts: othersBts });

  const top10Fat = [...rows].sort((a, b) => b.faturamento - a.faturamento).filter((r) => r.faturamento > 0).slice(0, 10);
  const othersFat = [...rows].sort((a, b) => b.faturamento - a.faturamento).filter((r) => r.faturamento > 0).slice(10).reduce((sum, r) => sum + r.faturamento, 0);
  const pieFat = [...top10Fat.map((r) => ({ nome: r.nome, faturamento: r.faturamento }))];
  if (othersFat > 0) pieFat.push({ nome: 'Outros', faturamento: othersFat });

  return (
    <>
      {/* Pie charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankingPieChart data={pieBts} dataKey="bts" nameKey="nome" title="Top 10 Agentes — BTs" />
        <RankingPieChart data={pieFat} dataKey="faturamento" nameKey="nome" title="Top 10 Agentes — Faturamento" />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-center font-medium w-12">#</th>
              <SortHeader label="Agente" field="nome" align="left" />
              <SortHeader label="Grupo" field="grupo" align="left" />
              <SortHeader label="BTs" field="bts" />
              <SortHeader label="Faturamento" field="faturamento" />
              <SortHeader label="Ticket Médio" field="ticketMedio" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={6} />
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="border-t border-glass-border px-4 py-8 text-center text-muted">
                  Nenhum dado encontrado.
                </td>
              </tr>
            ) : (
              sorted.map((row) => {
                const originalIdx = rows.findIndex((r) => r.nome === row.nome);
                return (
                  <tr key={row.nome} className="hover:bg-surface-secondary/50 transition-colors">
                    <td className="border-t border-glass-border px-4 py-3 text-center">
                      <PositionBadge position={originalIdx} />
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-body-md font-medium text-foreground">
                      {row.nome}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-body-md text-muted">
                      {row.grupo}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md font-medium text-foreground">
                      {row.bts}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                      {formatCurrency(row.faturamento)}
                    </td>
                    <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                      {formatCurrency(row.ticketMedio)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------- Tab: Ranking por Time ---------- */

function TabPorTime({ data, loading }: { data: RankingData | null; loading: boolean }) {
  const grupos = Object.keys(data?.rankingPorTime ?? {}).sort();
  const [selectedGrupo, setSelectedGrupo] = useState('');

  // Auto-select first group
  useEffect(() => {
    if (grupos.length > 0 && !selectedGrupo) {
      setSelectedGrupo(grupos[0]);
    }
  }, [grupos, selectedGrupo]);

  type SortKey = 'nome' | 'bts' | 'faturamento' | 'ticketMedio';
  const [sortKey, setSortKey] = useState<SortKey>('bts');
  const [sortAsc, setSortAsc] = useState(false);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'nome'); }
  };

  const SortHeader = ({ label, field, align = 'right' }: { label: string; field: SortKey; align?: string }) => (
    <th
      className={`px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  const rows = selectedGrupo ? (data?.rankingPorTime[selectedGrupo] ?? []) : [];
  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'nome') cmp = a.nome.localeCompare(b.nome, 'pt-BR');
    else cmp = (a[sortKey] as number) - (b[sortKey] as number);
    return sortAsc ? cmp : -cmp;
  });

  // KPIs
  const totalBts = rows.reduce((s, r) => s + r.bts, 0);
  const totalFat = rows.reduce((s, r) => s + r.faturamento, 0);
  const avgTicket = totalBts > 0 ? Math.round(totalFat / totalBts) : 0;
  const agentCount = rows.length;
  const avgBtsPerAgent = agentCount > 0 ? (totalBts / agentCount).toFixed(1) : '0';

  // Pie chart
  const pieBts = rows.filter((r) => r.bts > 0).map((r) => ({ nome: r.nome, bts: r.bts }));

  return (
    <>
      {/* Team selector */}
      <TeamSelector teams={grupos} selected={selectedGrupo} onChange={setSelectedGrupo} />

      {selectedGrupo && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Total BTs" value={String(totalBts)} />
            <KpiCard label="Faturamento Total" value={formatCurrency(totalFat)} />
            <KpiCard label="Ticket Médio" value={formatCurrency(avgTicket)} />
            <KpiCard label="Média BTs/Agente" value={avgBtsPerAgent} sub={`${agentCount} agentes`} />
          </div>

          {/* Pie chart */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RankingPieChart data={pieBts} dataKey="bts" nameKey="nome" title={`Distribuição de BTs — ${selectedGrupo}`} />
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-secondary text-muted text-body-sm">
                  <th className="px-4 py-3 text-center font-medium w-12">#</th>
                  <SortHeader label="Agente" field="nome" align="left" />
                  <SortHeader label="BTs" field="bts" />
                  <SortHeader label="Faturamento" field="faturamento" />
                  <SortHeader label="Ticket Médio" field="ticketMedio" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton cols={5} />
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="border-t border-glass-border px-4 py-8 text-center text-muted">
                      Nenhum agente neste time.
                    </td>
                  </tr>
                ) : (
                  sorted.map((row) => {
                    const originalIdx = rows.findIndex((r) => r.nome === row.nome);
                    return (
                      <tr key={row.nome} className="hover:bg-surface-secondary/50 transition-colors">
                        <td className="border-t border-glass-border px-4 py-3 text-center">
                          <PositionBadge position={originalIdx} />
                        </td>
                        <td className="border-t border-glass-border px-4 py-3 text-body-md font-medium text-foreground">
                          {row.nome}
                        </td>
                        <td className="border-t border-glass-border px-4 py-3 text-right text-body-md font-medium text-foreground">
                          {row.bts}
                        </td>
                        <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                          {formatCurrency(row.faturamento)}
                        </td>
                        <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                          {formatCurrency(row.ticketMedio)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- Main Page ---------- */

export function RankingPage() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getToday);
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('times');

  const userTeams = user?.teams ?? [];
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const hasAccess = isAdmin || user?.can_view_ranking;

  const fetchData = useCallback(async (fromDate: string, toDate: string, team: string, group: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (team) params.team = team;
      if (group) params.group = group;
      const res = await api.get<RankingData>('/reports/ranking', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[RankingPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasAccess) {
      fetchData(from, to, teamFilter, groupFilter);
    }
  }, [from, to, teamFilter, groupFilter, hasAccess, fetchData]);

  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <EmptyState
          icon={Trophy}
          title="Acesso restrito"
          description="Você não tem permissão para visualizar o ranking. Solicite acesso ao administrador."
        />
      </div>
    );
  }

  const grupos = data?.grupos ?? [];

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'times', label: 'Times' },
    { key: 'agentes', label: 'Agentes' },
    { key: 'porTime', label: 'Por Time' },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-heading-md flex items-center gap-2">
            <Trophy className="h-6 w-6 text-warning" />
            Ranking
          </h1>
          <p className="mt-1 text-body-md text-muted">
            Ranking de times e agentes por vendas e faturamento
          </p>
        </div>
        <LiveTimestamp timestamp={lastFetchTime} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />

        <GroupFilter grupos={grupos} selected={groupFilter} onChange={setGroupFilter} />

        {/* Date pickers */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-sm text-foreground"
          />
          <span className="text-muted text-body-sm">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-sm text-foreground"
          />
        </div>

        {/* Clear filters */}
        {(teamFilter || groupFilter) && (
          <button
            onClick={() => { setTeamFilter(''); setGroupFilter(''); }}
            className="flex items-center gap-1 px-2 py-1.5 rounded-button text-body-sm text-danger hover:bg-danger/10 transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-card border border-glass-border bg-surface-secondary p-1">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'flex-1 rounded-button px-4 py-2 text-body-md font-medium transition-colors cursor-pointer',
              activeTab === key
                ? 'bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(149,102,242,0.15)]'
                : 'text-muted hover:text-foreground hover:bg-white/[0.04]'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'times' && <TabTimes data={data} loading={loading} />}
      {activeTab === 'agentes' && <TabAgentes data={data} loading={loading} />}
      {activeTab === 'porTime' && <TabPorTime data={data} loading={loading} />}
    </div>
  );
}
