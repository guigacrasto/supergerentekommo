/**
 * Script para corrigir leads remanejados hoje que ficaram sem contatos.
 * Busca leads fechados com nota "[SuperGerente] Lead remanejado",
 * extrai o ID do lead novo e vincula os contatos do lead antigo.
 */
import dotenv from "dotenv";
dotenv.config();

import { KommoService } from "../src/services/kommo.js";
import { TEAMS, TeamKey } from "../src/config.js";

async function fixContacts(): Promise<void> {
  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n=== ${team.toUpperCase()} ===`);
    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    // Buscar leads fechados (status 143 = perdido) atualizados hoje
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(todayStart.getTime() / 1000);

    const closedLeads = await service.getLeads({
      filter: {
        statuses: [{ status_id: 143 }],
        updated_at: { from: todayTimestamp },
      },
    });

    console.log(`Encontrados ${closedLeads.length} leads fechados hoje`);

    let fixed = 0;

    for (const oldLead of closedLeads) {
      // Verificar se tem nota do remanejamento
      const notes = await service.getLeadNotes(oldLead.id);
      const remanejNote = notes.find((n: any) =>
        (n.params?.text || "").includes("[SuperGerente] Lead remanejado")
      );

      if (!remanejNote) continue;

      const noteText: string = remanejNote.params?.text || "";
      const match = noteText.match(/Novo lead ID: (\d+)/);
      if (!match) {
        console.log(`Lead ${oldLead.id}: nota encontrada mas sem ID do novo lead`);
        continue;
      }

      const newLeadId = parseInt(match[1], 10);
      const contacts = oldLead._embedded?.contacts;

      if (!contacts || contacts.length === 0) {
        console.log(`Lead ${oldLead.id} → ${newLeadId}: lead antigo sem contatos, pulando`);
        continue;
      }

      console.log(`Lead ${oldLead.id} ("${oldLead.name}") → ${newLeadId}: vinculando ${contacts.length} contato(s)...`);

      for (const contact of contacts) {
        try {
          await service.client.post(`/leads/${newLeadId}/link`, [
            { to_entity_id: contact.id, to_entity_type: "contacts" },
          ]);
          console.log(`  ✓ Contato ${contact.id} vinculado ao lead ${newLeadId}`);
        } catch (err: any) {
          // 400 = ja vinculado, tudo bem
          if (err?.response?.status === 400) {
            console.log(`  - Contato ${contact.id} já vinculado`);
          } else {
            console.error(`  ✗ Erro ao vincular contato ${contact.id}: ${err.message}`);
          }
        }
      }

      fixed++;
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`${team}: ${fixed} leads corrigidos`);
  }
}

fixContacts()
  .then(() => console.log("\nDone!"))
  .catch((e) => console.error("Erro:", e));
