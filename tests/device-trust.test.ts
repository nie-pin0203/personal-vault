// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { initialize, unlock, seal, open, rewrap } from "../src/crypto";
import {
  rememberDevice,
  restoreDevice,
  forgetDevice,
  trustRevision,
} from "../src/deviceTrust";
beforeAll(() => vi.stubGlobal("crypto", webcrypto));
const password = "test-device-password";
it("persists encrypted DEK, restores nonextractable key and isolates users", async () => {
  const a = await initialize("device-user-a", password);
  const b = await initialize("device-user-b", password);
  await unlock(a.vault, password, (raw) => rememberDevice(a.vault, raw));
  const restored = await restoreDevice(a.vault);
  expect(restored?.extractable).toBe(false);
  await expect(crypto.subtle.exportKey("raw", restored!)).rejects.toThrow();
  const box = await seal(a.key, { secret: "protected" }, "test");
  expect(await open(restored!, box, "test")).toEqual({ secret: "protected" });
  expect(await restoreDevice(b.vault)).toBeNull();
  expect(JSON.stringify(localStorage)).not.toContain(password);
  await forgetDevice(a.vault.user_id);
  expect(await restoreDevice(a.vault)).toBeNull();
});
it("invalidates after password rewrap and rejects wrong password", async () => {
  const a = await initialize("device-rewrap", password);
  await expect(
    unlock(a.vault, "wrong", (raw) => rememberDevice(a.vault, raw)),
  ).rejects.toThrow();
  expect(await restoreDevice(a.vault)).toBeNull();
  await unlock(a.vault, password, (raw) => rememberDevice(a.vault, raw));
  expect(
    await restoreDevice(
      await rewrap(a.vault, password, "new-password-for-test"),
    ),
  ).toBeNull();
});
it("revocation wins against an earlier pending remember operation", async () => {
  const a = await initialize("device-race", password);
  const revision = trustRevision(a.vault.user_id);
  await forgetDevice(a.vault.user_id);
  await unlock(a.vault, password, (raw) =>
    rememberDevice(a.vault, raw, revision),
  );
  expect(await restoreDevice(a.vault)).toBeNull();
});
