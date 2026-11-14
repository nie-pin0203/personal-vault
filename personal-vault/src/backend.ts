import { createClient } from "@supabase/supabase-js";
import type { Mutation, Row, Vault } from "./types";
const url = import.meta.env.VITE_SUPABASE_URL,
  token = import.meta.env.VITE_SUPABASE_ANON_KEY;
function publicKey(value: string) {
  if (value.startsWith("sb_publishable_")) return true;
  try {
    return JSON.parse(atob(value.split(".")[1])).role === "anon";
  } catch {
    return false;
  }
}
export const client =
  url?.startsWith("https://") && token && publicKey(token)
    ? createClient(url, token, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
export const redirectTo = () => location.origin + location.pathname;
export async function getVault(): Promise<Vault | null> {
  if (!client) throw new Error("请先配置 Supabase");
  const { data, error } = await client.from("vaults").select("*").maybeSingle();
  if (error) throw new Error("读取密码库失败，请检查网络和数据库配置");
  return data;
}
export async function saveVault(v: Vault, create = false) {
  if (!client) throw new Error("请先配置 Supabase");
  const query = create
    ? client.from("vaults").insert(v)
    : client
        .from("vaults")
        .update(v)
        .eq("id", v.id)
        .eq("version", v.version - 1);
  const { data, error } = await query.select("id");
  if (error || !data?.length)
    throw new Error("密码库保存失败或已被其他设备修改，请重新登录后重试");
}
export async function fetchRows(
  table: "credentials" | "categories",
): Promise<Row[]> {
  if (!client) throw new Error("请先配置 Supabase");
  const result: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error("同步下载失败，请检查网络后重试");
    result.push(...data);
    if (data.length < 500) return result;
  }
}
export async function commit(m: Mutation) {
  if (!client) throw new Error("请先配置 Supabase");
  const { data, error } = await client.rpc("apply_mutation", {
    p_table: m.table,
    p_id: m.id,
    p_expected: m.expected,
    p_iv: m.row?.iv ?? null,
    p_ciphertext: m.row?.ciphertext ?? null,
  });
  if (error) throw new Error("同步上传失败，请检查网络或数据库权限");
  return data as boolean;
}
