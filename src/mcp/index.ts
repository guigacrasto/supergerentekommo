import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { kommoConfig, validateConfig } from "../config.js";
import { KommoService } from "../services/kommo.js";

const STATUS = { WON: 142, LOST: 143 };

validateConfig();

const kommoService = new KommoService(kommoConfig, "azul");

const server = new Server(
  { name: "kommo-mcp-agent", version: "1.0.0" },
  { capabilities: { resources: {}, tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_recent_leads",
      description: "Retorna os leads mais recentes do Kommo CRM",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Quantidade de leads (padrão: 10)" },
        },
      },
    },
    {
      name: "get_lead_details",
      description: "Retorna detalhes de um lead específico",
      inputSchema: {
        type: "object",
        properties: {
          lead_id: { type: "number", description: "ID do lead" },
        },
        required: ["lead_id"],
      },
    },
    {
      name: "get_lead_notes",
      description: "Retorna notas e histórico de um lead",
      inputSchema: {
        type: "object",
        properties: {
          lead_id: { type: "number", description: "ID do lead" },
        },
        required: ["lead_id"],
      },
    },
    {
      name: "add_lead_note",
      description: "Adiciona uma nota a um lead",
      inputSchema: {
        type: "object",
        properties: {
          lead_id: { type: "number", description: "ID do lead" },
          text: { type: "string", description: "Texto da nota" },
        },
        required: ["lead_id", "text"],
      },
    },
    {
      name: "get_team_report",
      description: "Gera relatório de desempenho da equipe",
      inputSchema: {
        type: "object",
        properties: {
          days: { type: "number", description: "Período em dias (padrão: 30)" },
          limit: { type: "number", description: "Limite de eventos por categoria (padrão: 100, máx: 500)" },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "get_recent_leads") {
      const limit = args?.limit ? Number(args.limit) : 10;
      const leads = await kommoService.getRecentLeads(limit);
      return { content: [{ type: "text", text: JSON.stringify(leads, null, 2) }] };
    }

    if (name === "get_lead_details") {
      const leadId = Number(args?.lead_id);
      if (!leadId) throw new Error("lead_id obrigatório");
      const lead = await kommoService.getLeadDetails(leadId);
      return { content: [{ type: "text", text: JSON.stringify(lead, null, 2) }] };
    }

    if (name === "get_lead_notes") {
      const leadId = Number(args?.lead_id);
      if (!leadId) throw new Error("lead_id obrigatório");
      const notes = await kommoService.getLeadNotes(leadId);
      return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
    }

    if (name === "add_lead_note") {
      const leadId = Number(args?.lead_id);
      const text = args?.text as string;
      if (!leadId || !text) throw new Error("lead_id e text são obrigatórios");
      const result = await kommoService.addNote(leadId, text);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "get_team_report") {
      const days = args?.days ? Number(args.days) : 30;
      const limit = args?.limit ? Math.min(Number(args.limit), 500) : 100;
      const timestamp = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

      const [users, pipelines, leadsCreated, leadsUpdated, activeLeads, events] =
        await Promise.all([
          kommoService.getUsers(),
          kommoService.getPipelines(),
          kommoService.getLeads({ filter: { created_at: { from: timestamp } }, limit }),
          kommoService.getLeads({ filter: { updated_at: { from: timestamp }, status: [STATUS.WON, STATUS.LOST] }, limit }),
          kommoService.getLeads({ limit }),
          kommoService.getEvents({ limit }),
        ]);

      const userMap = new Map<number, string>();
      users.forEach(u => userMap.set(u.id, u.name));

      const stats: any = {};
      users.forEach(u => {
        stats[u.id] = { name: u.name, responses: 0, notes: 0, moves: 0, sales_won: 0, sales_lost: 0, leads_received: 0 };
      });
      stats[0] = { name: "Sistema/Automação", responses: 0, notes: 0, moves: 0, sales_won: 0, sales_lost: 0, leads_received: 0 };

      events.forEach(event => {
        const userId = event.created_by || 0;
        if (!stats[userId]) {
          stats[userId] = { name: userMap.get(userId) || `User ${userId}`, responses: 0, notes: 0, moves: 0, sales_won: 0, sales_lost: 0, leads_received: 0 };
        }
        const type = event.type;
        if (type === "outgoing_chat_message" || type === "transport_message") stats[userId].responses++;
        else if (["common_note", "note_added", "service_note_added", "task_result_added"].includes(type)) stats[userId].notes++;
        else if (type === "lead_status_changed") stats[userId].moves++;
      });

      leadsCreated.forEach(lead => {
        const userId = lead.responsible_user_id || 0;
        if (stats[userId]) stats[userId].leads_received++;
      });

      leadsUpdated.forEach(lead => {
        const userId = lead.responsible_user_id || 0;
        if (stats[userId]) {
          if (lead.status_id === STATUS.WON) stats[userId].sales_won++;
          if (lead.status_id === STATUS.LOST) stats[userId].sales_lost++;
        }
      });

      const pipelineMap: any = {};
      pipelines.forEach((p: any) => {
        pipelineMap[p.id] = { id: p.id, name: p.name, stages: {} };
        p._embedded.statuses.forEach((s: any) => {
          pipelineMap[p.id].stages[s.id] = { name: s.name, count: 0 };
        });
      });

      activeLeads.forEach(lead => {
        const pid = lead.pipeline_id;
        const sid = lead.status_id;
        if (!pipelineMap[pid]) pipelineMap[pid] = { id: pid, name: `Pipeline ${pid}`, stages: {} };
        if (!pipelineMap[pid].stages[sid]) pipelineMap[pid].stages[sid] = { name: `Status ${sid}`, count: 0 };
        pipelineMap[pid].stages[sid].count++;
      });

      const agentMetrics = Object.values(stats)
        .filter((s: any) => s.name !== "Sistema/Automação" && (s.responses + s.notes + s.moves + s.sales_won + s.sales_lost + s.leads_received) > 0)
        .map((s: any) => ({
          agent: s.name,
          leads_received: s.leads_received,
          moves: s.moves,
          sales_won: s.sales_won,
          sales_lost: s.sales_lost,
          activity_score: s.responses + s.notes,
        }));

      const pipelineBreakdown = Object.values(pipelineMap)
        .map((p: any) => ({
          pipeline: p.name,
          total_leads: Object.values(p.stages).reduce((acc: number, s: any) => acc + s.count, 0),
          stages: Object.values(p.stages).filter((s: any) => s.count > 0).sort((a: any, b: any) => b.count - a.count),
        }))
        .filter(p => p.total_leads > 0)
        .sort((a, b) => b.total_leads - a.total_leads);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({ period: `Last ${days} days`, agents: agentMetrics, pipeline_breakdown: pipelineBreakdown }, null, 2),
        }],
      };
    }

    throw new Error(`Tool não encontrado: ${name}`);
  } catch (error: any) {
    return { content: [{ type: "text", text: `Erro: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Kommo MCP Agent rodando via stdio");
}

main().catch(error => {
  console.error("Erro fatal:", error);
  process.exit(1);
});
