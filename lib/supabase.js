import { createAdminClient } from "@supabase/server/core";

const requiredEnvironment = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];

export function isSupabaseConfigured() {
  return requiredEnvironment.every((name) => Boolean(process.env[name]));
}

export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) return null;
  return createAdminClient();
}
