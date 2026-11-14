import { open, seal, unlock } from "./crypto";
import type { Category, Credential, Vault, Box } from "./types";
export async function exportBackup(
  key: CryptoKey,
  vault: Vault,
  credentials: Credential[],
  categories: Category[],
) {
  return JSON.stringify({
    format: "miyu-backup",
    version: 1,
    vault,
    payload: await seal(key, { credentials, categories }, `${vault.id}:backup`),
  });
}
export async function importBackup(text: string, password: string) {
  if (text.length > 20000000) throw new Error("备份文件超过 20 MB");
  const file = JSON.parse(text) as {
    format: string;
    version: number;
    vault: Vault;
    payload: Box;
  };
  if (file.format !== "miyu-backup" || file.version !== 1)
    throw new Error("不支持的备份格式");
  const key = await unlock(file.vault, password);
  const payload = await open<{
    credentials: Credential[];
    categories: Category[];
  }>(key, file.payload, `${file.vault.id}:backup`);
  if (
    !Array.isArray(payload.credentials) ||
    !Array.isArray(payload.categories) ||
    payload.credentials.length > 10000
  )
    throw new Error("备份内容无效");
  for (const r of payload.credentials) {
    for (const name of [
      "name",
      "category",
      "website",
      "url",
      "username",
      "password",
      "email",
      "phone",
      "question",
      "answer",
      "notes",
      "tags",
      "createdAt",
      "updatedAt",
      "usedAt",
    ] as const)
      if (typeof r[name] !== "string" || r[name].length > 50000)
        throw new Error("账号内容无效");
    if (typeof r.favorite !== "boolean") throw new Error("收藏格式无效");
  }
  for (const c of payload.categories)
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 100)
      throw new Error("分类内容无效");
  return payload;
}
