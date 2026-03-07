import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center font-heading font-medium text-body-sm px-2.5 py-0.5 rounded-badge',
  {
    variants: {
      variant: {
        default: 'bg-surface-secondary text-[#E0E3E9]',
        success: 'bg-success-bg text-success',
        warning: 'bg-warning-bg text-warning',
        danger: 'bg-danger/10 text-danger',
        info: 'bg-accent-blue-bg text-accent-blue',
        accent: 'bg-primary/10 text-primary',
        muted: 'bg-surface-secondary text-muted',
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
