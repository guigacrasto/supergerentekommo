import { kommoConfig, validateConfig, PORT } from "../config.js";
import { KommoService } from "../services/kommo.js";
import { createServer } from "./server.js";
import { getCrmMetrics } from "./cache/crm-cache.js";

validateConfig();

const service = new KommoService(kommoConfig);
const app = createServer(service);

app.listen(PORT, () => {
  console.log(`Web server rodando em http://localhost:${PORT}`);
  // Warm-up cache in background — starts fetching CRM data immediately on boot
  getCrmMetrics(service).catch((e) =>
    console.error("[WarmUp] Erro ao pré-carregar cache:", e)
  );
});
