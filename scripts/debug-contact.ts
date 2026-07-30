/**
 * Debug: inspeciona contatos do lead antigo e do novo
 */
import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");

async function main() {
  // Lead antigo: 8980408, Lead novo: 26307993 (amarela)
  const svc = new KommoService(TEAMS.amarela, "amarela");
  await svc.loadStoredToken();

  // 1. Lead ANTIGO com todos os detalhes
  console.log("=== LEAD ANTIGO 8980408 ===\n");
  const oldRes = await svc.client.get("/leads/8980408", {
    params: { with: "contacts,custom_fields_values" },
  });
  const oldLead = oldRes.data;
  console.log("Contatos embedded:", JSON.stringify(oldLead._embedded?.contacts, null, 2));
  console.log("\nCustom fields:", JSON.stringify(oldLead.custom_fields_values, null, 2));

  // 2. Buscar contato direto
  const contacts = oldLead._embedded?.contacts || [];
  if (contacts.length > 0) {
    const contactId = contacts[0].id;
    console.log(`\n=== CONTATO ${contactId} — DETALHES ===\n`);
    const cRes = await svc.client.get(`/contacts/${contactId}`, {
      params: { with: "custom_fields_values" },
    });
    console.log(JSON.stringify(cRes.data, null, 2));
  }

  // 3. Lead NOVO
  console.log("\n=== LEAD NOVO 26307993 ===\n");
  const newRes = await svc.client.get("/leads/26307993", {
    params: { with: "contacts,custom_fields_values" },
  });
  const newLead = newRes.data;
  console.log("Contatos embedded:", JSON.stringify(newLead._embedded?.contacts, null, 2));
  console.log("Custom fields:", JSON.stringify(newLead.custom_fields_values, null, 2));
}

main().catch(e => {
  console.error("❌ ERRO:", e.message);
  process.exit(1);
});
