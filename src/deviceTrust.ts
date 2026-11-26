import { b64, unb64 } from "./crypto";
import type { Vault } from "./types";

type DeviceRecord = {
  key: CryptoKey;
  iv: string;
  ciphertext: string;
  fingerprint: string;
  revision: string;
};
const marker = (user: string) => `miyu-trust-revoked:${user}`;
const revision = (user: string) => localStorage.getItem(marker(user)) || "";
const identity = (v: Vault) => `${v.user_id}:${v.id}`;
const fingerprint = (v: Vault) =>
  JSON.stringify([v.user_id, v.id, v.salt, v.iterations, v.wrapped]);
const aad = (v: Vault) => new TextEncoder().encode(fingerprint(v));

async function store<T>(
  mode: IDBTransactionMode,
  operation: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("miyu-device-trust", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("devices");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction("devices", mode);
    const request = operation(tx.objectStore("devices"));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("设备存储不可用"));
    };
  });
}

export async function rememberDevice(
  v: Vault,
  raw: Uint8Array,
  expectedRevision = revision(v.user_id),
) {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(v) },
    key,
    raw,
  );
  if (revision(v.user_id) !== expectedRevision) return;
  await store("readwrite", (s) =>
    s.put(
      {
        key,
        iv: b64(iv),
        ciphertext: b64(new Uint8Array(ciphertext)),
        fingerprint: fingerprint(v),
        revision: expectedRevision,
      } satisfies DeviceRecord,
      identity(v),
    ),
  );
  if (revision(v.user_id) !== expectedRevision)
    await store("readwrite", (s) => s.delete(identity(v)));
}

export const trustRevision = revision;

export async function restoreDevice(v: Vault): Promise<CryptoKey | null> {
  const expected = revision(v.user_id);
  const record = (await store("readonly", (s) => s.get(identity(v)))) as
    DeviceRecord | undefined;
  if (!record) return null;
  if (record.fingerprint !== fingerprint(v) || record.revision !== expected) {
    await store("readwrite", (s) => s.delete(identity(v)));
    return null;
  }
  const raw = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(record.iv), additionalData: aad(v) },
      record.key,
      unb64(record.ciphertext),
    ),
  );
  try {
    if (revision(v.user_id) !== expected) return null;
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  } finally {
    raw.fill(0);
  }
}

export async function forgetDevice(user: string) {
  // Synchronous durable invalidation blocks an in-flight restore, even if IDB deletion fails.
  localStorage.setItem(marker(user), crypto.randomUUID());
  const keys = await store("readonly", (s) => s.getAllKeys());
  for (const key of keys)
    if (String(key).startsWith(user + ":"))
      await store("readwrite", (s) => s.delete(key));
}
