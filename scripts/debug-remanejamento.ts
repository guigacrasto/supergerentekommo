/**
 * Debug: verificar quantos leads fechados hoje têm nota de remanejamento
 * e por que muitos podem estar escapando do filtro
 */
import dotenv from "dotenv";
dotenv.config();

import { KommoService } from "../src/services/kommo.js";
import { TEAMS, TeamKey } from "../src/config.js";

async function debug(): Promise<void> {
  for (const team of ["azul", "amarela"] as TeamKey[]) {
    if (!TEAMS[team].subdomain) continue;

    console.log(`\n=== ${team.toUpperCase()} ===`);
    const service = new KommoService(TEAMS[team], team);
    await service.loadStoredToken();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(todayStart.getTime() / 1000);

    const closedLeads = await service.getLeads({
      filter: {
        statuses: [{ status_id: 143 }],
        updated_at: { from: todayTimestamp },
      },
    });

    console.log(`Total leads fechados hoje: ${closedLeads.length}`);

    let comNota = 0;
    let semNota = 0;
    let comContato = 0;
    let semContato = 0;
    const notaSamples: string[] = [];

    // Checar os primeiros 30 para debug
    const sample = closedLeads.slice(0, 30);
    for (const lead of sample) {
      const notes = await service.getLeadNotes(lead.id);
      const hasRemanej = notes.some((n: any) => {
        const text = n.params?.text || n.text || "";
        return text.includes("SuperGerente") || text.includes("remanejado") || text.includes("remanejamento");
      });

      if (hasRemanej) {
        comNota++;
        // Mostrar formato da nota
        const matchNote = notes.find((n: any) => {
          const text = n.params?.text || n.text || "";
          return text.includes("SuperGerente") || text.includes("remanejado");
        });
        if (notaSamples.length < 3) {
          notaSamples.push(JSON.stringify({
            id: lead.id,
            name: lead.name,
            note_type: matchNote?.note_type,
            text: matchNote?.params?.text || matchNote?.text,
            params: matchNote?.params,
          }, null, 2));
        }
      } else {
        semNota++;
        // Mostrar notas desse lead pra ver o que tem
        if (semNota <= 2) {
          console.log(`\nLead ${lead.id} ("${lead.name}") - SEM nota de remanejamento`);
          console.log(`  Notas (${notes.length}):`);
          for (const n of notes.slice(0, 3)) {
            console.log(`    type=${n.note_type}, text="${(n.params?.text || n.text || "").substring(0, 100)}"`);
          }
        }
      }

      if (lead._embedded?.contacts?.length > 0) comContato++;
      else semContato++;

      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`\nDos ${sample.length} primeiros leads fechados:`);
    console.log(`  COM nota remanejamento: ${comNota}`);
    console.log(`  SEM nota remanejamento: ${semNota}`);
    console.log(`  COM contatos no lead antigo: ${comContato}`);
    console.log(`  SEM contatos no lead antigo: ${semContato}`);

    if (notaSamples.length > 0) {
      console.log(`\nExemplos de notas encontradas:`);
      notaSamples.forEach(s => console.log(s));
    }
  }
}

debug()
  .then(() => console.log("\nDone!"))
  .catch((e) => console.error("Erro:", e));
