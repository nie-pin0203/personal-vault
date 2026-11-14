import { describe, it, expect, beforeAll } from "vitest";
import {
  initialize,
  unlock,
  seal,
  open,
  rewrap,
  generatePassword,
} from "../src/crypto";
import { exportBackup, importBackup } from "../src/backup";
import { enqueue, overlay } from "../src/store";
import { emptyCredential } from "../src/types";
import type { Mutation, Row } from "../src/types";
let created: Awaited<ReturnType<typeof initialize>>;
const password = "test-master-password-42";
beforeAll(async () => {
  created = await initialize(crypto.randomUUID(), password);
});
describe("envelope encryption", () => {
  it("creates a 256-bit non-extractable DEK and independent recovery secret", () => {
    expect(created.key.extractable).toBe(false);
    expect((created.key.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(atob(created.recoveryKey).length).toBe(32);
    expect(JSON.stringify(created.vault)).not.toContain(password);
  });
  it("round trips every sensitive field", async () => {
    const record = {
      ...emptyCredential(),
      name: "银行",
      password: "a-secret",
      answer: "private",
      notes: "中文备注",
    };
    const box = await seal(created.key, record, "record-1");
    expect(JSON.stringify(box)).not.toContain("a-secret");
    expect(await open(created.key, box, "record-1")).toEqual(record);
  });
  it("unlocks with the correct master password", async () => {
    const key = await unlock(created.vault, password);
    const box = await seal(key, "hello", "test");
    expect(await open(created.key, box, "test")).toBe("hello");
  });
  it("rejects the wrong master password", async () => {
    await expect(unlock(created.vault, "incorrect-password")).rejects.toThrow();
  });
  it("rejects ciphertext tampering and substituted record identity", async () => {
    const box = await seal(created.key, "secret", "id-a");
    await expect(open(created.key, box, "id-b")).rejects.toThrow();
    const tampered = {
      ...box,
      ciphertext:
        (box.ciphertext[0] === "A" ? "B" : "A") + box.ciphertext.slice(1),
    };
    await expect(open(created.key, tampered, "id-a")).rejects.toThrow();
  });
  it("uses a different random IV each time", async () => {
    const a = await seal(created.key, "same", "x"),
      b = await seal(created.key, "same", "x");
    expect(a.iv).not.toBe(b.iv);
  });
  it("changes master password while preserving data encryption key", async () => {
    const next = await rewrap(created.vault, password, "new-master-password");
    const box = await seal(created.key, "preserved", "test");
    expect(
      await open(await unlock(next, "new-master-password"), box, "test"),
    ).toBe("preserved");
    await expect(unlock(next, password)).rejects.toThrow();
  });
  it("recovers using the offline recovery key", async () => {
    const next = await rewrap(
      created.vault,
      created.recoveryKey,
      "recovered-master-password",
      true,
    );
    const box = await seal(created.key, "restored", "test");
    expect(
      await open(await unlock(next, "recovered-master-password"), box, "test"),
    ).toBe("restored");
  });
  it("rejects invalid recovery keys", async () => {
    await expect(
      rewrap(
        created.vault,
        btoa("x".repeat(32)),
        "recovered-master-password",
        true,
      ),
    ).rejects.toThrow();
  });
  it("rejects weak master passwords and excessive KDF parameters", async () => {
    await expect(initialize("u", "short")).rejects.toThrow();
    await expect(
      unlock({ ...created.vault, iterations: 999999999 }, password),
    ).rejects.toThrow();
  });
});
describe("encrypted backup", () => {
  it("exports ciphertext and restores on a separate key instance", async () => {
    const record = { ...emptyCredential(), password: "never-plaintext" };
    const text = await exportBackup(
      created.key,
      created.vault,
      [record],
      [{ id: "1", name: "私密分类" }],
    );
    expect(text).not.toContain("never-plaintext");
    expect(text).not.toContain("私密分类");
    const result = await importBackup(text, password);
    expect(result.credentials).toEqual([record]);
  });
  it("rejects modified files before import", async () => {
    const file = JSON.parse(
      await exportBackup(created.key, created.vault, [], []),
    );
    file.payload.ciphertext = "AAAA";
    await expect(
      importBackup(JSON.stringify(file), password),
    ).rejects.toThrow();
  });
  it("rejects a wrong backup password", async () => {
    await expect(
      importBackup(
        await exportBackup(created.key, created.vault, [], []),
        "wrong-password",
      ),
    ).rejects.toThrow();
  });
});
describe("password generation", () => {
  it.each([8, 20, 64])(
    "generates %i characters with every selected group",
    (length) => {
      for (let i = 0; i < 30; i++) {
        const p = generatePassword(length, [true, true, true, true], true);
        expect(p).toHaveLength(length);
        expect(p).toMatch(/[A-Z]/);
        expect(p).toMatch(/[a-z]/);
        expect(p).toMatch(/[0-9]/);
        expect(p).toMatch(/[^a-zA-Z0-9]/);
        expect(p).not.toMatch(/[Il1O0o]/);
      }
    },
  );
  it("supports a single character group", () => {
    expect(generatePassword(32, [false, false, true, false], false)).toMatch(
      /^\d{32}$/,
    );
  });
  it("rejects invalid parameters", () => {
    expect(() => generatePassword(7, [true], false)).toThrow();
    expect(() => generatePassword(65, [true], false)).toThrow();
    expect(() =>
      generatePassword(8, [false, false, false, false], false),
    ).toThrow();
  });
});
describe("offline synchronization queue", () => {
  const row: Row = {
    id: "a",
    user_id: "u",
    version: 1,
    iv: "encrypted-iv",
    ciphertext: "encrypted-body",
  };
  const create: Mutation = { id: "a", table: "credentials", expected: 0, row };
  it("adds an encrypted record to the local view", () => {
    expect(overlay([], enqueue([], create), "credentials")).toEqual([row]);
  });
  it("coalesces multiple edits while preserving original cloud version", () => {
    const first = { ...create, expected: 3, row: { ...row, version: 4 } };
    const queue = enqueue([first], {
      ...first,
      expected: 4,
      row: { ...row, ciphertext: "new-encrypted-body" },
    });
    expect(queue).toHaveLength(1);
    expect(queue[0].expected).toBe(3);
    expect(queue[0].row?.version).toBe(4);
  });
  it("cancels an unsynced create followed by delete", () => {
    expect(enqueue([create], { ...create, row: null })).toEqual([]);
  });
  it("deletes an existing cloud row from the local view", () => {
    expect(
      overlay([row], [{ ...create, expected: 1, row: null }], "credentials"),
    ).toEqual([]);
  });
  it("keeps category and credential queues independent", () => {
    const category = { ...create, table: "categories" as const };
    expect(enqueue([create], category)).toHaveLength(2);
  });
});
