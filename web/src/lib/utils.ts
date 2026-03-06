import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

export function formatDateTime(date: Date | string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof date === 'string' ? new Date(date) : date);
}

export function dateToUnix(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00-03:00');
  return Math.floor(d.getTime() / 1000);
}

export function stripFunilPrefix(name: string): string {
  return name.replace(/^FUNIL\s+/i, '');
}

export function buildTagParams(selectedTags: number[], tagMode: 'or' | 'and'): string {
  if (selectedTags.length === 0) return '';
  const params = new URLSearchParams();
  params.set('tags', selectedTags.join(','));
  if (tagMode === 'and') params.set('tagMode', 'and');
  return '?' + params.toString();
}
