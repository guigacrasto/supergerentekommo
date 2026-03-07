import { MessageSquare, ThumbsUp, AlertCircle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui';

interface ConversationCardProps {
  leadId: number;
  leadNome: string;
  vendedor: string;
  kommoUrl?: string;
  sentimentScore: number;
  qualityScore: number;
  resumo: string;
  pontosPositivos: string[];
  pontosMelhoria: string[];
  analisadoEm: string;
}

function scoreToBadge(score: number): { variant: 'success' | 'warning' | 'danger'; label: string } {
  if (score >= 4) return { variant: 'success', label: 'Bom' };
  if (score >= 3) return { variant: 'warning', label: 'Regular' };
  return { variant: 'danger', label: 'Atenção' };
}

export function ConversationCard({
  leadNome,
  kommoUrl,
  sentimentScore,
  qualityScore,
  resumo,
  pontosPositivos,
  pontosMelhoria,
  analisadoEm,
}: ConversationCardProps) {
  const sentiment = scoreToBadge(sentimentScore);
  const quality = scoreToBadge(qualityScore);

  return (
    <div className="flex flex-col gap-3 rounded-card border border-glass-border bg-surface p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          {kommoUrl ? (
            <a
              href={kommoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-heading text-heading-sm text-primary hover:underline"
            >
              {leadNome}
              <ExternalLink className="ml-1 inline h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="font-heading text-heading-sm">{leadNome}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={quality.variant}>Qualidade: {quality.label}</Badge>
          <Badge variant={sentiment.variant}>Sentimento: {sentiment.label}</Badge>
        </div>
      </div>

      <p className="text-body-md text-muted-light">{resumo}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pontosPositivos.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-body-sm font-medium text-success">
              <ThumbsUp className="h-3.5 w-3.5" />
              Pontos positivos
            </div>
            <ul className="list-disc pl-5 text-body-sm text-muted-light">
              {pontosPositivos.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {pontosMelhoria.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 text-body-sm font-medium text-warning">
              <AlertCircle className="h-3.5 w-3.5" />
              Pontos de melhoria
            </div>
            <ul className="list-disc pl-5 text-body-sm text-muted-light">
              {pontosMelhoria.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <span className="text-body-sm text-muted">Analisado em: {analisadoEm}</span>
    </div>
  );
}
