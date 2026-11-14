// Development-only visual fixture. Vite's production entry excludes this file.
import { createRoot } from "react-dom/client";
import { Workspace } from "../src/App";
import { initialize, seal } from "../src/crypto";
import { emptyCredential } from "../src/types";
import "../src/styles.css";
const user = "visual-test-only";
const { key, vault } = await initialize(user, "visual-test-master-only");
const records = [
  ["个人邮箱", "邮箱账号", "mail@example.test"],
  ["工作台", "软件及工具", "demo-user"],
  ["游戏社区", "游戏账号", "player-demo"],
].map(([name, category, username]) => ({
  ...emptyCredential(),
  name,
  category,
  username,
  password: "visual-test-only",
  favorite: name === "个人邮箱",
}));
const rows = await Promise.all(
  records.map(async (r) => ({
    id: r.id,
    user_id: user,
    version: 1,
    ...(await seal(key, r, `${vault.id}:credentials:${r.id}`)),
  })),
);
localStorage.setItem(
  `miyu-cipher-${user}`,
  JSON.stringify({ credentials: rows, categories: [], pending: [] }),
);
createRoot(document.getElementById("root")!).render(
  <Workspace
    user={user}
    vault={vault}
    cryptoKey={key}
    lock={() => location.reload()}
    updateVault={() => {}}
    dark={false}
    toggleTheme={() => {
      document.documentElement.dataset.theme =
        document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    }}
    brand={
      <div className="brand">
        密屿<small>界面测试数据</small>
      </div>
    }
  />,
);
