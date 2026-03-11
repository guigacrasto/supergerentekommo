import { useEffect, useState, useCallback } from 'react';
import { BarChart3, ArrowUpDown, ArrowUp, ArrowDown, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp, EmptyState } from '@/components/ui';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { AgenteFilter } from '@/components/features/filters/AgenteFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';
import { cn } from '@/lib/utils';

const FIXED_COLS = ['Agente', 'Total Leads', 'Venda Ganha', 'Venda Perdida', 'Conversão %'];

type AgentRow = Record<string, string | number | undefined>;

interface AgentsResponse {
  rows: AgentRow[];
  grupos: string[];
}

export function AgentsPage() {
  const [data, setData] = useState<AgentRow[]>([]);
  const [grupos, setGrupos] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetchTime, setLastFetchTime] = useState('');
  const [selectedAgente, setSelectedAgente] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [sortCol, setSortCol] = useState<string>('Venda Ganha');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (team: string, group: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (team) params.team = team;
      if (group) params.group = group;
      const res = await api.get<AgentsResponse>('/reports/agents', { params });
      setData(res.data.rows);
      setGrupos(res.data.grupos);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[AgentsPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(teamFilter, groupFilter);
  }, [teamFilter, groupFilter, fetchData]);

  // Extract funnel columns (everything not in FIXED_COLS)
  const funnelCols: string[] =
    data.length > 0
      ? Object.keys(data[0]).filter((k) => !FIXED_COLS.includes(k))
      : [];

  // Agent names for filter
  const agentOptions: string[] = [
    ...new Set<string>(data.map((r) => String(r.Agente ?? ''))),
  ].filter(Boolean).sort();

  // Client-side filtering (funil + agente)
  const filteredRows = data.filter((row) => {
    if (selectedAgente && row.Agente !== selectedAgente) return false;
    if (selectedFunil && !row[selectedFunil]) return false;
    return true;
  });

  // Client-side sorting
  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  };

  const sortedRows = sortCol && filteredRows.length > 0
    ? [...filteredRows].sort((a, b) => {
        const parse = (v: string | number | undefined) => {
          const s = String(v ?? '').replace(/\s*\(.*?\)/g, '').replace('%', '').trim();
          const n = parseFloat(s);
          return isNaN(n) ? s.toLowerCase() : n;
        };
        const an = parse(a[sortCol]);
        const bn = parse(b[sortCol]);
        if (an < bn) return sortDir === 'asc' ? -1 : 1;
        if (an > bn) return sortDir === 'asc' ? 1 : -1;
        return 0;
      })
    : filteredRows;

  // Only show funnel columns when a funil filter is selected
  const allCols = selectedFunil
    ? [...FIXED_COLS, ...funnelCols.filter((f) => f === selectedFunil)]
    : FIXED_COLS;

  const renderCellContent = (col: string, row: AgentRow) => {
    const value = row[col];
    if (value === undefined || value === null || value === '') return <span className="text-muted">—</span>;

    if (col === 'Agente') {
      return (
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <User className="h-4 w-4 text-primary" />
          </div>
          <span className="font-heading font-semibold text-foreground">{value}</span>
        </div>
      );
    }

    if (col === 'Conversão %') {
      const numVal = parseFloat(String(value).replace('%', ''));
      const color = numVal >= 30 ? 'text-success' : numVal >= 15 ? 'text-warning' : 'text-danger';
      return <span className={cn('font-heading font-bold tabular-nums', color)}>{value}</span>;
    }

    if (col === 'Venda Ganha') {
      return <span className="font-heading font-semibold text-success tabular-nums">{value}</span>;
    }

    if (col === 'Venda Perdida') {
      return <span className="font-heading font-semibold text-danger tabular-nums">{value}</span>;
    }

    if (col === 'Total Leads') {
      return <span className="font-heading font-semibold text-foreground tabular-nums">{value}</span>;
    }

    // Funnel columns
    return <span className="text-foreground tabular-nums">{value}</span>;
  };

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />
        <GroupFilter grupos={grupos} selected={groupFilter} onChange={setGroupFilter} />
        <FunilFilter funis={funnelCols} />
        <AgenteFilter agentes={agentOptions} selected={selectedAgente} onChange={setSelectedAgente} />
        <TagFilter />
      </div>

      {/* Table */}
      {loading ? (
        <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-secondary text-muted text-body-sm">
                {FIXED_COLS.map((col) => (
                  <th key={col} className={cn('px-4 py-3 font-medium', col === 'Agente' ? 'text-left' : 'text-right')}>
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-8 w-8 rounded-full" />
                      <Skeleton className="h-5 w-28" />
                    </div>
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right"><Skeleton className="ml-auto h-5 w-12" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-right"><Skeleton className="ml-auto h-5 w-12" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-right"><Skeleton className="ml-auto h-5 w-12" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-right"><Skeleton className="ml-auto h-5 w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : sortedRows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nenhum dado encontrado"
          description="Ajuste os filtros ou aguarde os dados serem carregados."
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-secondary text-muted text-body-sm">
                {allCols.map((col) => (
                  <th
                    key={col}
                    onClick={() => handleSort(col)}
                    className={cn(
                      'px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors whitespace-nowrap',
                      col === 'Agente' ? 'text-left' : 'text-right',
                      sortCol === col && 'text-primary'
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col}
                      {sortCol === col ? (
                        sortDir === 'desc' ? <ArrowDown className="h-3 w-3 text-primary" /> : <ArrowUp className="h-3 w-3 text-primary" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, i) => (
                <tr
                  key={i}
                  className="hover:bg-surface-secondary/50 transition-colors"
                >
                  {allCols.map((col) => (
                    <td
                      key={col}
                      className={cn(
                        'border-t border-glass-border px-4 py-3 text-body-md',
                        col !== 'Agente' && 'text-right'
                      )}
                    >
                      {renderCellContent(col, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
