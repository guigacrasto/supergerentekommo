import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: tokenRows } = await supabase.from("settings").select("key, value").eq("key", "kommo_azul_access_token");
  const accessToken = (tokenRows || [])[0]?.value || "";
  const subdomain = process.env.KOMMO_SUBDOMAIN || "";

  const res = await fetch(`https://${subdomain}.kommo.com/api/v4/leads/pipelines`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const pipelines = data?._embedded?.pipelines || [];

  for (const p of pipelines) {
    console.log(`\nPipeline #${p.id}: "${p.name}" (${p.is_main ? "PRINCIPAL" : "secundário"})`);
    const statuses = p._embedded?.statuses || [];
    for (const s of statuses) {
      console.log(`  Status #${s.id}: "${s.name}"`);
    }
  }
}
main().catch(console.error);
