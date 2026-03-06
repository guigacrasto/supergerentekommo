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

export function validateConfig() {
  if (!TEAMS.azul.subdomain) {
    console.error("Erro: KOMMO_SUBDOMAIN é obrigatório no .env");
    process.exit(1);
  }
  if (!TEAMS.amarela.subdomain) {
    console.warn("[Config] KOMMO_AMARELA_SUBDOMAIN não configurado — Equipe Amarela desativada");
  }
}
