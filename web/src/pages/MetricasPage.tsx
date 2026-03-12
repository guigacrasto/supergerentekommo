import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  BarChart3,
  DollarSign,
  Users,
  ShoppingCart,
  Banknote,
  Target,
  UserCheck,
  TrendingUp,
  Check,
  X,
  Pencil,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Skeleton, EmptyState } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { cn, formatCurrency } from '@/lib/utils';

interface DailyRow {
  date: string;
  pipeline_id: number;
  pipeline_name: string;
  team: string;
  gasto: number;
  leads: number;
  vendas: number;
  receita: number;
  cpl: number;
  cac: number;
  roi: number;
}

interface SummaryTotals {
  gasto: number;
  leads: number;
  vendas: number;
  receita: number;
  cpl: number;
  cac: number;
  roi: number;
}

interface PipelineRef {
  id: number;
  name: string;
  team: string;
}

interface SummaryResponse {
  daily: DailyRow[];
  totals: SummaryTotals;
  pipelines: PipelineRef[];
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 30);
  const from = fromDate.toISOString().slice(0, 10);
  return { from, to };
}

function EditableGasto({
  value,
  onSave,
}: {
  value: number;
  onSave: (newValue: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    setDraft(value > 0 ? value.toString() : '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft('');
  };

  const handleSave = async () => {
    const parsed = parseFloat(draft.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-body-sm text-muted">R$</span>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') cancelEdit();
          }}
          disabled={saving}
          className="w-24 rounded-button border border-primary/50 bg-surface-secondary px-2 py-1 text-body-sm text-foreground outline-none focus:border-primary"
        />
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-button bg-success/15 text-success hover:bg-success/25 transition-colors cursor-pointer"
          title="Salvar"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={cancelEdit}
          disabled={saving}
          className="flex h-7 w-7 items-center justify-center rounded-button bg-danger/15 text-danger hover:bg-danger/25 transition-colors cursor-pointer"
          title="Cancelar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-center gap-1.5 cursor-pointer rounded-button px-2 py-1 text-body-sm text-foreground hover:bg-primary/10 transition-colors"
      title="Clique para editar"
    >
      {formatCurrency(value)}
      <Pencil className="h-3 w-3 text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

export function MetricasPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const defaults = getDefaultDateRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [filterTeam, setFilterTeam] = useState('todos');
  const [filterPipeline, setFilterPipeline] = useState('todos');

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<SummaryResponse>(`/metricas/summary?from=${from}&to=${to}`);
      setSummary(res.data);
    } catch (err) {
      console.error('[MetricasPage] Erro:', err);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleSaveGasto = async (row: DailyRow, newGasto: number) => {
    await api.put('/metricas/entries', {
      date: row.date,
      pipeline_id: row.pipeline_id,
      team: row.team,
      gasto_ads: newGasto,
    });
    fetchSummary();
  };

  // Extract unique teams and pipelines for filters
  const teams = useMemo(() => {
    if (!summary) return [];
    const set = new Set(summary.daily.map((r) => r.team));
    return Array.from(set).sort();
  }, [summary]);

  const pipelines = useMemo(() => {
    if (!summary) return [];
    const map = new Map<number, string>();
    for (const r of summary.daily) {
      map.set(r.pipeline_id, r.pipeline_name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [summary]);

  // Filtered data
  const filteredDaily = useMemo(() => {
    let rows = summary?.daily || [];
    if (filterTeam !== 'todos') {
      rows = rows.filter((r) => r.team === filterTeam);
    }
    if (filterPipeline !== 'todos') {
      rows = rows.filter((r) => r.pipeline_id === Number(filterPipeline));
    }
    return rows;
  }, [summary, filterTeam, filterPipeline]);

  // Recalculate totals based on filtered data
  const totals = useMemo(() => {
    if (filteredDaily.length === 0) return null;
    const t = filteredDaily.reduce(
      (acc, r) => {
        acc.gasto += r.gasto;
        acc.leads += r.leads;
        acc.vendas += r.vendas;
        acc.receita += r.receita;
        return acc;
      },
      { gasto: 0, leads: 0, vendas: 0, receita: 0 }
    );
    return {
      ...t,
      cpl: t.leads > 0 ? t.gasto / t.leads : 0,
      cac: t.vendas > 0 ? t.gasto / t.vendas : 0,
      roi: t.gasto > 0 ? ((t.receita - t.gasto) / t.gasto) * 100 : 0,
    };
  }, [filteredDaily]);

  const selectClass = 'rounded-button border border-glass-border bg-surface-secondary px-3 py-1.5 text-body-sm text-foreground outline-none focus:border-primary cursor-pointer';

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-primary" />
          <h1 className="font-heading text-heading-md">Metricas</h1>
        </div>
        <p className="mt-1 text-body-md text-muted">
          Custos de aquisicao e ROI por funil — insira o gasto com ads clicando na coluna "Gasto"
        </p>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-body-sm text-muted">De:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={selectClass}
        />
        <label className="text-body-sm text-muted">Ate:</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={selectClass}
        />

        <div className="w-px h-6 bg-glass-border mx-1 hidden sm:block" />

        <label className="text-body-sm text-muted">Time:</label>
        <select value={filterTeam} onChange={(e) => setFilterTeam(e.target.value)} className={selectClass}>
          <option value="todos">Todos</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
          ))}
        </select>

        <label className="text-body-sm text-muted">Funil:</label>
        <select value={filterPipeline} onChange={(e) => setFilterPipeline(e.target.value)} className={selectClass}>
          <option value="todos">Todos</option>
          {pipelines.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-card border border-glass-border bg-surface p-5">
              <Skeleton className="h-5 w-20 mb-2" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : totals ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          <KPICard label="Gasto Total" value={formatCurrency(totals.gasto)} icon={DollarSign} accent="danger" />
          <KPICard label="Leads" value={totals.leads.toLocaleString('pt-BR')} icon={Users} accent="primary" />
          <KPICard label="Vendas" value={totals.vendas.toLocaleString('pt-BR')} icon={ShoppingCart} accent="success" />
          <KPICard label="Receita" value={formatCurrency(totals.receita)} icon={Banknote} accent="success" />
          <KPICard label="CPL" value={formatCurrency(totals.cpl)} icon={Target} accent="warning" />
          <KPICard label="CAC" value={formatCurrency(totals.cac)} icon={UserCheck} accent="warning" />
          <KPICard label="ROI" value={formatPercent(totals.roi)} icon={TrendingUp} accent="info" />
        </div>
      ) : null}

      {/* Tabela diaria */}
      {loading ? (
        <div className="rounded-card border border-glass-border bg-surface p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : filteredDaily.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nenhum dado encontrado"
          description="Nao ha leads ou gastos registrados neste periodo com esses filtros."
        />
      ) : (
        <div className="rounded-card border border-glass-border bg-surface overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-b border-glass-border text-muted">
                <th className="px-4 py-3 font-medium whitespace-nowrap">Data</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Funil</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Time</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Gasto R$</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Leads</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Vendas</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Receita</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">CPL</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">CAC</th>
                <th className="px-4 py-3 font-medium text-right whitespace-nowrap">ROI</th>
              </tr>
            </thead>
            <tbody>
              {filteredDaily.map((row) => (
                <tr
                  key={`${row.pipeline_id}-${row.date}`}
                  className="border-b border-glass-border/50 hover:bg-surface-secondary/40 transition-colors"
                >
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{formatDateBR(row.date)}</td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">{row.pipeline_name}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider',
                      row.team === 'azul' ? 'bg-accent-blue/15 text-accent-blue' :
                      row.team === 'amarela' ? 'bg-warning/15 text-warning' :
                      'bg-primary/15 text-primary'
                    )}>
                      {row.team}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <EditableGasto
                      key={`${row.pipeline_id}-${row.date}-${row.gasto}`}
                      value={row.gasto}
                      onSave={(newVal) => handleSaveGasto(row, newVal)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{row.leads}</td>
                  <td className="px-4 py-3 text-right text-foreground">{row.vendas}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatCurrency(row.receita)}</td>
                  <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{row.gasto > 0 ? formatCurrency(row.cpl) : '—'}</td>
                  <td className="px-4 py-3 text-right text-foreground whitespace-nowrap">{row.gasto > 0 ? formatCurrency(row.cac) : '—'}</td>
                  <td className={cn(
                    'px-4 py-3 text-right font-medium whitespace-nowrap',
                    row.roi > 0 ? 'text-success' : row.roi < 0 ? 'text-danger' : 'text-muted'
                  )}>
                    {row.gasto > 0 ? formatPercent(row.roi) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
