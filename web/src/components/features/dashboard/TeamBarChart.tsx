import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle } from '@/components/ui';

interface AgentData {
  nome: string;
  total: number;
  ativos: number;
}

interface TeamBarChartProps {
  team: string;
  label: string;
  agents: AgentData[];
  color: string;
}

export function TeamBarChart({ team, label, agents, color }: TeamBarChartProps) {
  const chartData = agents
    .map((a) => ({
      name: a.nome,
      value: a.total,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);
  const barHeight = 40;
  const chartHeight = Math.max(chartData.length * barHeight + 40, 120);

  return (
    <Card>
      <CardHeader>
        <CardTitle
          className={
            team === 'azul' ? 'text-accent-blue' : 'text-warning'
          }
        >
          {label} — Atendimentos
        </CardTitle>
      </CardHeader>

      <div className="px-5 py-4">
        {total === 0 ? (
          <p className="text-center text-body-md text-muted py-8">
            Sem dados de atendimentos.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fill: '#959CA6', fontSize: 12 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: '#E0E3E9', fontSize: 13 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#22182D',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  color: '#FFFFFF',
                  fontSize: '0.875rem',
                }}
                labelStyle={{ color: '#FFFFFF', fontWeight: 500 }}
                itemStyle={{ color: '#E0E3E9' }}
                formatter={(value: number | undefined) => [
                  `${value ?? 0} leads (${total > 0 && value ? ((value / total) * 100).toFixed(1) : 0}%)`,
                  'Total',
                ]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24} fill={color} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
