export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  teams?: string[];
}

export interface Pipeline {
  id: number;
  name: string;
  team: 'azul' | 'amarela';
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  data?: Record<string, unknown>;
}

export interface Mentor {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  methodology_text?: string;
  is_active: boolean;
}

export interface SummaryPipeline {
  pipelineId: number;
  pipelineName: string;
  team: string;
  novosHoje: number;
  novosMes: number;
  ativos: number;
}

export interface AgentReport {
  agente: string;
  totalLeads: number;
  vendaGanha: number;
  vendaPerdida: number;
  conversao: number;
  ticketMedio?: number;
  [funnel: string]: string | number | undefined;
}

export interface AlertTeamData {
  team: string;
  leadsAbandonados48h: AlertItem[];
  leadsEmRisco7d: AlertItem[];
  tarefasVencidas: AlertItem[];
}

export interface AlertItem {
  leadId: number;
  leadName: string;
  vendedor: string;
  dias: number;
  kommoUrl: string;
}

export interface BrandTabData {
  created: number;
  remaining: number;
  period: string;
  fetchedAt: string;
}

export interface ChatResponse {
  response: string;
  sessionId: string;
  data?: Record<string, unknown>;
}

export type Team = 'azul' | 'amarela';
export type AlertFilter = 'todos' | 'risco48h' | 'risco7d' | 'tarefas';
export type AlertEquipeFilter = 'todas' | 'azul' | 'amarela';
