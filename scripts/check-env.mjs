const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY || "";
let validKey = key.startsWith("sb_publishable_");
try {
  validKey ||=
    JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ===
    "anon";
} catch {}
if (!url?.startsWith("https://") || !validKey) {
  console.error(
    "Missing Supabase HTTPS URL or valid public anon/publishable key.",
  );
  process.exit(1);
}
