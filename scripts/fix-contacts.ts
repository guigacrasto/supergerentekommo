/**
 * Corrige os leads de teste: vincula contatos do lead antigo ao lead novo
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
  console.log("🔧 CORRIGINDO CONTATOS DOS LEADS DE TESTE\n");

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
      const oldLead = oldRes.data;
      const contacts = oldLead?._embedded?.contacts || [];

      if (contacts.length === 0) {
        console.log(`⚪ Lead ${item.oldId} (${item.team}) — sem contatos pra copiar`);
        continue;
      }

      // 2. Vincular contatos ao lead novo via PATCH
      const contactIds = contacts.map((c: any) => ({ id: c.id }));
      await svc.client.patch(`/leads/${item.newId}`, {
        _embedded: { contacts: contactIds },
      });

      console.log(`✅ Lead novo ${item.newId} (${item.team}) — ${contactIds.length} contato(s) vinculado(s): ${contactIds.map((c: any) => c.id).join(", ")}`);
    } catch (e: any) {
      console.log(`❌ Lead ${item.newId} (${item.team}) — Erro: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n🏁 Correção concluída.");
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
