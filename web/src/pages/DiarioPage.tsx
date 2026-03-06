import { useEffect, useState, useCallback } from 'react';
import { CalendarDays, Users, TrendingUp, Target, Percent } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Chip, LiveTimestamp } from '@/components/ui';
import { KPICard } from '@/components/features/dashboard/KPICard';
import { TagFilter } from '@/components/features/filters/TagFilter';

interface DailyMetrics {
  team: string;
  leadsDia: number;
  leadsMes: number;
  vendasDia: number;
  vendasMes: number;
  perdidasDia: number;
  perdidasMes: number;
  conversaoDia: string;
  conversaoMes: string;
}

type TeamFilter = '' | 'azul' | 'amarela';

export function DiarioPage() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<DailyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('');
  const [lastFetchTime, setLastFetchTime] = useState('');

  const userTeams = user?.teams ?? [];
  const hasMultipleTeams = userTeams.length > 1;

  const fetchData = useCallback(async (date: string) => {
    try {
      setLoading(true);
      const res = await api.get<DailyMetrics[]>(`/reports/daily?date=${date}`);
      setData(res.data);
      setLastFetchTime(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (err) {
      console.error('[DiarioPage] Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selectedDate);
  }, [selectedDate, fetchData]);

  const filtered = teamFilter ? data.filter((d) => d.team === teamFilter) : data;

  const totals = filtered.reduce(
    (acc, d) => ({
      leadsDia: acc.leadsDia + d.leadsDia,
      leadsMes: acc.leadsMes + d.leadsMes,
      vendasDia: acc.vendasDia + d.vendasDia,
      vendasMes: acc.vendasMes + d.vendasMes,
      perdidasDia: acc.perdidasDia + d.perdidasDia,
      perdidasMes: acc.perdidasMes + d.perdidasMes,
    }),
    { leadsDia: 0, leadsMes: 0, vendasDia: 0, vendasMes: 0, perdidasDia: 0, perdidasMes: 0 }
  );

  const conversaoDia = totals.leadsDia > 0
    ? ((totals.vendasDia / totals.leadsDia) * 100).toFixed(1) + '%'
    : '0.0%';
  const conversaoMes = totals.leadsMes > 0
    ? ((totals.vendasMes / totals.leadsMes) * 100).toFixed(1) + '%'
    : '0.0%';

  return (
    <div className="flex flex-col gap-6">
      <LiveTimestamp timestamp={lastFetchTime} />

      {/* Date picker + Team filter */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded-button border border-glass-border bg-surface-secondary px-3 py-2 text-body-md text-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>

        {hasMultipleTeams && (
          <div className="flex items-center gap-2">
            <Chip active={teamFilter === ''} onClick={() => setTeamFilter('')}>
              Todas
            </Chip>
            {userTeams.includes('azul') && (
              <Chip active={teamFilter === 'azul'} onClick={() => setTeamFilter('azul')}>
                Azul
              </Chip>
            )}
            {userTeams.includes('amarela') && (
              <Chip active={teamFilter === 'amarela'} onClick={() => setTeamFilter('amarela')}>
                Amarela
              </Chip>
            )}
          </div>
        )}

        <TagFilter />
      </div>

      {/* 6 KPI Cards — Grid 3x2 (desktop) / 2x3 (mobile) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <KPICard
          label="Leads Dia"
          value={totals.leadsDia}
          icon={Users}
          accent="primary"
          loading={loading}
        />
        <KPICard
          label="Leads Mês"
          value={totals.leadsMes}
          icon={Users}
          accent="info"
          loading={loading}
        />
        <KPICard
          label="Vendas Dia"
          value={totals.vendasDia}
          icon={TrendingUp}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Vendas Mês"
          value={totals.vendasMes}
          icon={Target}
          accent="success"
          loading={loading}
        />
        <KPICard
          label="Conversão Dia"
          value={conversaoDia}
          icon={Percent}
          accent="warning"
          loading={loading}
        />
        <KPICard
          label="Conversão Mês"
          value={conversaoMes}
          icon={Percent}
          accent="warning"
          loading={loading}
        />
      </div>
    </div>
  );
}
