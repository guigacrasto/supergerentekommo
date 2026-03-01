import { Trophy, Medal } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui';

interface AgentSales {
  nome: string;
  vendas: number;
}

interface SalesRankingProps {
  title: string;
  data: AgentSales[];
}

const MEDAL_COLORS: Record<number, string> = {
  1: '#F9AA3C', // ouro
  2: '#959CA6', // prata
  3: '#BE6E00', // bronze
};

export function SalesRanking({ title, data }: SalesRankingProps) {
  const sorted = [...data]
    .filter((a) => a.vendas > 0)
    .sort((a, b) => b.vendas - a.vendas)
    .slice(0, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-warning" />
          {title}
        </CardTitle>
      </CardHeader>

      <div className="p-5">
        {sorted.length === 0 ? (
          <p className="text-center text-body-md text-muted py-6">
            Nenhuma venda neste periodo.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((agent, idx) => {
              const rank = idx + 1;
              const medalColor = MEDAL_COLORS[rank];

              return (
                <div
                  key={agent.nome}
                  className="flex items-center gap-3 rounded-button border border-glass-border bg-surface-secondary px-4 py-3"
                >
                  {/* Posicao */}
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full">
                    {medalColor ? (
                      <Medal
                        className="h-5 w-5"
                        style={{ color: medalColor }}
                      />
                    ) : (
                      <span className="text-body-md font-heading font-semibold text-muted">
                        {rank}
                      </span>
                    )}
                  </div>

                  {/* Nome do agente */}
                  <span className="flex-1 font-heading text-body-md font-medium truncate">
                    {agent.nome}
                  </span>

                  {/* Contagem de vendas */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-heading text-heading-sm text-primary">
                      {agent.vendas}
                    </span>
                    <span className="text-body-sm text-muted">
                      {agent.vendas === 1 ? 'venda' : 'vendas'}
                    </span>
                  </div>

                  {/* Badge de posicao para top 3 */}
                  {medalColor && (
                    <span
                      className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-badge px-1.5 text-body-sm font-heading font-semibold"
                      style={{
                        backgroundColor: `${medalColor}20`,
                        color: medalColor,
                      }}
                    >
                      #{rank}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
