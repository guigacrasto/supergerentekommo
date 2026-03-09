import dotenv from "dotenv";
dotenv.config();

export type TeamKey = "azul" | "amarela";

export interface TeamConfig {
  label: string;
  subdomain: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken: string;
  excludePipelineNames: string[]; // case-insensitive substrings to exclude
}

export const TEAMS: Record<TeamKey, TeamConfig> = {
  azul: {
    label: "Time Azul",
    subdomain: process.env.KOMMO_SUBDOMAIN || "",
    clientId: process.env.KOMMO_CLIENT_ID || "",
    clientSecret: process.env.KOMMO_CLIENT_SECRET || "",
    redirectUri: process.env.KOMMO_REDIRECT_URI || "",
    accessToken: process.env.KOMMO_ACCESS_TOKEN || "",
    excludePipelineNames: [],
  },
  amarela: {
    label: "Time Amarelo",
    subdomain: process.env.KOMMO_AMARELA_SUBDOMAIN || "",
    clientId: process.env.KOMMO_AMARELA_CLIENT_ID || "",
    clientSecret: process.env.KOMMO_AMARELA_CLIENT_SECRET || "",
    redirectUri: process.env.KOMMO_AMARELA_REDIRECT_URI || "",
    accessToken: process.env.KOMMO_AMARELA_ACCESS_TOKEN || "",
    excludePipelineNames: ["funil teste"],
  },
};

// Legacy: kommoConfig still used by oauth.ts — keep for now (will be updated in Task 7)
export const kommoConfig = {
  subdomain: TEAMS.azul.subdomain,
  clientId: TEAMS.azul.clientId,
  clientSecret: TEAMS.azul.clientSecret,
  redirectUri: TEAMS.azul.redirectUri,
  accessToken: TEAMS.azul.accessToken,
};

export const PORT = parseInt(process.env.PORT || "3000", 10);

// TOTP 2FA
export const totpConfig = {
  encryptionKey: process.env.TOTP_ENCRYPTION_KEY || "",
  issuer: "SuperGerente",
  challengeTtlMs: 5 * 60 * 1000, // 5 minutos
  backupCodeCount: 8,
};

// Email (Resend)
export const emailConfig = {
  apiKey: process.env.RESEND_API_KEY || "",
  from: process.env.RESEND_FROM_EMAIL || "noreply@supergerente.com",
  appUrl: process.env.APP_URL || "https://supergerente.com",
};

// CORS
export const corsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function validateConfig() {
  // Em modo multi-tenant, as credenciais Kommo vêm da tabela tenants.
  // Env vars são opcionais (usadas apenas para backward compatibility).
  if (!TEAMS.azul.subdomain) {
    console.warn("[Config] KOMMO_SUBDOMAIN não configurado — usando credenciais do tenant");
  }
  if (!TEAMS.amarela.subdomain) {
    console.warn("[Config] KOMMO_AMARELA_SUBDOMAIN não configurado — Equipe Amarela via tenant");
  }
}

// Build TeamConfig from tenant settings (multi-tenant)
import type { Tenant } from './types/index.js';

export function getTeamConfigsFromTenant(tenant: Tenant): Record<string, TeamConfig> {
  const teamsSettings = tenant.settings?.teams;
  if (!teamsSettings) return {};

  const result: Record<string, TeamConfig> = {};
  for (const [key, teamCfg] of Object.entries(teamsSettings)) {
    result[key] = {
      label: teamCfg.label,
      subdomain: teamCfg.subdomain,
      clientId: teamCfg.clientId,
      clientSecret: teamCfg.clientSecret,
      redirectUri: teamCfg.redirectUri,
      accessToken: '',
      excludePipelineNames: teamCfg.excludePipelineNames || [],
    };
  }
  return result;
}
