import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';

const accentColors = {
  primary: 'border-l-primary',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
  info: 'border-l-accent-blue',
} as const;

const iconBgColors = {
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-accent-blue',
} as const;

interface KPICardProps {
  label: string;
  value?: string | number;
  icon: LucideIcon;
  accent?: keyof typeof accentColors;
  loading?: boolean;
  className?: string;
}

export function KPICard({
  label,
  value,
  icon: Icon,
  accent = 'primary',
  loading = false,
  className,
}: KPICardProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-card border border-glass-border bg-surface backdrop-blur-glass p-5 border-l-4 transition-shadow duration-200 hover:shadow-card-hover',
        accentColors[accent],
        className
      )}
    >
      <div className="flex-shrink-0 rounded-card bg-surface-secondary/60 border border-glass-border p-3">
        <Icon className={cn('h-5 w-5', iconBgColors[accent])} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-body-sm text-muted">{label}</span>
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <span className="text-heading-lg font-heading text-[#E0E3E9]">{value}</span>
        )}
      </div>
    </div>
  );
}
