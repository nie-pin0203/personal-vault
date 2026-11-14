// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  renderHook,
  act,
} from "@testing-library/react";
import { useVault } from "../src/useVault";
import { emptyCredential } from "../src/types";
import { initialize } from "../src/crypto";
import type { Row, Mutation } from "../src/types";
const backend = vi.hoisted(() => ({
  gate: null as Promise<void> | null,
  started: false,
  rows: { credentials: [] as Row[], categories: [] as Row[] },
}));
vi.mock("../src/backend", () => ({
  client: null,
  redirectTo: () => location.origin,
  getVault: vi.fn(),
  saveVault: vi.fn(),
  fetchRows: async (table: "credentials" | "categories") =>
    structuredClone(backend.rows[table]),
  commit: async (m: Mutation) => {
    backend.started = true;
    if (backend.gate) await backend.gate;
    const records = backend.rows[m.table];
    const existing = records.find((r) => r.id === m.id);
    if ((existing?.version ?? 0) !== m.expected) return false;
    backend.rows[m.table] = records.filter((r) => r.id !== m.id);
    if (m.row) backend.rows[m.table].push(structuredClone(m.row));
    return true;
  },
}));
import { App, Workspace } from "../src/App";
let created: Awaited<ReturnType<typeof initialize>>;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  created = await initialize("ui-user", "ui-master-password");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  backend.gate = null;
  backend.started = false;
  backend.rows = { credentials: [], categories: [] };
  vi.restoreAllMocks();
});
describe("React normal entry points with mock transport and real encryption", () => {
  it("preserves deletion while the initial create is in flight", async () => {
    let release!: () => void;
    backend.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { result } = renderHook(() =>
      useVault("ui-user", created.key, created.vault.id),
    );
    await waitFor(() => expect(result.current.status).toBe("所有更改已同步"));
    const record = { ...emptyCredential(), name: "in-flight-test" };
    await act(async () => {
      await result.current.putMany("credentials", [record]);
    });
    await waitFor(() => expect(backend.started).toBe(true));
    await act(async () => {
      await result.current.remove([record.id]);
    });
    expect(result.current.records).toHaveLength(0);
    await act(async () => {
      backend.gate = null;
      release();
    });
    await waitFor(() => expect(result.current.pending).toBe(0));
    expect(backend.rows.credentials).toHaveLength(0);
  });
  it("shows setup, registration and password recovery forms", () => {
    render(<App />);
    expect(screen.getByText(/尚未连接云端/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "注册" }));
    expect(screen.getByRole("heading", { name: "注册" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "忘记密码" }));
    expect(screen.queryByLabelText("登录密码")).toBeNull();
  });
  it("creates, searches, edits, copies and deletes through the UI", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <Workspace
        user="ui-user"
        vault={created.vault}
        cryptoKey={created.key}
        lock={() => {}}
        updateVault={() => {}}
        dark={false}
        toggleTheme={() => {}}
        brand={<span>密屿测试</span>}
      />,
    );
    await screen.findByText(/所有更改已同步/);
    fireEvent.click(screen.getByRole("button", { name: "新增账号" }));
    fireEvent.change(screen.getByLabelText("记录名称"), {
      target: { value: "测试邮箱" },
    });
    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "test-user" },
    });
    fireEvent.change(screen.getByLabelText("登录密码"), {
      target: { value: "test-secret-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
    await screen.findByText("测试邮箱");
    await waitFor(() => expect(backend.rows.credentials).toHaveLength(1));
    expect(JSON.stringify(backend.rows)).not.toContain("test-secret-password");
    expect(localStorage.getItem("miyu-cipher-ui-user")).not.toContain(
      "test-secret-password",
    );
    fireEvent.click(screen.getByRole("button", { name: "复制 测试邮箱 账号" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("test-user"));
    fireEvent.click(screen.getByRole("button", { name: "复制 测试邮箱 密码" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("test-secret-password"),
    );
    fireEvent.change(screen.getByLabelText("搜索密码库"), {
      target: { value: "无匹配" },
    });
    expect(screen.getByText("没有匹配的账号")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索密码库"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByText("测试邮箱"));
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByLabelText("记录名称"), {
      target: { value: "已修改邮箱" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加密保存" }));
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "编辑账号" })).toBeNull(),
    );
    expect(
      await screen.findByRole("heading", { name: "已修改邮箱" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/所有更改已同步/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    await screen.findByText("给重要账号一个安心的家");
    await waitFor(() => expect(backend.rows.credentials).toHaveLength(0));
    expect(window.confirm).toHaveBeenCalled();
  });
});
