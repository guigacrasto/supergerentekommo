import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, CardTitle } from '@/components/ui';

interface AgentData {
  nome: string;
  total: number;
  ativos: number;
}

interface TeamPieChartProps {
  team: string;
  label: string;
  agents: AgentData[];
  color: string;
}

const RADIAN = Math.PI / 180;

// Paleta de tons para cada equipe
function generateShades(baseColor: string, count: number): string[] {
  const r = parseInt(baseColor.slice(1, 3), 16);
  const g = parseInt(baseColor.slice(3, 5), 16);
  const b = parseInt(baseColor.slice(5, 7), 16);

  if (count <= 1) return [baseColor];

  return Array.from({ length: count }, (_, i) => {
    const factor = 1 - (i * 0.6) / Math.max(count - 1, 1);
    const nr = Math.round(r * factor + 255 * (1 - factor) * 0.15);
    const ng = Math.round(g * factor + 255 * (1 - factor) * 0.15);
    const nb = Math.round(b * factor + 255 * (1 - factor) * 0.15);
    return `rgb(${Math.min(nr, 255)},${Math.min(ng, 255)},${Math.min(nb, 255)})`;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderCustomLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent } = props;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  if (percent < 0.05) return null;

  return (
    <text
      x={x}
      y={y}
      fill="white"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={12}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
}

export function TeamPieChart({ team, label, agents, color }: TeamPieChartProps) {
  const chartData = agents
    .map((a) => ({
      name: a.nome,
      value: a.total,
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  const colors = generateShades(color, chartData.length);
  const total = chartData.reduce((sum, d) => sum + d.value, 0);

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
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={95}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#22182D',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  color: '#E0E3E9',
                  fontSize: '0.875rem',
                }}
                formatter={(value) => [
                  `${value} leads (${total > 0 ? ((Number(value) / total) * 100).toFixed(1) : 0}%)`,
                ]}
              />
              <Legend
                wrapperStyle={{ fontSize: '0.75rem', color: '#959CA6' }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
