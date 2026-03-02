import { Card } from '@/components/ui';
import type { TokenUsage as TokenUsageType } from '@/types';

interface TokenUsageProps {
  data: TokenUsageType[];
}

export function TokenUsage({ data }: TokenUsageProps) {
  const formatNumber = (n: number) =>
    new Intl.NumberFormat('pt-BR').format(n);

  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-body-md">
          <thead>
            <tr className="border-b border-glass-border text-left">
              <th className="px-5 py-3 font-heading font-semibold">Nome</th>
              <th className="px-5 py-3 font-heading font-semibold">Email</th>
              <th className="px-5 py-3 font-heading font-semibold text-right">Mensagens</th>
              <th className="px-5 py-3 font-heading font-semibold text-right">Prompt Tokens</th>
              <th className="px-5 py-3 font-heading font-semibold text-right">Completion Tokens</th>
              <th className="px-5 py-3 font-heading font-semibold text-right">Total Tokens</th>
              <th className="px-5 py-3 font-heading font-semibold text-right">Custo USD</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row.userId}
                className="border-b border-glass-border/50 last:border-0"
              >
                <td className="px-5 py-3">{row.name}</td>
                <td className="px-5 py-3 text-muted">{row.email}</td>
                <td className="px-5 py-3 text-right">{formatNumber(row.messages)}</td>
                <td className="px-5 py-3 text-right">{formatNumber(row.promptTokens)}</td>
                <td className="px-5 py-3 text-right">{formatNumber(row.completionTokens)}</td>
                <td className="px-5 py-3 text-right font-medium">{formatNumber(row.totalTokens)}</td>
                <td className="px-5 py-3 text-right font-medium text-primary">
                  {row.estimatedCostUSD}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
