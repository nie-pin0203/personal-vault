import { useCallback, useEffect, useRef, useState } from "react";
import { commit, fetchRows } from "./backend";
import { open, seal } from "./crypto";
import { enqueue, overlay, readCache, writeCache } from "./store";
import type { Category, Credential, Mutation, Row } from "./types";
export function useVault(user: string, key: CryptoKey, vaultId: string) {
  const cache = useRef(readCache(user)),
    active = useRef(true),
    busy = useRef(false);
  const inFlight = useRef<Mutation | null>(null);
  const renderVersion = useRef(0);
  const mutationChain = useRef(Promise.resolve());
  function serialize(operation: () => Promise<void>) {
    const next = mutationChain.current.then(operation);
    mutationChain.current = next.catch(() => {});
    return next;
  }
  const [records, setRecords] = useState<Credential[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [status, setStatus] = useState("等待同步"),
    [lastSync, setLastSync] = useState(""),
    [conflicts, setConflicts] = useState<Mutation[]>([]),
    [pending, setPending] = useState(cache.current.pending.length);
  const context = (table: string, id: string) => `${vaultId}:${table}:${id}`;
  const render = useCallback(async () => {
    const version = ++renderVersion.current;
    const snapshot = cache.current;
    const decode = async <T>(table: "credentials" | "categories") =>
      Promise.all(
        overlay(snapshot[table], snapshot.pending, table).map((r) =>
          open<T>(key, r, `${vaultId}:${table}:${r.id}`),
        ),
      );
    const [items, cats] = await Promise.all([
      decode<Credential>("credentials"),
      decode<Category>("categories"),
    ]);
    if (active.current && version === renderVersion.current) {
      setRecords(items);
      setCategories(cats);
      setPending(snapshot.pending.length);
    }
  }, [key, vaultId]);
  const persist = () => writeCache(user, cache.current);
  const sync = useCallback(async () => {
    if (busy.current || !active.current) return;
    if (!navigator.onLine) {
      setStatus("离线 · 更改已加密保存在本机");
      return;
    }
    busy.current = true;
    let rerun = false;
    setStatus("正在同步…");
    try {
      const failed: Mutation[] = [];
      for (const mutation of [...cache.current.pending]) {
        if (!active.current) return;
        inFlight.current = mutation;
        if (await commit(mutation)) {
          cache.current[mutation.table] = overlay(
            cache.current[mutation.table],
            [mutation],
            mutation.table,
          );
          cache.current.pending = cache.current.pending.filter(
            (m) => m !== mutation,
          );
          // Preserve edits queued while this request was in flight, advancing their base version.
          cache.current.pending = cache.current.pending.map((m) =>
            m.id === mutation.id && m.table === mutation.table
              ? {
                  ...m,
                  expected: mutation.expected + 1,
                  row: m.row
                    ? { ...m.row, version: mutation.expected + 2 }
                    : null,
                }
              : m,
          );
          persist();
        } else failed.push(mutation);
        inFlight.current = null;
      }
      const [credentials, categories] = await Promise.all([
        fetchRows("credentials"),
        fetchRows("categories"),
      ]);
      if (!active.current) return;
      cache.current = {
        credentials,
        categories,
        pending: cache.current.pending,
      };
      persist();
      await render();
      setConflicts(failed);
      rerun = failed.length === 0 && cache.current.pending.length > 0;
      setLastSync(new Date().toLocaleTimeString());
      setStatus(
        failed.length
          ? "存在版本冲突，请处理"
          : cache.current.pending.length
            ? "有更改等待同步"
            : "所有更改已同步",
      );
    } catch {
      if (active.current) setStatus("同步失败 · 请重试，待上传密文已保留");
    } finally {
      busy.current = false;
      inFlight.current = null;
      if (rerun && active.current) queueMicrotask(() => void sync());
    }
  }, [render, user]);
  useEffect(() => {
    active.current = true;
    void render().catch(() => setStatus("本地密文校验失败"));
    void sync();
    const timer = setInterval(() => void sync(), 15000);
    const online = () => void sync();
    const offline = () => setStatus("离线 · 更改已加密保存在本机");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      active.current = false;
      clearInterval(timer);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [render, sync]);
  async function saveMany(
    table: Mutation["table"],
    values: (Credential | Category)[],
  ) {
    const mutations: Mutation[] = [];
    for (const value of values) {
      const box = await seal(key, value, context(table, value.id));
      const base = cache.current[table].find((r) => r.id === value.id);
      const row: Row = {
        id: value.id,
        user_id: user,
        version: (base?.version ?? 0) + 1,
        ...box,
      };
      mutations.push({
        table,
        id: value.id,
        expected: base?.version ?? 0,
        row,
      });
    }
    if (!active.current) return;
    const previous = cache.current.pending;
    cache.current.pending = mutations.reduce(enqueue, previous);
    try {
      persist();
    } catch {
      cache.current.pending = previous;
      throw new Error("本地存储已满，未保存，请释放空间后重试");
    }
    await render();
    void sync();
  }
  async function deleteMany(
    ids: string[],
    table: Mutation["table"] = "credentials",
  ) {
    const previous = cache.current.pending;
    cache.current.pending = ids.reduce((q, id) => {
      const flight = inFlight.current;
      const isInFlight = flight?.id === id && flight.table === table;
      const remaining = isInFlight
        ? q.filter((m) => m.id !== id || m.table !== table)
        : q;
      return enqueue(remaining, {
        table,
        id,
        expected: isInFlight
          ? flight.expected + 1
          : (cache.current[table].find((r) => r.id === id)?.version ?? 0),
        row: null,
      });
    }, previous);
    try {
      persist();
    } catch {
      cache.current.pending = previous;
      throw new Error("本地存储失败");
    }
    await render();
    void sync();
  }
  async function resolve(m: Mutation, keep: boolean) {
    const remote = cache.current[m.table].find((r) => r.id === m.id);
    cache.current.pending = cache.current.pending.filter(
      (x) => x.id !== m.id || x.table !== m.table,
    );
    if (keep)
      cache.current.pending.push({
        ...m,
        expected: remote?.version ?? 0,
        row: m.row ? { ...m.row, version: (remote?.version ?? 0) + 1 } : null,
      });
    persist();
    setConflicts((c) => c.filter((x) => x !== m));
    await render();
    void sync();
  }
  return {
    records,
    categories,
    status,
    lastSync,
    conflicts,
    pending,
    sync,
    putMany: (table: Mutation["table"], values: (Credential | Category)[]) =>
      serialize(() => saveMany(table, values)),
    remove: (ids: string[], table: Mutation["table"] = "credentials") =>
      serialize(() => deleteMany(ids, table)),
    resolve,
  };
}
