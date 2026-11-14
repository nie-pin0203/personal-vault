import type { Box, Vault } from "./types";
const encoder = new TextEncoder();
const iterations = 600000;
export const b64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (x) => String.fromCharCode(x)).join(""));
export function unb64(value: string) {
  return Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
}
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
async function importKey(raw: Uint8Array) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
async function derive(password: string, salt: string, count: number) {
  if (count < 600000 || count > 2000000 || unb64(salt).length !== 16)
    throw new Error("不支持的密钥派生参数");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: count },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  key: CryptoKey,
  value: unknown,
  context: string,
): Promise<Box> {
  const iv = random(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(JSON.stringify(value)),
  );
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function open<T>(
  key: CryptoKey,
  box: Box,
  context: string,
): Promise<T> {
  if (unb64(box.iv).length !== 12) throw new Error("密文格式错误");
  const raw = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unb64(box.iv),
      additionalData: encoder.encode(context),
    },
    key,
    unb64(box.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(raw));
}
export function validateMaster(password: string) {
  if (password.length < 12 || password.length > 256)
    throw new Error("主密码需要 12～256 个字符");
}
export async function initialize(user_id: string, password: string) {
  validateMaster(password);
  const raw = random(32),
    recoveryRaw = random(32),
    id = crypto.randomUUID(),
    salt = b64(random(16));
  const key = await importKey(raw),
    kek = await derive(password, salt, iterations);
  const vault: Vault = {
    id,
    user_id,
    version: 1,
    salt,
    iterations,
    wrapped: await seal(kek, b64(raw), `${id}:dek`),
    recovery: await seal(
      await importKey(recoveryRaw),
      b64(raw),
      `${id}:recovery`,
    ),
  };
  const recoveryKey = b64(recoveryRaw);
  raw.fill(0);
  recoveryRaw.fill(0);
  return { key, vault, recoveryKey };
}
export async function unlock(vault: Vault, password: string) {
  const raw = unb64(
    await open<string>(
      await derive(password, vault.salt, vault.iterations),
      vault.wrapped,
      `${vault.id}:dek`,
    ),
  );
  try {
    return await importKey(raw);
  } finally {
    raw.fill(0);
  }
}
export async function rewrap(
  vault: Vault,
  oldSecret: string,
  newPassword: string,
  recover = false,
) {
  validateMaster(newPassword);
  const source = recover
    ? await importKey(unb64(oldSecret.trim()))
    : await derive(oldSecret, vault.salt, vault.iterations);
  const raw = await open<string>(
    source,
    recover ? vault.recovery : vault.wrapped,
    `${vault.id}:${recover ? "recovery" : "dek"}`,
  );
  const salt = b64(random(16));
  return {
    ...vault,
    salt,
    iterations,
    version: vault.version + 1,
    wrapped: await seal(
      await derive(newPassword, salt, iterations),
      raw,
      `${vault.id}:dek`,
    ),
  };
}
export function generatePassword(
  length: number,
  enabled: boolean[],
  exclude: boolean,
) {
  if (!Number.isInteger(length) || length < 8 || length > 64)
    throw new Error("长度须为 8～64");
  const groups = [
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "!@#$%^&*()-_=+[]{}:,.?",
  ]
    .filter((_, i) => enabled[i])
    .map((s) => (exclude ? s.replace(/[Il1O0o]/g, "") : s));
  if (!groups.length) throw new Error("至少选择一种字符");
  function pick(n: number) {
    let x: number;
    do {
      x = random(1)[0];
    } while (x >= 256 - (256 % n));
    return x % n;
  }
  const pool = groups.join(""),
    result = groups.map((s) => s[pick(s.length)]);
  while (result.length < length) result.push(pool[pick(pool.length)]);
  for (let i = result.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join("");
}
