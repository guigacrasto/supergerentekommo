import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Clock, Zap, RefreshCw, Percent, Info } from 'lucide-react';
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
  pctFechamentoDia: string;
  porAgente: TMFAgente[];
  funis: string[];
  agentes: string[];
  grupos: string[];
}

interface PeriodSummary {
  leadsDia: number;
  leadsRmkt: number;
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

  const [summaryData, setSummaryData] = useState<{
    dia: PeriodSummary | null;
    semana: PeriodSummary | null;
    mes: PeriodSummary | null;
  }>({ dia: null, semana: null, mes: null });
  const [summaryLoading, setSummaryLoading] = useState(true);

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

  const fetchSummary = useCallback(async (funil: string, agente: string, team: string, group: string) => {
    try {
      setSummaryLoading(true);
      const today = getToday();
      const commonParams: Record<string, string> = {};
      if (funil) commonParams.funil = funil;
      if (agente) commonParams.agente = agente;
      if (team) commonParams.team = team;
      if (group) commonParams.group = group;

      const [diaRes, semanaRes, mesRes] = await Promise.all([
        api.get<TMFData>('/reports/tmf', { params: { ...commonParams, from: today, to: today } }),
        api.get<TMFData>('/reports/tmf', { params: { ...commonParams, from: getMondayOfWeek(), to: today } }),
        api.get<TMFData>('/reports/tmf', { params: { ...commonParams, from: getFirstOfMonth(), to: today } }),
      ]);

      setSummaryData({
        dia: { leadsDia: diaRes.data.totalFechamentoDia, leadsRmkt: diaRes.data.totalRemarketing },
        semana: { leadsDia: semanaRes.data.totalFechamentoDia, leadsRmkt: semanaRes.data.totalRemarketing },
        mes: { leadsDia: mesRes.data.totalFechamentoDia, leadsRmkt: mesRes.data.totalRemarketing },
      });
    } catch (err) {
      console.error('[TMFPage] Erro ao carregar summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(from, to, selectedFunil, selectedAgente, teamFilter, groupFilter);
  }, [from, to, selectedFunil, selectedAgente, teamFilter, groupFilter, fetchData]);

  useEffect(() => {
    fetchSummary(selectedFunil, selectedAgente, teamFilter, groupFilter);
  }, [selectedFunil, selectedAgente, teamFilter, groupFilter, fetchSummary]);

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

      {/* Legend */}
      <div className="rounded-card border border-glass-border bg-surface/60 backdrop-blur-glass p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-accent-blue mt-0.5 flex-shrink-0" />
          <div className="flex flex-col gap-1.5 text-body-sm">
            <p className="text-foreground font-medium">Regras de Classificação de Leads</p>
            <p className="text-muted">
              <span className="text-success font-medium">Leads Dia</span> — Leads fechados em até 24 horas após a criação. Representam vendas rápidas, fechadas no mesmo dia.
            </p>
            <p className="text-muted">
              <span className="text-warning font-medium">Leads Remarketing</span> — Leads que levaram mais de 24 horas para fechar. Passaram por follow-up ou remarketing antes da conversão.
            </p>
          </div>
        </div>
      </div>

      {/* 5 KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-5">
        <KPICard
          label="TMF Geral"
          value={data ? formatTMF(data.tmfGeralHoras) : undefined}
          icon={Clock}
          accent="primary"
          loading={loading}
        />
        <KPICard
          label="Leads Dia"
          value={data?.totalFechamentoDia}
          icon={Zap}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="% Leads Dia"
          value={data?.pctFechamentoDia}
          icon={Percent}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Leads Remarketing"
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

      {/* Summary Table — LEADS dia / LEADS rmkt por DIA, SEMANA, MÊS */}
      <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-left font-medium" />
              <th className="px-4 py-3 text-center font-medium">Dia</th>
              <th className="px-4 py-3 text-center font-medium">Semana</th>
              <th className="px-4 py-3 text-center font-medium">Mês</th>
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-surface-secondary/50 transition-colors">
              <td className="border-t border-glass-border px-4 py-3 text-body-md text-success font-medium">
                LEADS dia
              </td>
              {summaryLoading ? (
                <>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                </>
              ) : (
                <>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.dia?.leadsDia ?? 0}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.semana?.leadsDia ?? 0}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.mes?.leadsDia ?? 0}
                  </td>
                </>
              )}
            </tr>
            <tr className="hover:bg-surface-secondary/50 transition-colors">
              <td className="border-t border-glass-border px-4 py-3 text-body-md text-warning font-medium">
                LEADS rmkt
              </td>
              {summaryLoading ? (
                <>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                  <td className="border-t border-glass-border px-4 py-3 text-center"><Skeleton className="mx-auto h-5 w-10" /></td>
                </>
              ) : (
                <>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.dia?.leadsRmkt ?? 0}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.semana?.leadsRmkt ?? 0}
                  </td>
                  <td className="border-t border-glass-border px-4 py-3 text-center text-body-md text-foreground font-semibold">
                    {summaryData.mes?.leadsRmkt ?? 0}
                  </td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Agent Table — only show when funil or agente filter is active */}
      {(selectedFunil || selectedAgente) && <div className="overflow-x-auto rounded-card border border-glass-border bg-surface">
        <table className="w-full">
          <thead>
            <tr className="bg-surface-secondary text-muted text-body-sm">
              <th className="px-4 py-3 text-left font-medium">Nome</th>
              <th className="px-4 py-3 text-right font-medium">Leads Dia</th>
              <th className="px-4 py-3 text-right font-medium">Leads Rmkt</th>
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
                  Nenhum dado encontrado no período selecionado.
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
