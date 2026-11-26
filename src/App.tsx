import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  Search,
  Star,
  ShieldCheck,
  RefreshCw,
  Settings,
  KeyRound,
  Grid2X2,
  Clock,
  Globe,
  LogOut,
  X,
  Trash2,
  ArrowLeft,
  Download,
  Sun,
  Moon,
} from "lucide-react";
import { client, getVault, redirectTo, saveVault } from "./backend";
import { generatePassword, initialize, rewrap, unlock } from "./crypto";
import {
  forgetDevice,
  rememberDevice,
  restoreDevice,
  trustRevision,
} from "./deviceTrust";
import { exportBackup, importBackup } from "./backup";
import { useVault } from "./useVault";
import { writeClipboard } from "./clipboard";
import { defaults, emptyCredential } from "./types";
import type { Credential, Vault } from "./types";
const labels: Record<string, string> = {
  name: "记录名称",
  category: "所属分类",
  website: "网站名称",
  url: "网站网址",
  username: "登录账号",
  password: "登录密码",
  email: "邮箱",
  phone: "手机号码",
  question: "安全问题",
  answer: "安全问题答案",
  notes: "备注",
  tags: "标签",
};
function errorText(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "操作失败，请检查输入后重试";
}
export function authErrorText(error: {
  code?: string;
  status?: number;
  name?: string;
}) {
  const messages: Record<string, string> = {
    email_address_not_authorized:
      "此邮箱尚未获准接收验证邮件。请在 Supabase 配置自定义 SMTP，或使用项目组织成员的邮箱测试。",
    over_email_send_rate_limit:
      "验证邮件发送已达到限额，请稍后重试，或检查 Supabase 邮件服务与发送限额。",
    over_request_rate_limit: "请求过于频繁，请稍后重试。",
    weak_password:
      "密码不符合服务器要求。请使用至少 12 个字符，并检查 Supabase 的密码强度设置。",
    signup_disabled: "Supabase 已关闭新用户注册，请在认证设置中开启。",
    email_provider_disabled: "Supabase 邮箱登录方式尚未开启。",
    email_address_invalid: "邮箱地址格式无效，请检查拼写。",
    validation_failed: "注册信息校验失败，请检查邮箱格式及服务器的密码要求。",
    captcha_failed:
      "项目要求验证码，但当前页面未集成验证码，需要完成验证码接入。",
    email_not_confirmed: "邮箱尚未验证，请先点击验证邮件中的链接。",
    invalid_credentials: "登录失败，请检查邮箱和登录密码。",
    user_already_exists: "此账号已存在，请尝试登录或重置登录密码。",
    unexpected_failure:
      "认证服务处理失败，请检查 Supabase Auth 日志及 SMTP 配置。",
  };
  const code = /^[a-z0-9_]{1,80}$/.test(error.code ?? "")
    ? error.code!
    : "unknown";
  const status = Number.isInteger(error.status)
    ? String(error.status)
    : "unknown";
  const message =
    messages[code] ??
    (error.name === "AuthRetryableFetchError" || error.status === 0
      ? "无法完成认证请求，请检查网络、浏览器拦截及 Supabase 服务连接。"
      : "认证请求失败，请提供下方错误代码以继续排查。");
  return `${message}（错误代码 ${code}，HTTP ${status}）`;
}
export function App() {
  const [user, setUser] = useState<string | null>(null),
    [vault, setVault] = useState<Vault | null | undefined>(undefined),
    [key, setKey] = useState<CryptoKey | null>(null),
    [notice, setNotice] = useState(""),
    [recovery, setRecovery] = useState(""),
    [recover, setRecover] = useState(false),
    [reset, setReset] = useState(false),
    [loading, setLoading] = useState(false),
    [authMode, setAuthMode] = useState("登录");
  const [dark, setDark] = useState(
    localStorage.getItem("miyu-theme") === "dark",
  );
  const generation = useRef(0);
  const userRef = useRef<string | null>(null);
  const [trust, setTrust] = useState(false);
  const lock = () => {
    generation.current++;
    setKey(null);
    setRecovery("");
    setTrust(false);
    if (userRef.current)
      void forgetDevice(userRef.current).catch(() =>
        setNotice("设备凭据清理失败，请清除本站点数据后重试"),
      );
    setNotice("密码库已锁定，已取消此设备信任");
  };
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("miyu-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setReset(true);
      const next = session?.user.id ?? null;
      const previous = userRef.current;
      if (previous !== next) {
        generation.current++;
        setKey(null);
        setVault(undefined);
        setRecovery("");
        setTrust(false);
        if (previous)
          void forgetDevice(previous).catch(() =>
            setNotice("设备凭据清理失败，请清除本站点数据"),
          );
        userRef.current = next;
        setUser(next);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    void getVault()
      .then((v) => {
        if (alive) setVault(v);
      })
      .catch(() =>
        setNotice("密码库读取失败，请检查网络及 SQL 初始化，然后重试"),
      );
    return () => {
      alive = false;
    };
  }, [user]);
  useEffect(() => {
    if (!user || !vault || reset) return;
    const epoch = generation.current;
    let alive = true;
    void restoreDevice(vault)
      .then((restored) => {
        if (alive && epoch === generation.current && restored) {
          setKey(restored);
          setTrust(true);
        }
      })
      .catch(() => {
        if (alive) setNotice("无法恢复设备解锁，请输入主密码重新解锁");
      });
    return () => {
      alive = false;
    };
  }, [user, vault, reset]);
  useEffect(() => {
    const revoked = (event: StorageEvent) => {
      if (
        userRef.current &&
        event.key === `miyu-trust-revoked:${userRef.current}`
      ) {
        generation.current++;
        setKey(null);
        setRecovery("");
        setTrust(false);
      }
    };
    window.addEventListener("storage", revoked);
    return () => window.removeEventListener("storage", revoked);
  }, []);
  async function logout() {
    lock();
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) setNotice("退出失败，请检查网络后重试；密码库已锁定");
  }
  async function action(fn: () => Promise<void>) {
    setLoading(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  async function auth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email")).trim(),
      password = String(f.get("password"));
    e.currentTarget.reset();
    await action(async () => {
      if (!client)
        throw new Error("请填写 .env 中的 Supabase URL 和公开密钥，再重新启动");
      const result =
        authMode === "注册"
          ? await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: redirectTo() },
            })
          : authMode === "忘记密码"
            ? await client.auth.resetPasswordForEmail(email, {
                redirectTo: redirectTo(),
              })
            : await client.auth.signInWithPassword({ email, password });
      if (result.error) throw new Error(authErrorText(result.error));
      if (authMode !== "登录") setNotice("请查收邮箱中的验证或重置链接");
    });
  }
  async function unlockForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password")),
      old = String(f.get("recovery"));
    e.currentTarget.reset();
    const epoch = generation.current;
    const revision = user ? trustRevision(user) : "";
    const remember = (v: Vault) =>
      trust
        ? async (raw: Uint8Array) => {
            if (epoch !== generation.current) return;
            try {
              await rememberDevice(v, raw, revision);
            } catch {
              setTrust(false);
              setNotice("本机存储不可用，本次仅临时解锁，请勿依赖记住状态");
            }
          }
        : undefined;
    await action(async () => {
      if (!user) return;
      if (vault === null) {
        if (password !== f.get("confirm")) throw new Error("两次主密码不一致");
        const created = await initialize(user, password);
        await saveVault(created.vault, true);
        if (epoch !== generation.current) return;
        setVault(created.vault);
        const firstKey = trust
          ? await unlock(created.vault, password, remember(created.vault))
          : created.key;
        if (epoch !== generation.current) return;
        setKey(firstKey);
        setRecovery(created.recoveryKey);
      } else if (vault) {
        try {
          const updated = recover
            ? await rewrap(vault, old, password, true)
            : vault;
          if (recover) await saveVault(updated);
          const nextKey = await unlock(updated, password, remember(updated));
          if (epoch !== generation.current) return;
          setVault(updated);
          setKey(nextKey);
          setRecover(false);
        } catch {
          throw new Error("解锁失败，请检查主密码或恢复密钥，并确认网络可用");
        }
      }
    });
  }
  const brand = (
    <div className="brand">
      <span className="brand-icon">
        <ShieldCheck size={24} />
      </span>
      <span>
        密屿<small>个人密码管家</small>
      </span>
    </div>
  );
  if (user && key && vault && !reset)
    return (
      <>
        {notice && (
          <div className="banner" role="status">
            {notice}
          </div>
        )}
        <Workspace
          key={user + vault.id}
          user={user}
          vault={vault}
          cryptoKey={key}
          lock={lock}
          logout={logout}
          trusted={trust}
          updateVault={(v) => {
            setVault(v);
            setTrust(false);
            if (user)
              void forgetDevice(user).catch(() =>
                setNotice("请清除本站点数据以取消设备信任"),
              );
          }}
          dark={dark}
          toggleTheme={() => setDark(!dark)}
          brand={brand}
        />
        {recovery && (
          <div className="overlay">
            <section className="modal">
              <ShieldCheck />
              <h2>保存你的恢复密钥</h2>
              <p>
                仅在这里显示一次。请抄写或保存到离线介质，切勿与备份放在一起。主密码和恢复密钥均丢失后，数据无法恢复。
              </p>
              <code className="recovery">{recovery}</code>
              <label className="check">
                <input type="checkbox" required id="saved-key" />
                我已完整离线保存恢复密钥
              </label>
              <button
                className="primary"
                onClick={() => {
                  if (
                    (document.getElementById("saved-key") as HTMLInputElement)
                      .checked
                  )
                    setRecovery("");
                }}
              >
                进入密码库
              </button>
            </section>
          </div>
        )}
      </>
    );
  return (
    <main className="auth">
      <section className="auth-story">
        {brand}
        <div>
          <span className="eyebrow">为你的数字生活，留一处安心</span>
          <h1>
            密码很多。
            <br />
            记住一个就好。
          </h1>
          <p>
            账号、密码与重要信息，安放在自己的加密空间。电脑与手机，随时取用。
          </p>
          <div className="security">
            <ShieldCheck /> AES-256-GCM 本地加密
          </div>
        </div>
        <small>主密码仅在本机使用 · 云端保存密文</small>
      </section>
      <section className="auth-panel">
        <button
          className="theme"
          aria-label="切换主题"
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun /> : <Moon />}
        </button>
        <div className="auth-box">
          {!client && (
            <div className="banner">
              尚未连接云端。请按 README 配置 Supabase
              环境变量，注册和同步将在配置后启用。
            </div>
          )}
          <LockKeyhole className="hero-icon" />
          <h2>
            {reset
              ? "重置登录密码"
              : user
                ? vault === null
                  ? "创建你的密码库"
                  : recover
                    ? "恢复密码库"
                    : "欢迎回来，解锁密屿"
                : authMode === "登录"
                  ? "欢迎回到密屿"
                  : authMode}
          </h2>
          {reset ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const p = String(new FormData(e.currentTarget).get("password"));
                e.currentTarget.reset();
                void action(async () => {
                  const r = await client!.auth.updateUser({ password: p });
                  if (r.error) throw new Error("重置失败，请重新获取邮件链接");
                  setReset(false);
                  setNotice("登录密码已更新");
                });
              }}
            >
              <label>
                新登录密码
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </label>
              <button className="primary" disabled={loading}>
                保存登录密码
              </button>
            </form>
          ) : user ? (
            vault === undefined ? (
              <button
                onClick={() =>
                  void action(async () => setVault(await getVault()))
                }
              >
                重试读取密码库
              </button>
            ) : (
              <form onSubmit={unlockForm}>
                <p>登录密码与主密码独立。主密码不会上传服务器。</p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={trust}
                    onChange={(e) => setTrust(e.target.checked)}
                  />
                  信任此设备 / 记住解锁状态
                </label>
                <small>
                  仅在私人设备开启。重新打开可自动解锁；手动锁定或退出会清除设备凭据。
                </small>
                {recover && (
                  <label>
                    恢复密钥
                    <input
                      name="recovery"
                      type="password"
                      required
                      autoComplete="off"
                    />
                  </label>
                )}
                <label>
                  {recover ? "新主密码" : "密码库主密码"}
                  <input
                    name="password"
                    type="password"
                    minLength={vault === null || recover ? 12 : 1}
                    maxLength={256}
                    required
                    autoComplete="off"
                  />
                </label>
                {vault === null && (
                  <label>
                    确认主密码
                    <input
                      name="confirm"
                      type="password"
                      required
                      autoComplete="off"
                    />
                  </label>
                )}
                <button className="primary" disabled={loading}>
                  {loading
                    ? "正在处理…"
                    : vault === null
                      ? "创建加密密码库"
                      : recover
                        ? "恢复并设置新主密码"
                        : "解锁密码库"}
                </button>
                {vault && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setRecover(!recover)}
                  >
                    {recover ? "使用主密码解锁" : "忘记主密码？使用恢复密钥"}
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void logout()}
                >
                  退出登录
                </button>
              </form>
            )
          ) : (
            <form onSubmit={auth}>
              <p>登录后，在此设备解锁你的私人密码库。</p>
              {authMode === "注册" && (
                <p>登录密码至少 12 个字符，支持更长的密码。</p>
              )}
              <label>
                邮箱地址
                <input
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </label>
              {authMode !== "忘记密码" && (
                <label>
                  登录密码
                  <input
                    name="password"
                    type="password"
                    minLength={authMode === "注册" ? 12 : 1}
                    autoComplete={
                      authMode === "注册" ? "new-password" : "current-password"
                    }
                    required
                  />
                </label>
              )}
              <button className="primary" disabled={loading || !client}>
                {loading ? "正在处理…" : authMode}
              </button>
              <div className="auth-links">
                {["登录", "注册", "忘记密码"]
                  .filter((x) => x !== authMode)
                  .map((x) => (
                    <button
                      type="button"
                      className="text-button"
                      key={x}
                      onClick={() => setAuthMode(x)}
                    >
                      {x}
                    </button>
                  ))}
              </div>
            </form>
          )}
          {notice && (
            <p role="status" className="banner">
              {notice}
            </p>
          )}
          <small>
            登录状态自动续期；切换应用或闲置不会锁定，请按需手动锁定。
          </small>
        </div>
      </section>
    </main>
  );
}

type WorkspaceProps = {
  user: string;
  vault: Vault;
  cryptoKey: CryptoKey;
  lock: () => void;
  logout?: () => Promise<void>;
  trusted?: boolean;
  updateVault: (v: Vault) => void;
  dark: boolean;
  toggleTheme: () => void;
  brand: React.ReactNode;
};
export function Workspace({
  user,
  vault,
  cryptoKey,
  lock,
  logout,
  trusted = false,
  updateVault,
  dark,
  toggleTheme,
  brand,
}: WorkspaceProps) {
  const data = useVault(user, cryptoKey, vault.id);
  const [page, setPage] = useState("全部账号"),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [editing, setEditing] = useState<Credential | null>(null),
    [checked, setChecked] = useState<string[]>([]),
    [toast, setToast] = useState(""),
    [visible, setVisible] = useState(false),
    [remind, setRemind] = useState(
      localStorage.getItem("miyu-remind") === "true",
    ),
    [busy, setBusy] = useState(false),
    [fallback, setFallback] = useState<string | null>(null);
  const alive = useRef(true),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  const names = [...defaults, ...data.categories.map((c) => c.name)].filter(
    (x, i, a) => a.indexOf(x) === i,
  );
  const current = data.records.find((r) => r.id === selected);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setToast(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function copy(text: string, record?: Credential) {
    try {
      await writeClipboard(text);
      if (!alive.current) return;
      setToast("已复制 · 粘贴后请留意系统剪贴板和剪贴板历史");
      if (remind)
        timers.current.push(
          setTimeout(
            () =>
              setToast(
                "剪贴板清理提醒 · 请手动覆盖或清除剪贴板，浏览器无法保证清除系统剪贴板内容",
              ),
            30000,
          ),
        );
      if (record)
        await data.putMany("credentials", [
          { ...record, usedAt: new Date().toISOString() },
        ]);
    } catch (e) {
      if (alive.current) {
        setToast(`${errorText(e)}。可再次点击重试，或使用手动复制框。`);
        setFallback(text);
      }
    }
  }
  const filtered = data.records
    .filter(
      (r) =>
        (page !== "收藏夹" || r.favorite) &&
        (page !== "最近使用" || !!r.usedAt) &&
        (!names.includes(page) || r.category === page) &&
        [r.name, r.website, r.url, r.username, r.category, r.tags]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      (page === "最近使用" ? b.usedAt : b.updatedAt).localeCompare(
        page === "最近使用" ? a.usedAt : a.updatedAt,
      ),
    );
  const menus = [
    ["全部账号", Grid2X2],
    ["收藏夹", Star],
    ["最近使用", Clock],
    ["密码生成器", KeyRound],
    ["设置", Settings],
  ] as const;
  function nav(name: string) {
    setPage(name);
    setSelected(null);
    setVisible(false);
    setChecked([]);
  }
  function download(text: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `密屿-${new Date().toISOString().slice(0, 10)}.vaultbackup`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="shell">
      <aside className="sidebar">
        {brand}
        <p className="nav-label">我的密码库</p>
        <nav>
          {menus.slice(0, 3).map(([name, Icon]) => (
            <button
              className={page === name ? "active" : ""}
              key={name}
              onClick={() => nav(name)}
            >
              <Icon size={19} />
              {name}
              {name === "全部账号" && (
                <span className="count">{data.records.length}</span>
              )}
            </button>
          ))}
          <p className="nav-label">分类</p>
          {names.map((name) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => nav(name)}
            >
              <Globe size={18} />
              {name}
            </button>
          ))}
          <button onClick={() => nav("自定义分类")}>
            <Plus size={18} />
            自定义分类
          </button>
          <p className="nav-label">工具</p>
          {menus.slice(3).map(([name, Icon]) => (
            <button
              key={name}
              className={page === name ? "active" : ""}
              onClick={() => nav(name)}
            >
              <Icon size={18} />
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ShieldCheck size={18} />
          <span>
            你的秘密，只属于你<small>端到端加密密码库</small>
          </span>
        </div>
      </aside>
      <div className="main">
        <header>
          <div className="search">
            <Search size={19} />
            <input
              aria-label="搜索密码库"
              placeholder="搜索名称、账号、网址或标签…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>本地搜索</kbd>
          </div>
          <button
            className="icon-button"
            aria-label="切换主题"
            onClick={toggleTheme}
          >
            {dark ? <Sun /> : <Moon />}
          </button>
          <button aria-label="锁定密码库" onClick={lock}>
            <LockKeyhole size={17} />
            <span>锁定</span>
          </button>
        </header>
        <main className="content">
          <div className="heading">
            <div>
              <span className="eyebrow">你的私人数字空间</span>
              <h1>{page}</h1>
            </div>
            <button
              className="primary"
              onClick={() => setEditing(emptyCredential())}
            >
              <Plus size={19} />
              新增账号
            </button>
          </div>
          <div className="sync">
            <span className={data.status.includes("失败") ? "warning" : ""}>
              ● {data.status}
              {data.pending > 0 && ` · ${data.pending} 项待上传`}
            </span>
            <span>
              {data.lastSync && `最后同步 ${data.lastSync}`}
              <button aria-label="重试同步" onClick={() => void data.sync()}>
                <RefreshCw size={14} />
                同步
              </button>
            </span>
          </div>
          {data.conflicts.map((m) => (
            <div className="banner" key={m.id}>
              记录{" "}
              {data.records.find((r) => r.id === m.id)?.name ||
                "分类或已删除项目"}{" "}
              在其他设备已修改。请选择保留的版本。
              <button onClick={() => void run(() => data.resolve(m, false))}>
                使用云端版本
              </button>
              <button
                onClick={() => {
                  if (confirm("确认用本地版本覆盖刚下载的云端版本？"))
                    void run(() => data.resolve(m, true));
                }}
              >
                保留本地版本
              </button>
            </div>
          ))}
          {page === "密码生成器" ? (
            <Generator
              copy={copy}
              save={(password) =>
                setEditing({ ...emptyCredential(), password })
              }
            />
          ) : page === "设置" ? (
            <section className="settings panel">
              <h2>安全与账户</h2>
              <button onClick={() => nav("自定义分类")}>管理自定义分类</button>
              <p>主密码和恢复密钥均丢失后，密码库无法恢复。</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  e.currentTarget.reset();
                  void run(async () => {
                    if (f.get("new") !== f.get("confirm"))
                      throw new Error("两次新主密码不一致");
                    const v = await rewrap(
                      vault,
                      String(f.get("old")),
                      String(f.get("new")),
                    );
                    await saveVault(v);
                    updateVault(v);
                    setToast("主密码已修改，账号密文无需重新加密");
                  });
                }}
              >
                <h3>修改主密码</h3>
                <label>
                  原主密码
                  <input
                    type="password"
                    name="old"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  新主密码
                  <input
                    type="password"
                    name="new"
                    minLength={12}
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  确认新主密码
                  <input
                    type="password"
                    name="confirm"
                    required
                    autoComplete="off"
                  />
                </label>
                <button disabled={busy}>修改主密码</button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  e.currentTarget.reset();
                  void run(async () => {
                    const { error } = await client!.auth.updateUser({
                      password: String(f.get("password")),
                      nonce: String(f.get("nonce") || "") || undefined,
                    });
                    if (error)
                      throw new Error(
                        "更新失败，请重新登录或获取验证代码后重试",
                      );
                    setToast("登录密码已修改");
                  });
                }}
              >
                <h3>修改登录密码</h3>
                <label>
                  新登录密码
                  <input
                    type="password"
                    name="password"
                    minLength={12}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  邮箱验证代码（账户要求重新验证时填写）
                  <input name="nonce" autoComplete="one-time-code" />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const { error } = await client!.auth.reauthenticate();
                      if (error) throw new Error("发送失败，请重新登录");
                      setToast("验证代码已发送至邮箱");
                    })
                  }
                >
                  发送验证代码
                </button>
                <button disabled={busy}>修改登录密码</button>
              </form>
              <h3>加密备份</h3>
              <p>
                备份包含加密记录与加密密钥。恢复时需要备份时的主密码，导入记录会作为新记录合并。
              </p>
              <button
                onClick={() =>
                  void run(async () =>
                    download(
                      await exportBackup(
                        cryptoKey,
                        vault,
                        data.records,
                        data.categories,
                      ),
                    ),
                  )
                }
              >
                <Download size={18} />
                导出加密备份
              </button>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget),
                    file = f.get("file") as File,
                    password = String(f.get("password"));
                  e.currentTarget.reset();
                  void run(async () => {
                    if (file.size > 20000000) throw new Error("文件超过 20 MB");
                    const imported = await importBackup(
                      await file.text(),
                      password,
                    );
                    if (!alive.current) return;
                    if (
                      !confirm(
                        `完整性校验通过，确认导入 ${imported.credentials.length} 条记录和 ${imported.categories.length} 个分类？`,
                      )
                    )
                      return;
                    await data.putMany(
                      "categories",
                      imported.categories.map((c) => ({
                        ...c,
                        id: crypto.randomUUID(),
                      })),
                    );
                    await data.putMany(
                      "credentials",
                      imported.credentials.map((r) => ({
                        ...r,
                        id: crypto.randomUUID(),
                        updatedAt: new Date().toISOString(),
                      })),
                    );
                    setToast("备份已导入，等待云端同步");
                  });
                }}
              >
                <label>
                  加密备份文件
                  <input
                    name="file"
                    type="file"
                    accept=".vaultbackup,application/json"
                    required
                  />
                </label>
                <label>
                  备份时的主密码
                  <input
                    name="password"
                    type="password"
                    required
                    autoComplete="off"
                  />
                </label>
                <button disabled={busy}>校验并恢复</button>
              </form>
              <h3>设备信任</h3>
              <p>
                {trusted
                  ? "已选择记住此设备的解锁状态。"
                  : "未记住解锁状态，重新打开需输入主密码。"}
              </p>
              <button onClick={lock}>取消设备信任并锁定</button>
              <p>
                要开启设备信任，请锁定后在解锁页勾选。切换应用和长时间闲置不会自动锁定。
              </p>
              <h3>剪贴板提醒</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={remind}
                  onChange={(e) => {
                    setRemind(e.target.checked);
                    localStorage.setItem(
                      "miyu-remind",
                      String(e.target.checked),
                    );
                  }}
                />
                复制 30 秒后提醒清理
              </label>
              <p>
                浏览器无法保证自动清除所有系统剪贴板内容。应用在后台时提醒可能被系统延迟。
              </p>
              <h3>安装到桌面</h3>
              <p>
                iPhone / iPad 在 Safari 点击分享 → 添加到主屏幕。Android 在
                Chrome 菜单选择安装应用。Windows 在 Edge 或 Chrome
                地址栏选择安装。
              </p>
              <button
                onClick={() => {
                  if (logout) void logout();
                  else {
                    lock();
                    void client?.auth.signOut({ scope: "local" });
                  }
                }}
              >
                <LogOut size={17} />
                退出登录
              </button>
            </section>
          ) : page === "自定义分类" ? (
            <section className="panel settings">
              <h2>自定义分类</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const name = String(f.get("name")).trim();
                  e.currentTarget.reset();
                  void run(async () => {
                    if (!name || names.includes(name))
                      throw new Error("分类名称为空或已存在");
                    await data.putMany("categories", [
                      { id: crypto.randomUUID(), name },
                    ]);
                  });
                }}
              >
                <label>
                  分类名称
                  <input name="name" maxLength={100} required />
                </label>
                <button className="primary">添加分类</button>
              </form>
              {data.categories.map((c) => (
                <div className="category-row" key={c.id}>
                  {c.name}
                  <button
                    onClick={() => {
                      if (data.records.some((r) => r.category === c.name)) {
                        setToast("请先将此分类中的账号移动到其他分类");
                        return;
                      }
                      if (confirm("确认删除这个分类？"))
                        void run(() => data.remove([c.id], "categories"));
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </section>
          ) : (
            <>
              <div className="stats">
                <div>
                  <span>全部账号</span>
                  <strong>
                    {data.records.length}
                    <Grid2X2 />
                  </strong>
                </div>
                <div>
                  <span>已收藏</span>
                  <strong>
                    {data.records.filter((r) => r.favorite).length}
                    <Star />
                  </strong>
                </div>
                <div>
                  <span>账号分类</span>
                  <strong>
                    {names.length}
                    <Globe />
                  </strong>
                </div>
              </div>
              <div className="recent">
                <span>
                  最近添加 ·{" "}
                  {[...data.records].sort((a, b) =>
                    b.createdAt.localeCompare(a.createdAt),
                  )[0]?.name || "暂无"}
                </span>
                <span>
                  最近修改 ·{" "}
                  {[...data.records].sort((a, b) =>
                    b.updatedAt.localeCompare(a.updatedAt),
                  )[0]?.name || "暂无"}
                </span>
              </div>
              <div className="list-toolbar">
                <span>{filtered.length} 条记录</span>
                <select
                  aria-label="分类筛选"
                  value={names.includes(page) ? page : ""}
                  onChange={(e) => nav(e.target.value || "全部账号")}
                >
                  <option value="">全部分类</option>
                  {names.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
                {checked.length > 0 && (
                  <button
                    className="danger"
                    onClick={() => {
                      if (
                        confirm(`确认永久删除所选 ${checked.length} 条记录？`)
                      )
                        void run(async () => {
                          await data.remove(checked);
                          setChecked([]);
                          setSelected(null);
                        });
                    }}
                  >
                    删除所选 ({checked.length})
                  </button>
                )}
              </div>
              <div className={`vault-layout ${current ? "has-detail" : ""}`}>
                <section className="record-list">
                  {filtered.length === 0 ? (
                    <div className="empty panel">
                      <div className="empty-icon">
                        <KeyRound size={34} />
                      </div>
                      <h2>
                        {search ? "没有匹配的账号" : "给重要账号一个安心的家"}
                      </h2>
                      <p>
                        {search
                          ? "试试其他名称、标签或用户名"
                          : "从添加第一个账号开始，随时安全取用。"}
                      </p>
                      <button onClick={() => setEditing(emptyCredential())}>
                        <Plus size={18} />
                        添加账号
                      </button>
                    </div>
                  ) : (
                    filtered.map((r) => (
                      <article
                        key={r.id}
                        className={`record ${selected === r.id ? "selected" : ""}`}
                      >
                        <input
                          aria-label={`选择 ${r.name}`}
                          type="checkbox"
                          checked={checked.includes(r.id)}
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? [...checked, r.id]
                                : checked.filter((x) => x !== r.id),
                            )
                          }
                        />
                        <button
                          className="record-main"
                          onClick={() => {
                            setSelected(r.id);
                            setVisible(false);
                          }}
                        >
                          <span className="avatar">
                            {r.name.slice(0, 1).toUpperCase()}
                          </span>
                          <span>
                            <strong>{r.name}</strong>
                            <small>
                              {r.username || r.email || "尚未填写账号"}
                            </small>
                            <em>{r.category}</em>
                          </span>
                        </button>
                        <button
                          aria-label={r.favorite ? "取消收藏" : "收藏"}
                          className={r.favorite ? "favorite" : ""}
                          onClick={() =>
                            void run(() =>
                              data.putMany("credentials", [
                                {
                                  ...r,
                                  favorite: !r.favorite,
                                  updatedAt: new Date().toISOString(),
                                },
                              ]),
                            )
                          }
                        >
                          <Star size={17} />
                        </button>
                        <button
                          aria-label={`复制 ${r.name} 账号`}
                          onClick={() => void copy(r.username, r)}
                        >
                          <Copy size={17} />
                        </button>
                        <button
                          className="copy-password"
                          aria-label={`复制 ${r.name} 密码`}
                          onClick={() => void copy(r.password, r)}
                        >
                          <KeyRound size={17} />
                          <span>复制密码</span>
                        </button>
                      </article>
                    ))
                  )}
                </section>
                {current && (
                  <aside className="detail panel">
                    <div className="detail-top">
                      <button
                        aria-label="关闭详情"
                        onClick={() => setSelected(null)}
                      >
                        <ArrowLeft size={18} />
                      </button>
                      <button onClick={() => setEditing({ ...current })}>
                        编辑
                      </button>
                      <button
                        aria-label="删除记录"
                        onClick={() => {
                          if (confirm(`确认永久删除「${current.name}」？`))
                            void run(async () => {
                              await data.remove([current.id]);
                              setSelected(null);
                            });
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                    <span className="avatar large">
                      {current.name.slice(0, 1)}
                    </span>
                    <h2>{current.name}</h2>
                    <p>{current.category}</p>
                    {(
                      [
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
                      ] as const
                    ).map((field) => (
                      <div className="field" key={field}>
                        <label>{labels[field]}</label>
                        <div>
                          <span>
                            {(field === "password" || field === "answer") &&
                            !visible
                              ? "••••••••"
                              : current[field] || "—"}
                          </span>
                          {field === "password" && (
                            <button
                              aria-label="显示或隐藏敏感字段"
                              onClick={() => setVisible(!visible)}
                            >
                              {visible ? (
                                <EyeOff size={18} />
                              ) : (
                                <Eye size={18} />
                              )}
                            </button>
                          )}
                          <button
                            aria-label={`复制${labels[field]}`}
                            onClick={() => void copy(current[field], current)}
                          >
                            <Copy size={17} />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      className="primary"
                      onClick={() =>
                        void copy(
                          `账号：${current.username}\n密码：${current.password}`,
                          current,
                        )
                      }
                    >
                      复制账号和密码
                    </button>
                    <button
                      onClick={() =>
                        void copy(
                          Object.entries(labels)
                            .map(
                              ([field, label]) =>
                                `${label}：${current[field as keyof Credential]}`,
                            )
                            .join("\n"),
                          current,
                        )
                      }
                    >
                      复制全部登录信息
                    </button>
                    <button
                      onClick={() =>
                        setEditing({
                          ...current,
                          id: crypto.randomUUID(),
                          name: `${current.name}（副本）`,
                          createdAt: new Date().toISOString(),
                        })
                      }
                    >
                      复制记录为新账号
                    </button>
                    <small>
                      创建于 {new Date(current.createdAt).toLocaleString()}
                      <br />
                      修改于 {new Date(current.updatedAt).toLocaleString()}
                    </small>
                  </aside>
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <nav className="bottom-nav">
        {menus.map(([name, Icon]) => (
          <button
            key={name}
            className={page === name ? "active" : ""}
            onClick={() => nav(name)}
          >
            <Icon size={20} />
            <span>{name === "密码生成器" ? "生成器" : name}</span>
          </button>
        ))}
      </nav>
      {editing && (
        <div className="overlay">
          <section className="modal wide">
            <div className="modal-title">
              <h2>
                {data.records.some((r) => r.id === editing.id)
                  ? "编辑账号"
                  : "新增账号"}
              </h2>
              <button aria-label="关闭编辑" onClick={() => setEditing(null)}>
                <X />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  if (!editing.name.trim()) throw new Error("请填写名称");
                  if (editing.url && !/^https?:\/\//i.test(editing.url))
                    throw new Error("网址请以 https:// 或 http:// 开头");
                  await data.putMany("credentials", [
                    {
                      ...editing,
                      name: editing.name.trim(),
                      updatedAt: new Date().toISOString(),
                    },
                  ]);
                  if (alive.current) {
                    setEditing(null);
                    setToast("已加密保存");
                  }
                });
              }}
            >
              <div className="form-grid">
                {Object.entries(labels).map(([field, label]) => (
                  <label
                    key={field}
                    className={field === "notes" ? "full" : ""}
                  >
                    {label}
                    {field === "category" ? (
                      <select
                        value={editing.category}
                        onChange={(e) =>
                          setEditing({ ...editing, category: e.target.value })
                        }
                      >
                        {names.map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    ) : field === "notes" ? (
                      <textarea
                        maxLength={10000}
                        value={editing.notes}
                        onChange={(e) =>
                          setEditing({ ...editing, notes: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        type={
                          field === "password" || field === "answer"
                            ? "password"
                            : field === "email"
                              ? "email"
                              : "text"
                        }
                        required={field === "name"}
                        maxLength={field === "name" ? 200 : 2000}
                        autoComplete="off"
                        value={String(editing[field as keyof Credential])}
                        onChange={(e) =>
                          setEditing({ ...editing, [field]: e.target.value })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={editing.favorite}
                  onChange={(e) =>
                    setEditing({ ...editing, favorite: e.target.checked })
                  }
                />
                加入收藏
              </label>
              <button
                type="button"
                onClick={() =>
                  setEditing({
                    ...editing,
                    password: generatePassword(
                      20,
                      [true, true, true, true],
                      true,
                    ),
                  })
                }
              >
                生成强密码
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "保存中…" : "加密保存"}
              </button>
            </form>
          </section>
        </div>
      )}
      {fallback !== null && (
        <div className="overlay">
          <section className="modal">
            <h2>手动复制</h2>
            <p>请长按或全选下方内容，再使用系统复制菜单。关闭后清除此显示。</p>
            <textarea
              readOnly
              value={fallback}
              onFocus={(e) => e.target.select()}
            />
            <button onClick={() => setFallback(null)}>关闭</button>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
function Generator({
  copy,
  save,
}: {
  copy: (text: string) => Promise<void>;
  save: (password: string) => void;
}) {
  const [length, setLength] = useState(20),
    [groups, setGroups] = useState([true, true, true, true]),
    [exclude, setExclude] = useState(true),
    [password, setPassword] = useState(() =>
      generatePassword(20, [true, true, true, true], true),
    ),
    [error, setError] = useState("");
  const bits =
    password.length *
    Math.log2(
      (/[A-Z]/.test(password) ? 26 : 0) +
        (/[a-z]/.test(password) ? 26 : 0) +
        (/\d/.test(password) ? 10 : 0) +
        (/[^A-Za-z0-9]/.test(password) ? 28 : 0),
    );
  return (
    <section className="generator panel">
      <div className="empty-icon">
        <KeyRound size={32} />
      </div>
      <h2>让随机，为你守密</h2>
      <p>使用设备的密码学安全随机源生成。</p>
      <output>{password}</output>
      <div className="strength">
        <span style={{ width: `${Math.min(100, bits)}%` }} />
      </div>
      <small>
        估算强度 · {bits >= 100 ? "很强" : bits >= 70 ? "强" : "一般"}（约{" "}
        {Math.floor(bits)} 位熵，上界估算）
      </small>
      <label>
        密码长度 <strong>{length}</strong>
        <input
          type="range"
          min={8}
          max={64}
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
        />
      </label>
      {["大写字母 A–Z", "小写字母 a–z", "数字 0–9", "特殊符号"].map((s, i) => (
        <label className="check" key={s}>
          <input
            type="checkbox"
            checked={groups[i]}
            onChange={(e) =>
              setGroups(groups.map((v, j) => (j === i ? e.target.checked : v)))
            }
          />
          {s}
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={exclude}
          onChange={(e) => setExclude(e.target.checked)}
        />
        排除易混淆字符 I l 1 O 0 o
      </label>
      <div className="generator-actions">
        <button
          onClick={() => {
            try {
              setPassword(generatePassword(length, groups, exclude));
              setError("");
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <RefreshCw size={17} />
          重新生成
        </button>
        <button onClick={() => void copy(password)}>
          <Copy size={17} />
          复制密码
        </button>
        <button className="primary" onClick={() => save(password)}>
          保存到密码库
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
