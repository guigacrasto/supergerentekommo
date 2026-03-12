import { Router } from "express";
import { getTeamConfigsFromTenant } from "../../config.js";
import { getCrmMetrics } from "../cache/crm-cache.js";
import { KommoService } from "../../services/kommo.js";
import { AuthRequest } from "../middleware/requireAuth.js";
import { supabase } from "../supabase.js";

export function metricasRouter() {
  const router = Router();

  // — Helper: parse date range (BRT) —
  function parseDateRange(query: any): { from: string; to: string; fromTs: number; toTs: number } {
    const now = new Date();
    const toStr =
      typeof query.to === "string" && query.to.match(/^\d{4}-\d{2}-\d{2}$/)
        ? query.to
        : now.toISOString().slice(0, 10);
    const fromDate = new Date(now);
    fromDate.setDate(fromDate.getDate() - 30);
    const fromStr =
      typeof query.from === "string" && query.from.match(/^\d{4}-\d{2}-\d{2}$/)
        ? query.from
        : fromDate.toISOString().slice(0, 10);
    const fromTs = new Date(`${fromStr}T00:00:00-03:00`).getTime() / 1000;
    const toTs = new Date(`${toStr}T23:59:59-03:00`).getTime() / 1000;
    return { from: fromStr, to: toStr, fromTs, toTs };
  }

  // — PUT /entries — Upsert gasto diário
  router.put("/entries", async (req: AuthRequest, res) => {
    try {
      const { date, pipeline_id, team, gasto_ads } = req.body;
      if (!date || pipeline_id == null || !team || gasto_ads == null) {
        res.status(400).json({ error: "Campos obrigatórios: date, pipeline_id, team, gasto_ads" });
        return;
      }

      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "Tenant não encontrado" });
        return;
      }

      const { data, error } = await supabase
        .from("metric_entries")
        .upsert(
          {
            tenant_id: tenantId,
            date,
            pipeline_id,
            team,
            gasto_ads,
            updated_by: req.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,date,pipeline_id" }
        )
        .select()
        .single();

      if (error) {
        console.error("[metricas] upsert error:", error);
        res.status(500).json({ error: error.message });
        return;
      }

      res.json(data);
    } catch (err: any) {
      console.error("[metricas] PUT /entries error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // — GET /entries — Lista entries brutas
  router.get("/entries", async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "Tenant não encontrado" });
        return;
      }

      const { from, to } = parseDateRange(req.query);

      const { data, error } = await supabase
        .from("metric_entries")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false });

      if (error) {
        res.status(500).json({ error: error.message });
        return;
      }

      res.json(data || []);
    } catch (err: any) {
      console.error("[metricas] GET /entries error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // — GET /summary — Endpoint principal com CPL/CAC/ROI calculados
  router.get("/summary", async (req: AuthRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        res.status(400).json({ error: "Tenant não encontrado" });
        return;
      }

      const { from, to, fromTs, toTs } = parseDateRange(req.query);
      console.log(`[metricas] summary: tenantId=${tenantId}, from=${from}, to=${to}, fromTs=${fromTs}, toTs=${toTs}`);

      // 1. Buscar entries manuais (gasto ads)
      const { data: entries } = await supabase
        .from("metric_entries")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("date", from)
        .lte("date", to);

      // Build spend map: "pipeline_id:date" -> { gasto_ads, team }
      const spendMap = new Map<string, { gasto_ads: number; team: string }>();
      for (const e of entries || []) {
        spendMap.set(`${e.pipeline_id}:${e.date}`, {
          gasto_ads: Number(e.gasto_ads),
          team: e.team,
        });
      }

      // 2. Buscar dados do Kommo via cache
      const teamConfigs = getTeamConfigsFromTenant(req.tenant);
      console.log(`[metricas] teamConfigs keys: ${Object.keys(teamConfigs).join(', ')}, tenant has settings: ${!!req.tenant?.settings}`);
      const allSnapshots: Array<{
        id: number;
        created_at: number;
        closed_at: number;
        status_id: number;
        pipeline_id: number;
        price: number;
      }> = [];
      const pipelineNames: Record<number, string> = {};
      const pipelineTeams: Record<number, string> = {};

      for (const [teamKey, tc] of Object.entries(teamConfigs)) {
        if (!tc.subdomain) continue;
        const service = new KommoService(tc, teamKey, req.tenantId);
        const metrics = await getCrmMetrics(teamKey, service, req.tenantId, tc.excludePipelineNames);

        Object.assign(pipelineNames, metrics.pipelineNames);

        // Map pipelines to teams
        for (const pId of Object.keys(metrics.pipelineNames)) {
          pipelineTeams[Number(pId)] = teamKey;
        }

        console.log(`[metricas] team=${teamKey}: ${metrics.leadSnapshots.length} snapshots, ${Object.keys(metrics.pipelineNames).length} pipelines`);

        // Filter snapshots by date range
        for (const snap of metrics.leadSnapshots) {
          if (snap.created_at >= fromTs && snap.created_at <= toTs) {
            allSnapshots.push(snap);
          } else if (snap.closed_at && snap.closed_at >= fromTs && snap.closed_at <= toTs) {
            allSnapshots.push(snap);
          }
        }
      }

      console.log(`[metricas] allSnapshots after filter: ${allSnapshots.length}, spendMap: ${spendMap.size}`);

      // 3. Build daily rows per pipeline
      const WON_STATUS = 142;
      const dailyMap = new Map<string, {
        date: string;
        pipeline_id: number;
        pipeline_name: string;
        team: string;
        gasto: number;
        leads: number;
        vendas: number;
        receita: number;
      }>();

      // Helper: get date string (BRT) from unix timestamp
      function toBrtDate(ts: number): string {
        const d = new Date(ts * 1000);
        // BRT = UTC-3
        d.setHours(d.getHours() - 3);
        return d.toISOString().slice(0, 10);
      }

      // Count leads (by created_at) and vendas/receita (by closed_at)
      for (const snap of allSnapshots) {
        const createdDate = toBrtDate(snap.created_at);
        const pId = snap.pipeline_id;
        const key = `${pId}:${createdDate}`;

        if (!dailyMap.has(key)) {
          const spend = spendMap.get(key);
          dailyMap.set(key, {
            date: createdDate,
            pipeline_id: pId,
            pipeline_name: pipelineNames[pId] || `Pipeline ${pId}`,
            team: spend?.team || pipelineTeams[pId] || "",
            gasto: spend?.gasto_ads || 0,
            leads: 0,
            vendas: 0,
            receita: 0,
          });
        }

        // Count as new lead
        if (snap.created_at >= fromTs && snap.created_at <= toTs) {
          const row = dailyMap.get(key)!;
          row.leads++;
        }

        // Count won deals
        if (snap.status_id === WON_STATUS && snap.closed_at) {
          const closedDate = toBrtDate(snap.closed_at);
          if (closedDate >= from && closedDate <= to) {
            const closedKey = `${pId}:${closedDate}`;
            if (!dailyMap.has(closedKey)) {
              const spend = spendMap.get(closedKey);
              dailyMap.set(closedKey, {
                date: closedDate,
                pipeline_id: pId,
                pipeline_name: pipelineNames[pId] || `Pipeline ${pId}`,
                team: spend?.team || pipelineTeams[pId] || "",
                gasto: spend?.gasto_ads || 0,
                leads: 0,
                vendas: 0,
                receita: 0,
              });
            }
            const closedRow = dailyMap.get(closedKey)!;
            closedRow.vendas++;
            closedRow.receita += snap.price || 0;
          }
        }
      }

      // Also ensure spend-only entries appear (even if no leads/vendas)
      for (const [key, spend] of spendMap) {
        if (!dailyMap.has(key)) {
          const [pIdStr, date] = key.split(":");
          const pId = Number(pIdStr);
          dailyMap.set(key, {
            date,
            pipeline_id: pId,
            pipeline_name: pipelineNames[pId] || `Pipeline ${pId}`,
            team: spend.team,
            gasto: spend.gasto_ads,
            leads: 0,
            vendas: 0,
            receita: 0,
          });
        }
      }

      // 4. Calculate CPL, CAC, ROI per row
      const daily = Array.from(dailyMap.values())
        .map((row) => ({
          ...row,
          cpl: row.leads > 0 ? row.gasto / row.leads : 0,
          cac: row.vendas > 0 ? row.gasto / row.vendas : 0,
          roi: row.gasto > 0 ? ((row.receita - row.gasto) / row.gasto) * 100 : 0,
        }))
        .sort((a, b) => b.date.localeCompare(a.date) || a.pipeline_name.localeCompare(b.pipeline_name));

      // 5. Totals
      const totals = daily.reduce(
        (acc, r) => {
          acc.gasto += r.gasto;
          acc.leads += r.leads;
          acc.vendas += r.vendas;
          acc.receita += r.receita;
          return acc;
        },
        { gasto: 0, leads: 0, vendas: 0, receita: 0 }
      );

      const totalCpl = totals.leads > 0 ? totals.gasto / totals.leads : 0;
      const totalCac = totals.vendas > 0 ? totals.gasto / totals.vendas : 0;
      const totalRoi = totals.gasto > 0 ? ((totals.receita - totals.gasto) / totals.gasto) * 100 : 0;

      // 6. Pipeline list for reference
      const pipelines = Object.entries(pipelineNames).map(([id, name]) => ({
        id: Number(id),
        name,
        team: pipelineTeams[Number(id)] || "",
      }));

      res.json({
        daily,
        totals: { ...totals, cpl: totalCpl, cac: totalCac, roi: totalRoi },
        pipelines,
      });
    } catch (err: any) {
      console.error("[metricas] GET /summary error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
