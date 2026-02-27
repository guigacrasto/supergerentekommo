import { TEAMS, validateConfig, PORT } from "../config.js";
import { KommoService } from "../services/kommo.js";
import { createServer } from "./server.js";
import { getCrmMetrics } from "./cache/crm-cache.js";

validateConfig();

const services = {
  azul: new KommoService(TEAMS.azul, "azul"),
  amarela: new KommoService(TEAMS.amarela, "amarela"),
};

const app = createServer(services);

app.listen(PORT, async () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);
  await services.azul.loadStoredToken();
  if (TEAMS.amarela.subdomain) {
    await services.amarela.loadStoredToken();
  }
  // Warm-up caches in background
  getCrmMetrics("azul", services.azul).catch((e) =>
    console.error("[WarmUp:azul] Erro ao pré-carregar cache:", e)
  );
  if (TEAMS.amarela.subdomain) {
    getCrmMetrics("amarela", services.amarela).catch((e) =>
      console.error("[WarmUp:amarela] Erro ao pré-carregar cache:", e)
    );
  }
});
