import { createClient } from "@supabase/supabase-js";

// Uses the same Supabase project as the auth module
function getClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface KommoTokens {
  accessToken: string;
  refreshToken: string;
}

export async function loadTokens(): Promise<KommoTokens | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", ["kommo_access_token", "kommo_refresh_token"]);

  if (error || !data || data.length === 0) return null;

  const map = Object.fromEntries(data.map((r: any) => [r.key, r.value]));
  const accessToken = map["kommo_access_token"] || "";
  const refreshToken = map["kommo_refresh_token"] || "";

  if (!accessToken) return null;
  return { accessToken, refreshToken };
}

export async function saveTokens(tokens: KommoTokens): Promise<void> {
  const supabase = getClient();
  await supabase.from("settings").upsert([
    { key: "kommo_access_token", value: tokens.accessToken, updated_at: new Date().toISOString() },
    { key: "kommo_refresh_token", value: tokens.refreshToken, updated_at: new Date().toISOString() },
  ]);
}
