// Branding — lido de variáveis de ambiente (white-label)
export const APP_NAME = import.meta.env.VITE_APP_NAME || 'SuperGerente';
export const APP_SHORT_NAME = import.meta.env.VITE_APP_SHORT_NAME || 'SG';
export const APP_DESCRIPTION =
  import.meta.env.VITE_APP_DESCRIPTION || 'Painel de gestao comercial inteligente';

export const TEAMS = ['azul', 'amarela'] as const;

export const TEAM_LABELS: Record<string, string> = {
  azul: 'Time Azul',
  amarela: 'Time Amarelo',
};

export const ALERT_TYPE_LABELS: Record<string, string> = {
  todos: 'Todos',
  risco48h: '+48h',
  risco7d: '+7 dias',
  tarefas: 'Tarefas',
};

export const STORAGE_KEYS = {
  token: 'sg_token',
  user: 'sg_user',
} as const;
