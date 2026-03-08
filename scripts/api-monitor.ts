/**
 * SuperGerente API Monitor
 *
 * Checa todos os endpoints da API a cada 5 minutos.
 * Requer variáveis: API_URL, MONITOR_EMAIL, MONITOR_PASSWORD
 *
 * Uso:
 *   npx tsx scripts/api-monitor.ts              # roda 1x
 *   npx tsx scripts/api-monitor.ts --watch      # roda a cada 5 min
 *   npx tsx scripts/api-monitor.ts --watch 10   # roda a cada 10 min
 */

const API_URL = process.env.API_URL || "https://www.supergerente.com";
const MONITOR_EMAIL = process.env.MONITOR_EMAIL || "";
const MONITOR_PASSWORD = process.env.MONITOR_PASSWORD || "";

interface CheckResult {
  endpoint: string;
  method: string;
  status: "ok" | "warn" | "fail";
  httpStatus: number;
  responseTimeMs: number;
  message: string;
  data?: Record<string, unknown>;
}

const results: CheckResult[] = [];
let authToken = "";
let authTeam = "";

// ─── Helpers ───────────────────────────────────────────────

async function check(
  name: string,
  method: string,
  path: string,
  opts: {
    body?: Record<string, unknown>;
    auth?: boolean;
    validate?: (data: unknown, status: number) => { ok: boolean; msg: string };
  } = {}
): Promise<CheckResult> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.auth && authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const start = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const elapsed = Date.now() - start;
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // Validação custom
    if (opts.validate) {
      const v = opts.validate(data, res.status);
      const result: CheckResult = {
        endpoint: name,
        method,
        status: v.ok ? "ok" : "fail",
        httpStatus: res.status,
        responseTimeMs: elapsed,
        message: v.msg,
        data: typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined,
      };
      results.push(result);
      return result;
    }

    // Default: 2xx = ok
    const result: CheckResult = {
      endpoint: name,
      method,
      status: res.ok ? "ok" : "fail",
      httpStatus: res.status,
      responseTimeMs: elapsed,
      message: res.ok ? "OK" : `HTTP ${res.status}`,
    };
    results.push(result);
    return result;
  } catch (err) {
    const elapsed = Date.now() - start;
    const result: CheckResult = {
      endpoint: name,
      method,
      status: "fail",
      httpStatus: 0,
      responseTimeMs: elapsed,
      message: err instanceof Error ? err.message : String(err),
    };
    results.push(result);
    return result;
  }
}

// ─── Checks ────────────────────────────────────────────────

async function runAllChecks() {
  results.length = 0;
  const startTime = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SuperGerente API Monitor — ${startTime}`);
  console.log(`  URL: ${API_URL}`);
  console.log(`${"═".repeat(60)}\n`);

  // 1. Health check (público)
  await check("Health", "GET", "/health", {
    validate: (data, status) => {
      const d = data as Record<string, unknown>;
      if (status === 200 && d?.ok === true) {
        const tokens = d?.tokens as Record<string, string> | undefined;
        if (tokens) {
          const expired = Object.entries(tokens).filter(([, s]) => s === "expired");
          const expiring = Object.entries(tokens).filter(([, s]) => s === "expiring");
          const parts: string[] = ["Cache aquecido"];
          if (expired.length > 0) parts.push(`TOKENS EXPIRADOS: ${expired.map(([k]) => k).join(", ")}`);
          if (expiring.length > 0) parts.push(`tokens expirando: ${expiring.map(([k]) => k).join(", ")}`);
          return { ok: expired.length === 0, msg: parts.join(" | ") };
        }
        return { ok: true, msg: "Cache aquecido" };
      }
      if (status === 503) return { ok: false, msg: "Cache ainda esquentando (503)" };
      return { ok: false, msg: `Resposta inesperada: ${JSON.stringify(d)}` };
    },
  });

  // 2. Login (pega token para próximos checks)
  if (MONITOR_EMAIL && MONITOR_PASSWORD) {
    const loginResult = await check("Auth Login", "POST", "/api/auth/login", {
      body: { email: MONITOR_EMAIL, password: MONITOR_PASSWORD },
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status === 200 && d?.token) {
          authToken = d.token as string;
          const user = d.user as Record<string, unknown>;
          authTeam = ((user?.teams as string[]) || [])[0] || "azul";
          return {
            ok: true,
            msg: `Login OK — role=${user?.role}, teams=${(user?.teams as string[])?.join(",")}`,
          };
        }
        return { ok: false, msg: `Login falhou: HTTP ${status} — ${JSON.stringify(d)}` };
      },
    });

    if (loginResult.status === "fail") {
      console.log("⚠️  Sem auth token — checks autenticados serão pulados\n");
    }
  } else {
    console.log("⚠️  MONITOR_EMAIL/PASSWORD não definidos — só checks públicos\n");
  }

  // 3. Pipelines
  if (authToken) {
    await check("Pipelines", "GET", "/api/pipelines", {
      auth: true,
      validate: (data, status) => {
        const d = data as unknown[];
        if (status === 200 && Array.isArray(d) && d.length > 0) {
          return { ok: true, msg: `${d.length} pipelines encontrados` };
        }
        return { ok: false, msg: `Nenhum pipeline: ${JSON.stringify(data)}` };
      },
    });
  }

  // 4. Reports — /all (endpoint principal do dashboard)
  if (authToken) {
    await check("Reports All", "GET", "/api/reports/all", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const summary = d?.summary as unknown[];
        const vendedores = d?.vendedores as unknown[];
        const issues: string[] = [];
        if (!Array.isArray(summary) || summary.length === 0) issues.push("summary vazio");
        if (!Array.isArray(vendedores) || vendedores.length === 0) issues.push("vendedores vazio");
        if (!d?.dashboard) issues.push("dashboard ausente");
        if (!d?.activity) issues.push("activity ausente");
        if (issues.length > 0) return { ok: false, msg: issues.join(", ") };
        return {
          ok: true,
          msg: `${summary.length} funis, ${vendedores.length} vendedores`,
        };
      },
    });
  }

  // 5. Reports — /activity (alertas)
  if (authToken) {
    await check("Reports Activity", "GET", "/api/reports/activity", {
      auth: true,
      validate: (data, status) => {
        const d = data as unknown[];
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (!Array.isArray(d) || d.length === 0) return { ok: false, msg: "Nenhum time retornado" };
        const first = d[0] as Record<string, unknown>;
        const activity = first?.activity as Record<string, unknown>;
        if (!activity?.atualizadoEm) return { ok: false, msg: "atualizadoEm ausente" };
        return {
          ok: true,
          msg: `${d.length} times, atualizado em ${activity.atualizadoEm}`,
        };
      },
    });
  }

  // 6. Reports — /daily
  if (authToken) {
    const today = new Date().toISOString().slice(0, 10);
    await check("Reports Daily", "GET", `/api/reports/daily?date=${today}`, {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const metrics = d?.metrics as unknown[];
        if (!Array.isArray(metrics) || metrics.length === 0)
          return { ok: false, msg: "metrics vazio" };
        return { ok: true, msg: `${metrics.length} times com dados do dia` };
      },
    });
  }

  // 7. Reports — /tags
  if (authToken) {
    await check("Reports Tags", "GET", "/api/reports/tags", {
      auth: true,
      validate: (data, status) => {
        const d = data as unknown[];
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (!Array.isArray(d)) return { ok: false, msg: "Resposta não é array" };
        return { ok: true, msg: `${d.length} tags` };
      },
    });
  }

  // 8. Reports — /summary
  if (authToken) {
    await check("Reports Summary", "GET", "/api/reports/summary", {
      auth: true,
      validate: (data, status) => {
        const d = data as unknown[];
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (!Array.isArray(d) || d.length === 0) return { ok: false, msg: "summary vazio" };
        return { ok: true, msg: `${d.length} funis no summary` };
      },
    });
  }

  // 9. Reports — /dashboard (agents by team)
  if (authToken) {
    await check("Reports Dashboard", "GET", "/api/reports/dashboard", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const agents = d?.agentsByTeam as Record<string, unknown[]>;
        if (!agents) return { ok: false, msg: "agentsByTeam ausente" };
        const teams = Object.keys(agents);
        const total = teams.reduce((sum, t) => sum + (agents[t]?.length || 0), 0);
        return { ok: true, msg: `${teams.length} times, ${total} agentes` };
      },
    });
  }

  // 10. Reports — /tmf
  if (authToken) {
    await check("Reports TMF", "GET", "/api/reports/tmf", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (typeof d?.tmfGeralHoras !== "number") return { ok: false, msg: "tmfGeralHoras ausente" };
        return { ok: true, msg: `TMF geral: ${d.tmfGeralHoras}h` };
      },
    });
  }

  // 11. Reports — /loss-reasons
  if (authToken) {
    await check("Reports Motivos Perda", "GET", "/api/reports/loss-reasons", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        return {
          ok: true,
          msg: `${d?.totalPerdidos || 0} perdidos, ${(d?.motivos as unknown[])?.length || 0} motivos`,
        };
      },
    });
  }

  // 12. Reports — /income
  if (authToken) {
    await check("Reports Renda", "GET", "/api/reports/income", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const faixas = d?.faixas as unknown[];
        if (!Array.isArray(faixas)) return { ok: false, msg: "faixas ausente" };
        return { ok: true, msg: `${faixas.length} faixas de renda` };
      },
    });
  }

  // 13. Reports — /profession
  if (authToken) {
    await check("Reports Profissão", "GET", "/api/reports/profession", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const profs = d?.profissoes as unknown[];
        if (!Array.isArray(profs)) return { ok: false, msg: "profissoes ausente" };
        return { ok: true, msg: `${profs.length} profissões` };
      },
    });
  }

  // 14. Reports — /ddd
  if (authToken) {
    await check("Reports DDD", "GET", "/api/reports/ddd", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        const ddds = d?.ddds as unknown[];
        if (!Array.isArray(ddds)) return { ok: false, msg: "ddds ausente" };
        return { ok: true, msg: `${ddds.length} DDDs, ${(d?.estados as unknown[])?.length || 0} estados` };
      },
    });
  }

  // 15. Chat mentors
  if (authToken) {
    await check("Chat Mentors", "GET", "/api/chat/mentors", {
      auth: true,
      validate: (data, status) => {
        const d = data as unknown[];
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (!Array.isArray(d)) return { ok: false, msg: "Resposta não é array" };
        return { ok: true, msg: `${d.length} mentores ativos` };
      },
    });
  }

  // 16. Notifications unread count
  if (authToken) {
    await check("Notifications Count", "GET", "/api/notifications/unread-count", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (typeof d?.count !== "number") return { ok: false, msg: "count ausente" };
        return { ok: true, msg: `${d.count} não lidas` };
      },
    });
  }

  // 17. Auth Profile
  if (authToken) {
    await check("Auth Profile", "GET", "/api/auth/profile", {
      auth: true,
      validate: (data, status) => {
        const d = data as Record<string, unknown>;
        if (status !== 200) return { ok: false, msg: `HTTP ${status}` };
        if (!d?.id || !d?.email || !d?.role) return { ok: false, msg: "Campos faltando no profile" };
        return { ok: true, msg: `${d.name} (${d.role})` };
      },
    });
  }

  // ─── Relatório ─────────────────────────────────────────

  const okCount = results.filter((r) => r.status === "ok").length;
  const warnCount = results.filter((r) => r.status === "warn").length;
  const failCount = results.filter((r) => r.status === "fail").length;
  const avgTime = Math.round(results.reduce((s, r) => s + r.responseTimeMs, 0) / results.length);

  console.log("  # │ Status │  ms  │ Endpoint");
  console.log("────┼────────┼──────┼─────────────────────────────────");

  results.forEach((r, i) => {
    const icon = r.status === "ok" ? "  ✅  " : r.status === "warn" ? "  ⚠️  " : "  ❌  ";
    const ms = String(r.responseTimeMs).padStart(4);
    const num = String(i + 1).padStart(2);
    console.log(`${num}  │${icon}│ ${ms} │ ${r.method} ${r.endpoint}: ${r.message}`);
  });

  console.log(`\n${"─".repeat(60)}`);
  console.log(`  Resultado: ✅ ${okCount} ok  ⚠️ ${warnCount} warn  ❌ ${failCount} fail`);
  console.log(`  Tempo médio: ${avgTime}ms`);
  console.log(`  Total endpoints: ${results.length}`);
  console.log(`${"─".repeat(60)}\n`);

  if (failCount > 0) {
    console.log("  FALHAS:");
    results
      .filter((r) => r.status === "fail")
      .forEach((r) => console.log(`    ❌ ${r.method} ${r.endpoint}: ${r.message}`));
    console.log();
  }

  return { ok: failCount === 0, results, okCount, warnCount, failCount, avgTime };
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const watchMode = args.includes("--watch");
  const intervalArg = args[args.indexOf("--watch") + 1];
  const intervalMin = parseInt(intervalArg) || 5;

  await runAllChecks();

  if (watchMode) {
    console.log(`🔄 Modo watch ativo — checando a cada ${intervalMin} minutos\n`);
    setInterval(runAllChecks, intervalMin * 60 * 1000);
  }
}

main().catch(console.error);
