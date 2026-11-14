import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
const db = new PGlite();
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const record = "00000000-0000-4000-8000-000000000003";
async function asUser(user: string) {
  await db.exec("reset role; set role authenticated;");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}
async function mutate(version: number, ciphertext: string | null, iv = "iv") {
  const result = await db.query<{ ok: boolean }>(
    "select public.apply_mutation($1,$2,$3,$4,$5) as ok",
    ["credentials", record, version, ciphertext ? iv : null, ciphertext],
  );
  return result.rows[0].ok;
}
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated,anon;
 insert into auth.users values('${alice}'),('${bob}');`);
  await db.exec(
    readFileSync(new URL("../supabase/init.sql", import.meta.url), "utf8"),
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
describe("actual PostgreSQL schema and RLS in PGlite", () => {
  it("enables and forces RLS on all four tables", async () => {
    const result = await db.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('vaults','credentials','categories','sync_metadata')",
    );
    expect(result.rows).toHaveLength(4);
    expect(
      result.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
    ).toBe(true);
  });
  it("allows an authenticated user to create a record", async () => {
    await asUser(alice);
    expect(await mutate(0, "cipher-v1")).toBe(true);
  });
  it("does not expose another user’s records or metadata", async () => {
    await asUser(bob);
    expect((await db.query("select * from credentials")).rows).toHaveLength(0);
    expect((await db.query("select * from sync_metadata")).rows).toHaveLength(
      0,
    );
  });
  it("blocks forged ownership on INSERT", async () => {
    await asUser(bob);
    await expect(
      db.query(
        "insert into categories(id,user_id,version,iv,ciphertext) values($1,$2,1,$3,$4)",
        [crypto.randomUUID(), alice, "iv", "cipher"],
      ),
    ).rejects.toThrow();
  });
  it("prevents UPDATE and DELETE of another user’s rows", async () => {
    await asUser(bob);
    expect(
      (
        await db.query("update credentials set ciphertext=$1 returning id", [
          "malicious",
        ])
      ).rows,
    ).toHaveLength(0);
    expect(
      (await db.query("delete from credentials returning id")).rows,
    ).toHaveLength(0);
  });
  it("blocks access by unauthenticated role", async () => {
    await db.exec("reset role;set role anon");
    await expect(db.query("select * from credentials")).rejects.toThrow();
    await expect(mutate(1, "forged")).rejects.toThrow();
  });
  it("accepts a device update and rejects a stale second device", async () => {
    await asUser(alice);
    expect(await mutate(1, "device-a-v2")).toBe(true);
    expect(await mutate(1, "device-b-v2")).toBe(false);
    expect(
      (
        await db.query<{ ciphertext: string }>(
          "select ciphertext from credentials",
        )
      ).rows[0].ciphertext,
    ).toBe("device-a-v2");
  });
  it("accepts retries of an already-committed ciphertext", async () => {
    expect(await mutate(1, "device-a-v2")).toBe(true);
    expect(
      (await db.query<{ version: number }>("select version from credentials"))
        .rows[0].version,
    ).toBe(2);
  });
  it("resolves a conflict using the freshly downloaded version", async () => {
    expect(await mutate(2, "device-b-resolved")).toBe(true);
  });
  it("rejects stale deletion and propagates confirmed deletion", async () => {
    expect(await mutate(2, null)).toBe(false);
    expect(await mutate(3, null)).toBe(true);
    expect((await db.query("select * from credentials")).rows).toHaveLength(0);
    expect(await mutate(3, null)).toBe(true);
  });
  it("keeps vault metadata and encrypted categories private", async () => {
    await asUser(alice);
    await db.query(
      "insert into vaults(id,user_id,version,salt,iterations,wrapped,recovery) values($1,$2,1,$3,600000,$4,$5)",
      [crypto.randomUUID(), alice, "salt", "{}", "{}"],
    );
    await db.query(
      "insert into categories(id,user_id,version,iv,ciphertext) values($1,$2,1,$3,$4)",
      [crypto.randomUUID(), alice, "iv", "encrypted-category"],
    );
    await asUser(bob);
    expect((await db.query("select * from vaults")).rows).toHaveLength(0);
    expect((await db.query("select * from categories")).rows).toHaveLength(0);
  });
});
