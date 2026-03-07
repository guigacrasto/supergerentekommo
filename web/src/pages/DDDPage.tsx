import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Phone, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useFilterStore } from '@/stores/filterStore';
import { Skeleton, LiveTimestamp } from '@/components/ui';
import { TagFilter } from '@/components/features/filters/TagFilter';
import { FunilFilter } from '@/components/features/filters/FunilFilter';
import { TimeFilter } from '@/components/features/filters/TimeFilter';
import { GroupFilter } from '@/components/features/filters/GroupFilter';

interface DDDRow {
  ddd: string;
  estado: string;
  volume: number;
  fechamentos: number;
  conversao: string;
  ticketMedio: number;
}

interface DDDData {
  ddds: DDDRow[];
  funis: string[];
  grupos: string[];
  estados: string[];
}

function getDefaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

type SortKey = 'ddd' | 'estado' | 'volume' | 'fechamentos' | 'conversao' | 'ticketMedio';

export function DDDPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<DDDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(getDefaultFrom);
  const [to, setTo] = useState(getToday);
  const [teamFilter, setTeamFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [estadoFilter, setEstadoFilter] = useState('');
  const [lastFetchTime, setLastFetchTime] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortAsc, setSortAsc] = useState(false);

  const userTeams = user?.teams ?? [];

  const fetchData = useCallback(async (fromDate: string, toDate: string, funil: string, team: string, group: string, estado: string) => {
    try {
      setLoading(true);
      const params: Record<string, string> = { from: fromDate, to: toDate };
      if (funil) params.funil = funil;
      if (team) params.team = team;
      if (group) params.group = group;
      if (estado) params.estado = estado;
      const res = await api.get<DDDData>('/reports/ddd', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[DDDPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(from, to, selectedFunil, teamFilter, groupFilter, estadoFilter);
  }, [from, to, selectedFunil, teamFilter, groupFilter, estadoFilter, fetchData]);

  const funis = data?.funis ?? [];
  const grupos = data?.grupos ?? [];
  const estados = data?.estados ?? [];

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'ddd' || key === 'estado');
    }
  };

  const sortedRows = data?.ddds
    ? [...data.ddds].sort((a, b) => {
        let cmp = 0;
        if (sortKey === 'ddd') {
          cmp = a.ddd.localeCompare(b.ddd, 'pt-BR', { numeric: true });
        } else if (sortKey === 'estado') {
          cmp = a.estado.localeCompare(b.estado, 'pt-BR');
        } else if (sortKey === 'conversao') {
          cmp = parseFloat(a.conversao) - parseFloat(b.conversao);
        } else {
          cmp = (a[sortKey] as number) - (b[sortKey] as number);
        }
        return sortAsc ? cmp : -cmp;
      })
    : [];

  const totalVolume = sortedRows.reduce((s, r) => s + r.volume, 0);

  const SortHeader = ({ label, field, align = 'right' }: { label: string; field: SortKey; align?: string }) => (
    <th
      className={`px-4 py-3 font-medium cursor-pointer hover:text-foreground transition-colors ${align === 'left' ? 'text-left' : 'text-right'}`}
      onClick={() => handleSort(field)}
    >
      {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
    </th>
  );

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
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

        {/* Estado Filter */}
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted" />
          <select
            value={estadoFilter}
            onChange={(e) => setEstadoFilter(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-foreground focus:outline-none focus:border-primary transition-colors cursor-pointer"
          >
            <option value="">Estado</option>
            {estados.map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>
        </div>

        <TagFilter />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <SortHeader label="DDD" field="ddd" align="left" />
              <SortHeader label="Estado" field="estado" align="left" />
              <SortHeader label="Volume" field="volume" />
              <th className="px-4 py-3 text-right font-medium">%</th>
              <SortHeader label="Fechamentos" field="fechamentos" />
              <SortHeader label="Conversão %" field="conversao" />
              <SortHeader label="Ticket Médio" field="ticketMedio" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-12" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-10" />
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right">
                    <Skeleton className="ml-auto h-5 w-12" />
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
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="border-t border-glass-border px-4 py-8 text-center text-muted text-body-md">
                  Nenhum dado encontrado no período selecionado.
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr key={row.ddd} className="hover:bg-surface-secondary/50 transition-colors">
                  <td className="border-t border-glass-border px-4 py-3 text-body-md text-foreground font-medium">
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted" />
                      {row.ddd}
                    </div>
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-body-md text-foreground">
                    {row.estado || '—'}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {row.volume}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-muted">
                    {totalVolume > 0 ? ((row.volume / totalVolume) * 100).toFixed(1) + '%' : '0.0%'}
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
