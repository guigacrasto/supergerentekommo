/**
 * Corrige contatos: usa endpoint /leads/{id}/link pra vincular contatos
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");

const TEST_LEADS = [
  { oldId: 32599496, newId: 41359434, team: "azul" as const },
  { oldId: 33198954, newId: 41359478, team: "azul" as const },
  { oldId: 32755116, newId: 41359490, team: "azul" as const },
  { oldId: 41291146, newId: 41359494, team: "azul" as const },
  { oldId: 24803886, newId: 41359502, team: "azul" as const },
  { oldId: 38245391, newId: 41359506, team: "azul" as const },
  { oldId: 35536820, newId: 41359518, team: "azul" as const },
  { oldId: 35327160, newId: 41359526, team: "azul" as const },
  { oldId: 8980408, newId: 26307993, team: "amarela" as const },
  { oldId: 9184988, newId: 26308001, team: "amarela" as const },
];

async function main() {
  console.log("🔧 CORRIGINDO CONTATOS — USANDO /link ENDPOINT\n");

  const services: Record<string, any> = {};
  for (const team of ["azul", "amarela"] as const) {
    if (TEAMS[team].subdomain) {
      const svc = new KommoService(TEAMS[team], team);
      await svc.loadStoredToken();
      services[team] = svc;
    }
  }

  for (const item of TEST_LEADS) {
    const svc = services[item.team];
    if (!svc) continue;

    try {
      // 1. Buscar contatos do lead antigo
      const oldRes = await svc.client.get(`/leads/${item.oldId}`, {
        params: { with: "contacts" },
      });
      const contacts = oldRes.data?._embedded?.contacts || [];

      if (contacts.length === 0) {
        console.log(`⚪ Lead antigo ${item.oldId} (${item.team}) — sem contatos`);
        continue;
      }

      // 2. Vincular cada contato ao lead novo via POST /leads/{id}/link
      for (const contact of contacts) {
        try {
          await svc.client.post(`/leads/${item.newId}/link`, [
            { to_entity_id: contact.id, to_entity_type: "contacts" }
          ]);
          console.log(`✅ Lead ${item.newId} (${item.team}) — contato ${contact.id} vinculado`);
        } catch (linkErr: any) {
          // Tentar formato alternativo
          try {
            await svc.client.post(`/leads/${item.newId}/link`, [
              { to_entity_id: contact.id, to_entity_type: "contacts", metadata: { is_main: contact.is_main || false } }
            ]);
            console.log(`✅ Lead ${item.newId} (${item.team}) — contato ${contact.id} vinculado (v2)`);
          } catch (linkErr2: any) {
            console.log(`❌ Lead ${item.newId} — contato ${contact.id}: ${linkErr2?.response?.status} ${linkErr2.message}`);
            console.log(`   Response: ${JSON.stringify(linkErr2?.response?.data)}`);
          }
        }
      }
    } catch (e: any) {
      console.log(`❌ Lead ${item.oldId} (${item.team}) — Erro: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  // Verificar se funcionou
  console.log("\n📋 VERIFICANDO LEAD NOVO 26307993...");
  const svc = services.amarela;
  const verifyRes = await svc.client.get("/leads/26307993", {
    params: { with: "contacts" },
  });
  console.log("Contatos:", JSON.stringify(verifyRes.data?._embedded?.contacts, null, 2));
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
