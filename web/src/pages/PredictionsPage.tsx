import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, Filter, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, Badge, Skeleton, EmptyState, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface PredictionFactor {
  nome: string;
  valor: string;
  peso: number;
  impacto: 'positivo' | 'negativo' | 'neutro';
}

interface LeadPrediction {
  leadId: number;
  titulo: string;
  agente: string;
  funil: string;
  score: number;
  nivel: 'alto' | 'medio' | 'baixo';
  fatores: PredictionFactor[];
  valor: number;
  ultimaAtualizacao: number;
}

const NIVEL_CONFIG = {
  alto: { label: 'Alto', color: 'bg-success/10 text-success border-success/20' },
  medio: { label: 'Médio', color: 'bg-warning/10 text-warning border-warning/20' },
  baixo: { label: 'Baixo', color: 'bg-danger/10 text-danger border-danger/20' },
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-success' : score >= 40 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2.5 rounded-full bg-surface-secondary overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', color)}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={cn(
        'font-heading text-heading-sm font-bold tabular-nums min-w-[3ch] text-right',
        score >= 70 ? 'text-success' : score >= 40 ? 'text-warning' : 'text-danger'
      )}>
        {score}
      </span>
    </div>
  );
}

function PredictionCard({ prediction }: { prediction: LeadPrediction }) {
  const [expanded, setExpanded] = useState(false);
  const nivelConfig = NIVEL_CONFIG[prediction.nivel];

  return (
    <div className="rounded-card border border-glass-border bg-surface-secondary p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-body-md font-heading font-semibold text-foreground truncate">
            {prediction.titulo}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-body-sm text-muted">{prediction.agente}</span>
            <span className="text-body-sm text-muted">•</span>
            <span className="text-body-sm text-muted">{prediction.funil}</span>
          </div>
        </div>
        <Badge className={nivelConfig.color}>{nivelConfig.label}</Badge>
      </div>

      <ScoreBar score={prediction.score} />

      {prediction.valor > 0 && (
        <p className="text-body-sm text-muted">
          Valor: <span className="text-foreground font-medium">R$ {prediction.valor.toLocaleString('pt-BR')}</span>
        </p>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        className="text-body-sm text-primary hover:text-primary/80 transition-colors cursor-pointer"
      >
        {expanded ? 'Ocultar fatores' : 'Ver fatores'}
      </button>

      {expanded && (
        <div className="space-y-2 pt-2 border-t border-glass-border">
          {prediction.fatores.map((fator) => (
            <div key={fator.nome} className="flex items-center justify-between text-body-sm">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  fator.impacto === 'positivo' ? 'bg-success' :
                  fator.impacto === 'negativo' ? 'bg-danger' : 'bg-warning'
                )} />
                <span className="text-muted">{fator.nome}</span>
              </div>
              <span className="text-foreground font-medium">{fator.valor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PredictionsPage() {
  const [predictions, setPredictions] = useState<LeadPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [team] = useState('azul');
  const [atualizadoEm, setAtualizadoEm] = useState('');

  const fetchPredictions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{
        predictions: LeadPrediction[];
        atualizadoEm: string;
      }>(`/reports/predictions?team=${team}`);
      setPredictions(res.data.predictions);
      setAtualizadoEm(res.data.atualizadoEm);
    } catch (err) {
      console.error('[PredictionsPage] Erro:', err);
    } finally {
      setLoading(false);
    }
  }, [team]);

  useEffect(() => {
    fetchPredictions();
  }, [fetchPredictions]);

  const altos = predictions.filter((p) => p.nivel === 'alto');
  const medios = predictions.filter((p) => p.nivel === 'medio');
  const baixos = predictions.filter((p) => p.nivel === 'baixo');

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-heading text-heading-md">Previsão de Vendas</h1>
            <span className="inline-flex items-center rounded-badge bg-warning/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-warning">
              Beta
            </span>
          </div>
          <p className="mt-1 text-body-md text-muted">
            Score de probabilidade de fechamento por lead ativo — <span className="text-warning">funcionalidade em fase de testes</span>
          </p>
          {atualizadoEm && (
            <p className="text-body-sm text-muted mt-1">
              Atualizado em: {atualizadoEm}
            </p>
          )}
        </div>
        <Button
          onClick={fetchPredictions}
          variant="ghost"
          size="sm"
          loading={loading}
        >
          <RefreshCw className="h-4 w-4 mr-1.5" />
          Atualizar
        </Button>
      </div>

      {/* KPI summary */}
      {!loading && predictions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-button bg-success/10">
                <TrendingUp className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-heading-md font-heading font-bold text-success">{altos.length}</p>
                <p className="text-body-sm text-muted">Alta probabilidade</p>
              </div>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-button bg-warning/10">
                <Filter className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-heading-md font-heading font-bold text-warning">{medios.length}</p>
                <p className="text-body-sm text-muted">Média probabilidade</p>
              </div>
            </div>
          </Card>
          <Card className="!p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-button bg-danger/10">
                <TrendingUp className="h-5 w-5 text-danger rotate-180" />
              </div>
              <div>
                <p className="text-heading-md font-heading font-bold text-danger">{baixos.length}</p>
                <p className="text-body-sm text-muted">Baixa probabilidade</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Predictions grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-card border border-glass-border bg-surface-secondary p-4 space-y-3">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      ) : predictions.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="Nenhuma previsão disponível"
          description="Não há leads ativos para calcular previsões."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {predictions.map((p) => (
            <PredictionCard key={p.leadId} prediction={p} />
          ))}
        </div>
      )}
    </div>
  );
}
