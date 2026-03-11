import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 font-heading font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-primary-900 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-br from-primary to-accent-blue text-white shadow-[0_1px_2px_rgba(149,102,242,0.3)] hover:shadow-[0_2px_8px_rgba(149,102,242,0.4)] hover:brightness-110 active:brightness-95',
        secondary:
          'bg-surface border border-glass-border text-[#E0E3E9] hover:bg-surface-secondary hover:border-white/10',
        ghost: 'text-muted hover:text-[#E0E3E9] hover:bg-white/[0.06]',
        danger: 'bg-danger text-white shadow-[0_1px_2px_rgba(239,68,68,0.3)] hover:shadow-[0_2px_8px_rgba(239,68,68,0.3)] hover:brightness-110',
        success: 'bg-success text-white shadow-[0_1px_2px_rgba(34,197,94,0.3)] hover:shadow-[0_2px_8px_rgba(34,197,94,0.3)] hover:brightness-110',
      },
      size: {
        sm: 'h-8 px-3 text-body-sm rounded-button',
        md: 'h-10 px-5 text-body-md rounded-button',
        lg: 'h-12 px-6 text-body-lg rounded-button',
        icon: 'h-10 w-10 rounded-button',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  )
);
Button.displayName = 'Button';

export { buttonVariants };
