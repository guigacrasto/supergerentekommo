import { useEffect, useState, useCallback } from 'react';
import { BarChart3, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
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

  const allCols = [...FIXED_COLS, ...funnelCols];

  return (
    <div className="flex flex-col gap-4">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <TimeFilter teams={userTeams} selected={teamFilter} onChange={(t) => { setTeamFilter(t); setGroupFilter(''); }} />
        <GroupFilter grupos={grupos} selected={groupFilter} onChange={setGroupFilter} />
        <FunilFilter funis={funnelCols} />
        <AgenteFilter agentes={agentOptions} selected={selectedAgente} onChange={setSelectedAgente} />
        <TagFilter />
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-card border border-glass-border bg-surface overflow-hidden">
          <div className="p-3 space-y-2">
            <Skeleton className="h-8 w-full" />
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      ) : sortedRows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nenhum dado encontrado"
          description="Ajuste os filtros ou aguarde os dados serem carregados."
        />
      ) : (
        <div className="rounded-card border border-glass-border bg-surface overflow-hidden">
          <div className="overflow-x-auto max-h-[75vh]">
            <table className="w-max min-w-full border-collapse text-body-sm">
              <thead>
                <tr>
                  {allCols.map((col) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className={cn(
                        'sticky top-0 z-10 cursor-pointer select-none whitespace-nowrap border-b border-glass-border bg-surface-secondary/80 backdrop-blur-sm px-2.5 py-2 text-left font-heading text-body-xs font-semibold text-muted transition-all duration-200 hover:text-[#E0E3E9]',
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
                    className="border-b border-glass-border transition-all duration-200 hover:bg-white/[0.03]"
                  >
                    {allCols.map((col) => {
                      const value = row[col];
                      return (
                        <td
                          key={col}
                          className={cn(
                            'px-2.5 py-1.5 whitespace-nowrap',
                            col === 'Agente' && 'font-heading font-medium',
                            col === 'Conversão %' && 'font-heading font-medium'
                          )}
                        >
                          {value ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
