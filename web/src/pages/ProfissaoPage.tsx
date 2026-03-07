import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp } from '@/components/ui';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';
import { cn } from '@/lib/utils';

interface ProfessionRow {
  profissao: string;
  volume: number;
  fechamentos: number;
  conversao: string;
  ticketMedio: number;
}

interface ProfessionData {
  profissoes: ProfessionRow[];
  funis: string[];
  grupos: string[];
}

type SortKey = 'profissao' | 'volume' | 'fechamentos' | 'conversao' | 'ticketMedio';
type SortDir = 'asc' | 'desc';

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'profissao', label: 'Profissão', align: 'left' },
  { key: 'volume', label: 'Volume', align: 'right' },
  { key: 'fechamentos', label: 'Fechamentos', align: 'right' },
  { key: 'conversao', label: 'Conversão %', align: 'right' },
  { key: 'ticketMedio', label: 'Ticket Médio', align: 'right' },
];

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
  return sortDir === 'asc' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
}

export function ProfissaoPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<ProfessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getToday);
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const userTeams = user?.teams ?? [];

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const fetchData = useCallback(async (fromDate: string, toDate: string, funil: string, team: string, group: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (funil) params.funil = funil;
      if (team) params.team = team;
      if (group) params.group = group;
      const res = await api.get<ProfessionData>('/reports/profession', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[ProfissaoPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(from, to, selectedFunil, teamFilter, groupFilter);
  }, [from, to, selectedFunil, teamFilter, groupFilter, fetchData]);

  const profissoes = data?.profissoes ?? [];
  const funis = data?.funis ?? [];
  const grupos = data?.grupos ?? [];

  const sortedProfissoes = [...profissoes].sort((a, b) => {
    if (!sortKey) return 0;
    let aVal: number | string;
    let bVal: number | string;
    if (sortKey === 'profissao') {
      aVal = a.profissao.toLowerCase();
      bVal = b.profissao.toLowerCase();
    } else if (sortKey === 'conversao') {
      aVal = parseFloat(a.conversao) || 0;
      bVal = parseFloat(b.conversao) || 0;
    } else {
      aVal = a[sortKey];
      bVal = b[sortKey];
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

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
          <span className="text-muted text-body-sm">at&eacute;</span>
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

      {/* Table with Sort */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className={cn(
                    'px-4 py-3 font-medium cursor-pointer select-none transition-colors hover:text-foreground',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    sortKey === col.key && 'text-primary'
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {col.label}
                    <SortIcon column={col.key} sortKey={sortKey} sortDir={sortDir} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-36" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-5 w-12" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-5 w-12" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-5 w-16" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-5 w-20" />
                  </td>
                </tr>
              ))
            ) : sortedProfissoes.length === 0 ? (
              <tr>
                <td colSpan={5} className="border-t border-glass-border px-4 py-8 text-center text-muted text-body-md">
                  Nenhum dado encontrado no per&iacute;odo selecionado.
                </td>
              </tr>
            ) : (
              sortedProfissoes.map((row) => (
                <tr key={row.profissao} className="hover:bg-surface-secondary/50 transition-colors">
                  <td className="border-t border-glass-border px-4 py-3 text-body-md text-foreground font-medium">
                    {row.profissao}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {row.volume}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {row.fechamentos}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {row.conversao}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    R$ {row.ticketMedio.toLocaleString('pt-BR')}
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
