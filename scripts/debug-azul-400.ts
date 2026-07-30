import dotenv from "dotenv";
dotenv.config();

const { KommoService } = await import("../src/services/kommo.js");
const { TEAMS } = await import("../src/config.js");

const service = new KommoService(TEAMS.azul, "azul");
await service.loadStoredToken();

// Buscar detalhes do lead 8953474
console.log("Buscando lead 8953474...");
const lead = await service.getLeadDetails(8953474);
console.log("Lead 8953474:");
console.log("  name:", lead.name);
console.log("  pipeline_id:", lead.pipeline_id);
console.log("  status_id:", lead.status_id);
console.log("  responsible_user_id:", lead.responsible_user_id);
console.log("  custom_fields count:", lead.custom_fields_values?.length || 0);
if (lead.custom_fields_values) {
  for (const cf of lead.custom_fields_values) {
    console.log(`  CF: ${cf.field_name || cf.field_code || cf.field_id} = ${JSON.stringify(cf.values?.[0]?.value)}`);
  }
}

// Tentar criar lead minimo (sem custom fields)
console.log("\nTentando criar lead MINIMO (sem custom fields)...");
try {
  const result = await service.client.post("/leads", [{
    name: "TESTE REMANEJAMENTO",
    pipeline_id: 12849347,
    status_id: 100431683,
  }]);
  const created = result.data?._embedded?.leads?.[0];
  console.log("Lead criado OK! ID:", created?.id);

  // Limpar: fechar como perdido
  await service.closeLeadAsLost(created.id);
  console.log("Lead de teste fechado.");
} catch (e: any) {
  console.log("Erro ao criar lead minimo:");
  console.log("  Status:", e.response?.status);
  console.log("  Body:", JSON.stringify(e.response?.data, null, 2));
}

// Tentar com custom fields do lead original
console.log("\nTentando criar lead COM custom fields...");
try {
  const data: any = {
    name: lead.name || "TESTE",
    pipeline_id: lead.pipeline_id,
    status_id: 100431683,
    responsible_user_id: lead.responsible_user_id,
  };
  if (lead.custom_fields_values) data.custom_fields_values = lead.custom_fields_values;

  const result = await service.client.post("/leads", [data]);
  const created = result.data?._embedded?.leads?.[0];
  console.log("Lead criado OK! ID:", created?.id);
  await service.closeLeadAsLost(created.id);
  console.log("Lead de teste fechado.");
} catch (e: any) {
  console.log("Erro ao criar lead com custom fields:");
  console.log("  Status:", e.response?.status);
  console.log("  Body:", JSON.stringify(e.response?.data, null, 2));
}
