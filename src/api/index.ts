import { TEAMS, validateConfig, PORT, getTeamConfigsFromTenant } from "../config.js";
import { KommoService } from "../services/kommo.js";
import { createServer } from "./server.js";
import { getCrmMetrics, startProactiveRefresh } from "./cache/crm-cache.js";
import { markCacheReady, setTokenStatuses, TokenStatusEntry } from "./readiness.js";
import { startAuditCleanup } from "./middleware/auditLog.js";
import { loadTenants, getAllTenants } from "./services/tenant.js";
import { cleanupExpiredChallenges } from "./services/totp.js";
import { loadTokens, loadTokensFromTenant } from "../services/token-store.js";

validateConfig();

const app = createServer();

const REFRESH_INTERVAL_MS = 1 * 60 * 60 * 1000; // 1 hour — refresh proativo a cada hora

// Store all active KommoService instances for token refresh
const allServices: Array<{ service: KommoService; label: string }> = [];

async function updateTokenStatuses() {
  const statuses: TokenStatusEntry[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const { service, label } of allServices) {
    try {
      const stored = service.tenantId
        ? await loadTokensFromTenant(service.tenantId)
        : await loadTokens(service.team);

      if (!stored?.accessToken) {
        statuses.push({ label, status: "unknown" });
        continue;
      }

      if (!stored.expiresAt) {
        statuses.push({ label, status: "unknown", expiresAt: undefined });
        continue;
      }

      const hoursLeft = Math.round((stored.expiresAt - now) / 3600 * 10) / 10;
      let status: "valid" | "expiring" | "expired";
      if (stored.expiresAt <= now) status = "expired";
      else if (hoursLeft < 6) status = "expiring";
      else status = "valid";

      statuses.push({ label, status, expiresAt: stored.expiresAt, hoursLeft });
    } catch {
      statuses.push({ label, status: "unknown" });
    }
  }

  setTokenStatuses(statuses);
}

async function refreshAllTokens() {
  console.log("[Scheduler] Verificando tokens Kommo...");
  for (const { service, label } of allServices) {
    try {
      await service.proactiveRefresh();
    } catch (e: any) {
      console.error(`[Scheduler] Erro ao refreshar token de ${label}:`, e.message);
    }
  }
  await updateTokenStatuses();
}

app.listen(PORT, async () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);

  // Load tenants from database
  await loadTenants();
  const tenants = await getAllTenants();
  const activeTenants = tenants.filter(t => t.isActive);

  if (activeTenants.length > 0) {
    console.log(`[Startup] ${activeTenants.length} tenants ativos encontrados`);

    // Initialize KommoService for each tenant's teams
    for (const tenant of activeTenants) {
      const teamConfigs = getTeamConfigsFromTenant(tenant);
      for (const [teamKey, cfg] of Object.entries(teamConfigs)) {
        if (!cfg.subdomain) continue;
        const service = new KommoService(cfg, teamKey, tenant.id);
        await service.loadStoredToken();
        allServices.push({ service, label: `${tenant.slug}:${teamKey}` });

        // Register for proactive cache refresh
        startProactiveRefresh(teamKey, service, tenant.id, cfg.excludePipelineNames);
      }
    }
  } else {
    // Fallback: use env vars (backward compat for migration period)
    console.log("[Startup] Nenhum tenant ativo — usando env vars (fallback)");
    if (TEAMS.azul.subdomain) {
      const azul = new KommoService(TEAMS.azul, "azul");
      await azul.loadStoredToken();
      allServices.push({ service: azul, label: "env:azul" });
      startProactiveRefresh("azul", azul);
    }
    if (TEAMS.amarela.subdomain) {
      const amarela = new KommoService(TEAMS.amarela, "amarela");
      await amarela.loadStoredToken();
      allServices.push({ service: amarela, label: "env:amarela" });
      startProactiveRefresh("amarela", amarela);
    }
  }

  // Refresh tokens proactively on startup
  await refreshAllTokens();
  setInterval(refreshAllTokens, REFRESH_INTERVAL_MS);

  // Warm-up caches synchronously — health only becomes ready after this
  console.log("[WarmUp] Pré-carregando cache de métricas...");
  try {
    const warmups: Promise<unknown>[] = [];
    for (const { service, label } of allServices) {
      const [, team] = label.split(":");
      const tenantId = label.includes(":") ? undefined : undefined; // handled inside getCrmMetrics
      warmups.push(
        getCrmMetrics(team || label, service).catch(e => {
          console.error(`[WarmUp] Erro no cache de ${label}:`, e.message);
        })
      );
    }
    await Promise.all(warmups);
    console.log("[WarmUp] Cache aquecido com sucesso");
  } catch (e) {
    console.error("[WarmUp] Erro ao aquecer cache (continuando mesmo assim):", e);
  }

  console.log("[ProactiveRefresh] Background refresh registrado");
  markCacheReady();

  // Start audit log cleanup (removes entries > 90 days old)
  startAuditCleanup();

  // Cleanup expired TOTP challenges every 10 minutes
  cleanupExpiredChallenges();
  setInterval(cleanupExpiredChallenges, 10 * 60 * 1000);
});
