/**
 * Fix v2: encontra leads NOVOS criados pelo remanejamento hoje (04h),
 * verifica quais NÃO têm contatos vinculados, e busca o lead antigo
 * (fechado, mesmo nome) para vincular os contatos.
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

    // Janela de criação: hoje entre 04:00 e 04:30 BRT (07:00-07:30 UTC)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startWindow = new Date(today);
    startWindow.setUTCHours(7, 0, 0, 0); // 04:00 BRT
    const endWindow = new Date(today);
    endWindow.setUTCHours(7, 30, 0, 0); // 04:30 BRT

    const startTs = Math.floor(startWindow.getTime() / 1000);
    const endTs = Math.floor(endWindow.getTime() / 1000);

    console.log(`Buscando leads criados entre ${startWindow.toISOString()} e ${endWindow.toISOString()}`);

    // Buscar TODOS os leads criados hoje (não só os fechados)
    const allLeads = await service.getLeads({
      filter: {
        created_at: { from: startTs, to: endTs },
      },
    });

    console.log(`Leads criados na janela: ${allLeads.length}`);

    // Filtrar os que NÃO têm contatos
    const semContato = allLeads.filter(
      (l: any) => !l._embedded?.contacts || l._embedded.contacts.length === 0
    );

    console.log(`Sem contatos vinculados: ${semContato.length}`);

    if (semContato.length === 0) {
      console.log("Nada para corrigir!");
      continue;
    }

    // Para cada lead sem contato, buscar o lead antigo fechado com mesmo nome
    // Primeiro, pegar todos os leads fechados hoje para fazer match por nome
    const closedLeads = await service.getLeads({
      filter: {
        statuses: [{ status_id: 143 }],
        updated_at: { from: Math.floor(today.getTime() / 1000) },
      },
    });

    console.log(`Leads fechados hoje (pool de match): ${closedLeads.length}`);

    // Criar mapa nome → lead antigo (com contatos)
    const closedByName = new Map<string, any>();
    for (const cl of closedLeads) {
      const name = (cl.name || "").trim().toLowerCase();
      if (name && cl._embedded?.contacts?.length > 0 && !closedByName.has(name)) {
        closedByName.set(name, cl);
      }
    }

    console.log(`Leads fechados COM contatos (para match): ${closedByName.size}`);

    let fixed = 0;
    let noMatch = 0;

    for (const newLead of semContato) {
      const name = (newLead.name || "").trim().toLowerCase();
      const oldLead = closedByName.get(name);

      if (!oldLead) {
        noMatch++;
        continue;
      }

      const contacts = oldLead._embedded.contacts;
      console.log(`Lead ${newLead.id} ("${newLead.name}") — vinculando ${contacts.length} contato(s) do lead antigo ${oldLead.id}...`);

      for (const contact of contacts) {
        try {
          await service.client.post(`/leads/${newLead.id}/link`, [
            { to_entity_id: contact.id, to_entity_type: "contacts" },
          ]);
          console.log(`  ✓ Contato ${contact.id} vinculado`);
        } catch (err: any) {
          if (err?.response?.status === 400) {
            console.log(`  - Contato ${contact.id} já vinculado`);
          } else {
            console.error(`  ✗ Erro: ${err.message}`);
          }
        }
      }

      fixed++;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`\n${team}: ${fixed} leads corrigidos, ${noMatch} sem match de nome`);
  }
}

fix()
  .then(() => console.log("\nDone!"))
  .catch((e) => console.error("Erro:", e));
