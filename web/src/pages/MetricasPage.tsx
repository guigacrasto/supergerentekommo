import { useEffect, useState, useCallback, useRef } from 'react';
import {
  BarChart3,
  DollarSign,
  Users,
  ShoppingCart,
  Banknote,
  Target,
  UserCheck,
  TrendingUp,
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
  const [draft, setDraft] = useState(value.toString());
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const handleSave = async () => {
    const parsed = parseFloat(draft.replace(',', '.'));
    if (isNaN(parsed) || parsed < 0) {
      setDraft(value.toString());
      setEditing(false);
      return;
    }
    setSaving(true);
    await onSave(parsed);
    setSaving(false);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave();
          if (e.key === 'Escape') {
            setDraft(value.toString());
            setEditing(false);
          }
        }}
        disabled={saving}
        className="w-28 rounded-button border border-primary/40 bg-surface-secondary px-2 py-1 text-body-sm text-foreground outline-none focus:border-primary"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(value.toString());
        setEditing(true);
      }}
      className="cursor-pointer rounded-button px-2 py-1 text-body-sm text-foreground hover:bg-primary/10 transition-colors"
      title="Clique para editar"
    >
      {formatCurrency(value)}
    </button>
  );
}

export function MetricasPage() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const defaults = getDefaultDateRange();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);

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

  const totals = summary?.totals;
  const daily = summary?.daily || [];

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

      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-body-sm text-muted">De:</label>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-button border border-glass-border bg-surface-secondary px-3 py-1.5 text-body-sm text-foreground outline-none focus:border-primary"
        />
        <label className="text-body-sm text-muted">Ate:</label>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-button border border-glass-border bg-surface-secondary px-3 py-1.5 text-body-sm text-foreground outline-none focus:border-primary"
        />
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="rounded-card border border-glass-border bg-surface p-5">
              <Skeleton className="h-5 w-20 mb-2" />
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </div>
      ) : totals ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <KPICard label="Gasto Total" value={formatCurrency(totals.gasto)} icon={DollarSign} accent="danger" />
          <KPICard label="Leads" value={totals.leads} icon={Users} accent="primary" />
          <KPICard label="Vendas" value={totals.vendas} icon={ShoppingCart} accent="success" />
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
      ) : daily.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="Nenhum dado encontrado"
          description="Nao ha leads ou gastos registrados neste periodo."
        />
      ) : (
        <div className="rounded-card border border-glass-border bg-surface overflow-x-auto">
          <table className="w-full text-left text-body-sm">
            <thead>
              <tr className="border-b border-glass-border text-muted">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Funil</th>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Gasto R$</th>
                <th className="px-4 py-3 font-medium text-right">Leads</th>
                <th className="px-4 py-3 font-medium text-right">Vendas</th>
                <th className="px-4 py-3 font-medium text-right">Receita</th>
                <th className="px-4 py-3 font-medium text-right">CPL</th>
                <th className="px-4 py-3 font-medium text-right">CAC</th>
                <th className="px-4 py-3 font-medium text-right">ROI</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((row) => (
                <tr
                  key={`${row.pipeline_id}-${row.date}`}
                  className="border-b border-glass-border/50 hover:bg-surface-secondary/40 transition-colors"
                >
                  <td className="px-4 py-3 text-foreground">{formatDateBR(row.date)}</td>
                  <td className="px-4 py-3 text-foreground">{row.pipeline_name}</td>
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
                      value={row.gasto}
                      onSave={(newVal) => handleSaveGasto(row, newVal)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-foreground">{row.leads}</td>
                  <td className="px-4 py-3 text-right text-foreground">{row.vendas}</td>
                  <td className="px-4 py-3 text-right text-foreground">{formatCurrency(row.receita)}</td>
                  <td className="px-4 py-3 text-right text-foreground">{row.gasto > 0 ? formatCurrency(row.cpl) : '—'}</td>
                  <td className="px-4 py-3 text-right text-foreground">{row.gasto > 0 ? formatCurrency(row.cac) : '—'}</td>
                  <td className={cn(
                    'px-4 py-3 text-right font-medium',
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
