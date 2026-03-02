import { TEAMS, validateConfig, PORT } from "../config.js";
import { KommoService } from "../services/kommo.js";
import { createServer } from "./server.js";
import { getCrmMetrics } from "./cache/crm-cache.js";
import { markCacheReady } from "./readiness.js";

validateConfig();

const services = {
  azul: new KommoService(TEAMS.azul, "azul"),
  amarela: new KommoService(TEAMS.amarela, "amarela"),
};

const app = createServer(services);

const REFRESH_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20 hours

async function refreshAllTokens() {
  console.log("[Scheduler] Verificando tokens Kommo...");
  await services.azul.proactiveRefresh();
  if (TEAMS.amarela.subdomain) {
    await services.amarela.proactiveRefresh();
  }
}

app.listen(PORT, async () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);
  await services.azul.loadStoredToken();
  if (TEAMS.amarela.subdomain) {
    await services.amarela.loadStoredToken();
  }
  // Refresh proactively on startup if token is near expiry or expiry is unknown
  await refreshAllTokens();
  // Schedule proactive refresh every 20 hours
  setInterval(refreshAllTokens, REFRESH_INTERVAL_MS);

  // Warm-up caches synchronously — health only becomes ready after this
  console.log("[WarmUp] Pré-carregando cache de métricas...");
  try {
    const warmups: Promise<unknown>[] = [getCrmMetrics("azul", services.azul)];
    if (TEAMS.amarela.subdomain) {
      warmups.push(getCrmMetrics("amarela", services.amarela));
    }
    await Promise.all(warmups);
    console.log("[WarmUp] Cache aquecido com sucesso");
  } catch (e) {
    console.error("[WarmUp] Erro ao aquecer cache (continuando mesmo assim):", e);
  }
  markCacheReady();
});
