import { cn } from '@/lib/utils';

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  count?: number;
}

export function Chip({
  className,
  active = false,
  count,
  children,
  ...props
}: ChipProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-badge text-body-sm font-heading font-medium transition-all duration-200 cursor-pointer',
        active
          ? 'bg-primary text-white shadow-[0_1px_4px_rgba(149,102,242,0.3)]'
          : 'bg-surface-secondary/60 border border-glass-border text-muted hover:text-[#E0E3E9] hover:bg-white/[0.06] hover:border-white/10',
        className
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-badge text-body-sm',
            active ? 'bg-white/20 text-white' : 'bg-primary/10 text-primary'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
