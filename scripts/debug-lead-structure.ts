import dotenv from "dotenv";
dotenv.config();
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_KEY as string,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function main() {
  const { data: tokenRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("key", "kommo_azul_access_token");
  const accessToken = (tokenRows || [])[0]?.value || "";
  const subdomain = process.env.KOMMO_SUBDOMAIN || "";

  // Buscar 2 leads com contacts
  const res = await fetch(
    `https://${subdomain}.kommo.com/api/v4/leads?with=contacts&limit=2&page=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  const lead = data._embedded.leads[0];

  console.log("=== LEAD STRUCTURE ===");
  console.log("Lead keys:", Object.keys(lead));
  console.log("\n_embedded keys:", Object.keys(lead._embedded || {}));
  console.log("\nContacts embedded:", JSON.stringify(lead._embedded?.contacts, null, 2)?.slice(0, 500));
  console.log("\nCustom fields:", JSON.stringify(lead.custom_fields_values, null, 2)?.slice(0, 500));

  // Buscar contato separado
  const contactId = lead._embedded?.contacts?.[0]?.id;
  if (contactId) {
    console.log(`\n=== CONTACT ${contactId} (separate fetch) ===`);
    const cRes = await fetch(
      `https://${subdomain}.kommo.com/api/v4/contacts/${contactId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const contact = await cRes.json();
    console.log("Contact custom_fields:", JSON.stringify(contact.custom_fields_values, null, 2)?.slice(0, 2000));
  }
}

main().catch(console.error);
