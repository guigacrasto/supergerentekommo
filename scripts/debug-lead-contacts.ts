/**
 * Debug: verificar onde está o telefone/email — se é no contato ou custom field
 * Checa leads novos (remanejados) e seus leads antigos correspondentes
 */
import dotenv from "dotenv";
dotenv.config();

import { KommoService } from "../src/services/kommo.js";
import { TEAMS } from "../src/config.js";

async function debug(): Promise<void> {
  const service = new KommoService(TEAMS.amarela, "amarela");
  await service.loadStoredToken();

  // Pegar alguns leads criados hoje pela automação que estão SEM contato
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const startWindow = new Date(today);
  startWindow.setUTCHours(7, 9, 0, 0); // 04:09 BRT
  const endWindow = new Date(today);
  endWindow.setUTCHours(7, 45, 0, 0); // 04:45 BRT

  const newLeads = await service.getLeads({
    filter: {
      created_at: {
        from: Math.floor(startWindow.getTime() / 1000),
        to: Math.floor(endWindow.getTime() / 1000),
      },
    },
  });

  const semContato = newLeads.filter(
    (l: any) => !l._embedded?.contacts || l._embedded.contacts.length === 0
  );

  console.log(`Total leads novos: ${newLeads.length}, sem contato: ${semContato.length}`);

  // Checar 5 leads SEM contato — ver custom fields
  console.log("\n--- LEADS NOVOS SEM CONTATO (custom fields) ---");
  for (const lead of semContato.slice(0, 5)) {
    console.log(`\nLead ${lead.id} ("${lead.name}")`);
    console.log(`  Status: ${lead.status_id}, Pipeline: ${lead.pipeline_id}`);
    console.log(`  Contatos: ${lead._embedded?.contacts?.length || 0}`);
    console.log(`  Custom fields:`);
    if (lead.custom_fields_values) {
      for (const cf of lead.custom_fields_values) {
        const vals = cf.values?.map((v: any) => v.value).join(", ");
        console.log(`    [${cf.field_id}] ${cf.field_name}: ${vals}`);
      }
    } else {
      console.log(`    (nenhum)`);
    }

    // Buscar lead antigo fechado com mesmo nome
    const name = (lead.name || "").trim();
    if (name) {
      try {
        const oldLeads = await service.getLeads({
          filter: {
            statuses: [{ status_id: 143 }],
            query: name,
          },
        });
        const match = oldLeads.find((ol: any) =>
          (ol.name || "").trim().toLowerCase() === name.toLowerCase() && ol.id !== lead.id
        );
        if (match) {
          console.log(`  Lead antigo encontrado: ${match.id}`);
          console.log(`    Contatos antigo: ${match._embedded?.contacts?.length || 0}`);
          if (match._embedded?.contacts?.length > 0) {
            for (const c of match._embedded.contacts) {
              // Buscar detalhes do contato
              try {
                const contactResp = await service.client.get(`/contacts/${c.id}`, {
                  params: { with: "custom_fields_values" },
                });
                const contact = contactResp.data;
                console.log(`    Contato ${c.id}: ${contact.name}`);
                if (contact.custom_fields_values) {
                  for (const cf of contact.custom_fields_values) {
                    const vals = cf.values?.map((v: any) => v.value).join(", ");
                    console.log(`      ${cf.field_name}: ${vals}`);
                  }
                }
              } catch (e: any) {
                console.log(`    Contato ${c.id}: erro ao buscar: ${e.message}`);
              }
            }
          }
          console.log(`    Custom fields antigo:`);
          if (match.custom_fields_values) {
            for (const cf of match.custom_fields_values) {
              const vals = cf.values?.map((v: any) => v.value).join(", ");
              console.log(`      [${cf.field_id}] ${cf.field_name}: ${vals}`);
            }
          }
        } else {
          console.log(`  Lead antigo com mesmo nome: NÃO ENCONTRADO`);
        }
      } catch (e: any) {
        console.log(`  Erro ao buscar lead antigo: ${e.message}`);
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // Checar 2 leads COM contato pra comparar
  const comContato = newLeads.filter(
    (l: any) => l._embedded?.contacts?.length > 0
  );
  console.log(`\n--- LEADS NOVOS COM CONTATO (comparação) ---`);
  for (const lead of comContato.slice(0, 2)) {
    console.log(`\nLead ${lead.id} ("${lead.name}")`);
    console.log(`  Contatos: ${lead._embedded?.contacts?.length}`);
    for (const c of lead._embedded.contacts) {
      try {
        const contactResp = await service.client.get(`/contacts/${c.id}`, {
          params: { with: "custom_fields_values" },
        });
        const contact = contactResp.data;
        console.log(`  Contato ${c.id}: ${contact.name}`);
        if (contact.custom_fields_values) {
          for (const cf of contact.custom_fields_values) {
            const vals = cf.values?.map((v: any) => v.value).join(", ");
            console.log(`    ${cf.field_name}: ${vals}`);
          }
        }
      } catch (e: any) {
        console.log(`  Contato ${c.id}: erro: ${e.message}`);
      }
    }
  }
}

debug()
  .then(() => console.log("\nDone!"))
  .catch((e) => console.error("Erro:", e));
