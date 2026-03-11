import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center font-heading font-medium text-body-sm px-2.5 py-0.5 rounded-badge border',
  {
    variants: {
      variant: {
        default: 'bg-surface-secondary/60 border-glass-border text-[#E0E3E9]',
        success: 'bg-success-bg border-success/20 text-success',
        warning: 'bg-warning-bg border-warning/20 text-warning',
        danger: 'bg-danger/10 border-danger/20 text-danger',
        info: 'bg-accent-blue-bg border-accent-blue/20 text-accent-blue',
        accent: 'bg-primary/10 border-primary/20 text-primary',
        muted: 'bg-surface-secondary/60 border-glass-border text-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { badgeVariants };
