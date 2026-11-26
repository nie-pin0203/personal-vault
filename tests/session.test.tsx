// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { webcrypto } from "node:crypto";
const state = vi.hoisted(() => ({
  callback: null as any,
  key: null as any,
  forget: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../src/deviceTrust", () => ({
  restoreDevice: async () => state.key,
  forgetDevice: state.forget,
  rememberDevice: vi.fn(),
  trustRevision: () => "",
}));
vi.mock("../src/backend", () => ({
  client: {
    auth: {
      onAuthStateChange: (cb: any) => {
        state.callback = cb;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: state.signOut,
    },
  },
  getVault: async () => ({ id: "v", user_id: "u" }),
  redirectTo: () => "",
  saveVault: vi.fn(),
  fetchRows: async () => [],
  commit: vi.fn(),
}));
import { App } from "../src/App";
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  localStorage.clear();
  state.key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  state.forget.mockResolvedValue(undefined);
  state.signOut.mockImplementation(async () => {
    state.callback("SIGNED_OUT", null);
    return { error: null };
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
async function start() {
  const app = render(<App />);
  act(() => state.callback("INITIAL_SESSION", { user: { id: "u" } }));
  await waitFor(() => expect(screen.getByLabelText("锁定密码库")).toBeTruthy());
  return app;
}
it("restores an old valid login, survives background/pagehide and long idle", async () => {
  localStorage.setItem("miyu-session-active-u", "1");
  await start();
  vi.useFakeTimers();
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    vi.advanceTimersByTime(61 * 60 * 1000);
  });
  expect(screen.getByLabelText("锁定密码库")).toBeTruthy();
  expect(state.signOut).not.toHaveBeenCalled();
  expect(state.forget).not.toHaveBeenCalled();
});
it("restores after reopening, but manual lock revokes trust without signing out", async () => {
  const app = await start();
  app.unmount();
  await start();
  fireEvent.click(screen.getByLabelText("锁定密码库"));
  expect(screen.getByLabelText("密码库主密码")).toBeTruthy();
  expect(state.forget).toHaveBeenCalledWith("u");
  expect(state.signOut).not.toHaveBeenCalled();
});
it("untrusted devices require master password and explicit logout is local", async () => {
  state.key = null;
  render(<App />);
  act(() => state.callback("INITIAL_SESSION", { user: { id: "u" } }));
  await screen.findByLabelText("密码库主密码");
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() =>
    expect(state.signOut).toHaveBeenCalledWith({ scope: "local" }),
  );
  expect(state.forget).toHaveBeenCalledWith("u");
});
