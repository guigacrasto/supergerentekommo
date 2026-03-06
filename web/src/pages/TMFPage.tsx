import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Clock, Zap, RefreshCw, Percent } from 'lucide-react';
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

interface TMFAgente {
  nome: string;
  fechamentoDia: number;
  remarketing: number;
  tmfHoras: number;
}

interface TMFData {
  tmfGeralHoras: number;
  totalFechamentoDia: number;
  totalRemarketing: number;
  pctRemarketing: string;
  porAgente: TMFAgente[];
  funis: string[];
  agentes: string[];
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

function formatTMF(horas: number): string {
  if (horas < 24) return `${horas.toFixed(1)}h`;
  const dias = Math.floor(horas / 24);
  const horasRestantes = Math.round(horas % 24);
  if (horasRestantes === 0) return `${dias}d`;
  return `${dias}d ${horasRestantes}h`;
}

export function TMFPage() {
  const user = useAuthStore((s) => s.user);
  const selectedFunil = useFilterStore((s) => s.selectedFunil);
  const [data, setData] = useState<TMFData | null>(null);
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
      const res = await api.get<TMFData>('/reports/tmf', { params });
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[TMFPage] Erro ao carregar dados:', err);
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

  const sortedAgentes = data?.porAgente
    ? [...data.porAgente].sort((a, b) => a.tmfHoras - b.tmfHoras)
    : [];

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
        <AgenteFilter agentes={agentes} selected={selectedAgente} onChange={setSelectedAgente} />
        <TagFilter />
      </div>

      {/* 4 KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          label="TMF Geral"
          value={data ? formatTMF(data.tmfGeralHoras) : undefined}
          icon={Clock}
          accent="primary"
          loading={loading}
        />
        <KPICard
          label="Fechamento do Dia"
          value={data?.totalFechamentoDia}
          icon={Zap}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Remarketing"
          value={data?.totalRemarketing}
          icon={RefreshCw}
          accent="warning"
          loading={loading}
        />
        <KPICard
          label="% Remarketing"
          value={data?.pctRemarketing}
          icon={Percent}
          accent="info"
          loading={loading}
        />
      </div>

      {/* Table — only show when funil or agente filter is active */}
      {(selectedFunil || selectedAgente) && <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-right font-medium">Fech. Dia</th>
              <th className="px-4 py-3 text-right font-medium">Remarketing</th>
              <th className="px-4 py-3 text-right font-medium">TMF</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="border-t border-glass-border px-4 py-3">
                    <Skeleton className="h-5 w-32" />
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
                </tr>
              ))
            ) : sortedAgentes.length === 0 ? (
              <tr>
                <td colSpan={4} className="border-t border-glass-border px-4 py-8 text-center text-muted text-body-md">
                  Nenhum dado encontrado no per&iacute;odo selecionado.
                </td>
              </tr>
            ) : (
              sortedAgentes.map((agente) => (
                <tr key={agente.nome} className="hover:bg-surface-secondary/50 transition-colors">
                  <td className="border-t border-glass-border px-4 py-3 text-body-md text-foreground font-medium">
                    {agente.nome}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {agente.fechamentoDia}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {agente.remarketing}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-right text-body-md text-foreground">
                    {formatTMF(agente.tmfHoras)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>}
    </div>
  );
}
