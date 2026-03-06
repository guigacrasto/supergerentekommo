import { Chip } from '@/components/ui';
import { useFilterStore } from '@/stores/filterStore';
import { ALERT_TYPE_LABELS, TEAM_LABELS } from '@/lib/constants';
import type { AlertFilter, AlertEquipeFilter } from '@/types';

const alertTypes: AlertFilter[] = ['todos', 'risco48h', 'risco7d', 'tarefas'];
const equipeTypes: { value: AlertEquipeFilter; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'azul', label: TEAM_LABELS.azul },
  { value: 'amarela', label: TEAM_LABELS.amarela },
];

export function AlertFilters() {
  const alertFilter = useFilterStore((s) => s.alertFilter);
  const alertEquipeFilter = useFilterStore((s) => s.alertEquipeFilter);
  const setAlertFilter = useFilterStore((s) => s.setAlertFilter);
  const setAlertEquipeFilter = useFilterStore((s) => s.setAlertEquipeFilter);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-light mr-1">Tipo:</span>
        {alertTypes.map((type) => (
          <Chip
            key={type}
            active={alertFilter === type}
            onClick={() => setAlertFilter(type)}
          >
            {ALERT_TYPE_LABELS[type]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label text-muted-light mr-1">Time:</span>
        {equipeTypes.map(({ value, label }) => (
          <Chip
            key={value}
            active={alertEquipeFilter === value}
            onClick={() => setAlertEquipeFilter(value)}
          >
            {label}
          </Chip>
        ))}
      </div>
    </div>
  );
}
