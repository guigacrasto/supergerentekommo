export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
  teams?: string[];
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  status: "pending" | "approved" | "denied";
  teams?: string[];
}

export interface Mentor {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  methodology_text?: string;
  is_active: boolean;
}

export interface MentorFormData {
  id?: string;
  name: string;
  description: string;
  system_prompt: string;
  methodology_text: string;
  is_active: boolean;
}

export interface TokenStatus {
  hasRefreshToken: boolean;
  expiresAt: string | null;
}

export interface TokenUsage {
  userId: string;
  name: string;
  email: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUSD: string | number;
}

export type Team = "azul" | "amarela";
