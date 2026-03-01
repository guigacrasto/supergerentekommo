import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-label text-muted-light">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'h-10 w-full rounded-input border bg-surface-secondary px-3 text-body-md text-[#E0E3E9] placeholder:text-muted',
            'border-glass-border focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30',
            'transition-colors duration-150',
            'light:bg-surface-light light:text-[#23272C] light:border-glass-border-light',
            error && 'border-danger focus:border-danger focus:ring-danger/30',
            className
          )}
          {...props}
        />
        {error && <span className="text-body-sm text-danger">{error}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';
