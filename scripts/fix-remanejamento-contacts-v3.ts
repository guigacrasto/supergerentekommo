/**
 * Fix v3: para cada lead novo sem contato, busca o lead antigo
 * individualmente por nome (query) e vincula os contatos.
 */
import dotenv from "dotenv";
dotenv.config();

import { KommoService } from "../src/services/kommo.js";
import { TEAMS, TeamKey } from "../src/config.js";

async function fix(): Promise<void> {
  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n=== ${team.toUpperCase()} ===`);
    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    // Janela: 04:09 a 04:45 BRT
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startWindow = new Date(today);
    startWindow.setUTCHours(7, 9, 0, 0);
    const endWindow = new Date(today);
    endWindow.setUTCHours(7, 45, 0, 0);

    const startTs = Math.floor(startWindow.getTime() / 1000);
    const endTs = Math.floor(endWindow.getTime() / 1000);

    const newLeads = await service.getLeads({
      filter: {
        created_at: { from: startTs, to: endTs },
      },
    });

    const semContato = newLeads.filter(
      (l: any) => !l._embedded?.contacts || l._embedded.contacts.length === 0
    );

    console.log(`Leads criados na janela: ${newLeads.length}`);
    console.log(`Sem contatos: ${semContato.length}`);

    let fixed = 0;
    let noMatch = 0;
    let errors = 0;

    for (let i = 0; i < semContato.length; i++) {
      const newLead = semContato[i];
      const name = (newLead.name || "").trim();

      if (!name) {
        noMatch++;
        continue;
      }

      if ((i + 1) % 50 === 0) {
        console.log(`Progresso: ${i + 1}/${semContato.length} (fixed: ${fixed}, noMatch: ${noMatch})`);
      }

      try {
        // Buscar lead antigo fechado por nome
        const oldLeads = await service.getLeads({
          filter: {
            statuses: [{ status_id: 143 }],
            query: name,
          },
        });

        // Encontrar match exato pelo nome (excluindo o próprio lead)
        const match = oldLeads.find((ol: any) =>
          (ol.name || "").trim().toLowerCase() === name.toLowerCase() &&
          ol.id !== newLead.id &&
          ol._embedded?.contacts?.length > 0
        );

        if (!match) {
          noMatch++;
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }

        const contacts = match._embedded.contacts;

        for (const contact of contacts) {
          try {
            await service.client.post(`/leads/${newLead.id}/link`, [
              { to_entity_id: contact.id, to_entity_type: "contacts" },
            ]);
          } catch (err: any) {
            if (err?.response?.status !== 400) {
              console.error(`  Erro lead ${newLead.id} contato ${contact.id}: ${err.message}`);
            }
          }
        }

        fixed++;
        if (fixed % 20 === 0) {
          console.log(`✓ ${fixed} leads corrigidos até agora...`);
        }
      } catch (err: any) {
        errors++;
        console.error(`Erro processando lead ${newLead.id}: ${err.message}`);
      }

      // Rate limit: 200ms entre requests
      await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`\n${team}: ${fixed} corrigidos, ${noMatch} sem match, ${errors} erros`);
  }
}

fix()
  .then(() => console.log("\nDone!"))
  .catch((e) => console.error("Erro:", e));
