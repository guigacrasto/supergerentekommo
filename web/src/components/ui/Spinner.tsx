import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const sizeMap = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-10 w-10',
} as const;

interface SpinnerProps {
  size?: keyof typeof sizeMap;
  className?: string;
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <Loader2 className={cn('animate-spin text-primary', sizeMap[size], className)} />
  );
}

export function PageSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-1 items-center justify-center py-20', className)}>
      <Spinner size="lg" />
    </div>
  );
}
