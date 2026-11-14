# 密屿 · 个人账号密码管家

React + TypeScript + Vite + Supabase 的独立 Web 项目。请将本目录作为独立 GitHub 仓库根目录。

## 本地启动

安装 Node.js 22 或更高版本，在本目录执行以下命令。

```powershell
npm ci
Copy-Item .env.example .env
# 按下方说明编辑 .env
npm run dev
```

浏览器打开终端显示的 localhost 地址。未配置 Supabase 时显示配置提示，真实账号功能在完成配置后可用。手机访问线上 HTTPS 网址，开发机的普通局域网 HTTP 地址无法满足 Web Crypto、剪贴板和 PWA 的安全上下文要求。

## Supabase 配置

1. 新建独立 Supabase 项目。在 SQL Editor 执行 `supabase/init.sql`，只在新数据库执行一次。
2. 在 Authentication 的 Email provider 开启邮箱确认，设置最低登录密码长度为 12。按需配置正式 SMTP 服务及邮件发送限额。
3. 从项目 API 设置复制 Project URL 和 publishable key 或 anon key。前端仅接受公开密钥。service_role 和 secret key 不得填写到任何 VITE 变量。
4. 在 `.env` 填写 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`。本地开发可将 `VITE_BASE_PATH` 设置为 `/`。
5. 在 Auth URL Configuration 设置 Site URL 为最终 HTTPS 地址，例如 `https://你的用户名.github.io/仓库名/`。Redirect URLs 加入该地址和开发地址 `http://localhost:5173/`。如果开发服务器显示 127.0.0.1，也加入 `http://127.0.0.1:5173/`。
6. 先注册测试邮箱，点击验证邮件，再登录创建密码库，离线保存恢复密钥。登录密码与密码库主密码应使用不同值。
7. 在第二个浏览器或手机登录相同账号，使用主密码解锁。已解锁设备每 15 秒拉取一次密文，写操作立即尝试同步。无需开启 Realtime publication。

云端配置当前需要用户提供。项目中没有预置 URL、用户、密钥或个人记录。

## GitHub Pages 部署

1. 将本目录源码提交到一个新的 GitHub 仓库，默认分支为 `main`。不要把外层工作区作为此应用仓库。
2. Repository Settings → Pages → Source 选择 GitHub Actions。
3. Settings → Secrets and variables → Actions 添加 Repository variable `VITE_SUPABASE_URL`。
4. 添加 Repository secret `VITE_SUPABASE_ANON_KEY`。该公开密钥最终会编入前端包，数据权限依靠 RLS。
5. 对项目站点，工作流默认使用 `/仓库名/`。自定义域名或 `用户名.github.io` 根站点需添加 Repository variable `VITE_BASE_PATH`，值设为 `/`。
6. 推送或手动触发 `.github/workflows/deploy.yml`。工作流运行测试、校验环境变量、构建和部署。
7. 将发布地址配置到 Supabase Auth，启用 GitHub Pages HTTPS。注册、重置邮件和主屏幕安装均使用这个地址。

应用使用单一 HTML 入口和内存中的页面切换。刷新任意功能页均访问入口网址，不产生子路径路由 404。Supabase 邮件验证回调由 SDK 处理，勿自行把令牌加入日志。

本地发布命令如下，产物位于 `dist/`。

```powershell
npm test
npm run build
npm run preview
```

随交付提供的预构建发布包用于检查静态页面和安装资源。正式连接云端必须填写环境变量后重新构建。

## 电脑使用

- 注册、验证邮箱、登录后，首次设置至少 12 字符主密码。
- 完整保存仅显示一次的恢复密钥，再进入密码库。
- 新增账号可填写网站、账号、密码、联系方式、安全问题、备注和标签。
- 列表右侧按钮直接复制账号或密码，点击记录名称打开所有字段详情。
- 详情提供逐字段复制、账号与密码合并复制、全部信息复制和复制记录。
- 勾选记录后可批量删除，所有删除都需确认。
- 搜索完全在本机解密后进行。分类和收藏也在本机筛选。
- 设置页可修改两类密码、导出加密备份、恢复备份、设置剪贴板提醒及退出。

## 手机和平板安装

- iPhone / iPad 使用 Safari 打开线上 HTTPS 地址，分享 → 添加到主屏幕。
- Android 使用 Chrome 打开同一地址，菜单 → 安装应用或添加到主屏幕。
- Windows 使用 Edge / Chrome 地址栏的安装入口。
- 图标、独立窗口、主题色和启动背景由 manifest 和平台生成。iOS 启动画面具体表现依系统版本。
- 手机底部提供常用导航，列表上方下拉框切换分类。自定义分类从设置入口进入。

## 加密与同步实现

- 每个密码库随机生成 256 位 DEK。主密码通过 PBKDF2-SHA256、16 字节随机盐、600,000 次迭代派生 KEK，使用 AES-256-GCM 包裹 DEK。
- 32 字节随机恢复密钥独立包裹同一 DEK。恢复密钥只显示一次，服务端只有其包裹后的 DEK。
- 每条记录、每个自定义分类整体 JSON 加密。IV 每次随机生成 12 字节，AAD 绑定密码库、表和记录 ID，防止记录替换。
- 修改主密码仅更新包裹 DEK。密码库行使用 version 条件更新，检测多设备同时改主密码。
- 主密码、明文 DEK 和明文记录不写入 LocalStorage。浏览器只持久化 Supabase 登录会话、主题偏好和按用户隔离的密文缓存及待同步密文。
- 刷新需重新解锁。后台切换或 pagehide 立即锁定，15 分钟无操作退出当前设备。锁定卸载密码库界面，释放密钥与明文引用。JavaScript 垃圾回收和系统内存擦除时间由浏览器控制。
- 离线编辑先写密文队列，恢复网络自动重试。数据库 RPC 以版本号进行原子比较并提交，重试同一密文具有幂等性。
- 冲突保留本地密文，提示采用云端版本或确认保留本地版本。删除通过相同版本校验处理。
- 同步元数据只含版本与时间，记录字段和分类名称均在密文中。数据库仍可看到记录数量、ID、密文长度及更新时间。
- 备份包含包裹后的 DEK 和 AES-GCM 加密负载。恢复先解密并验证认证标签及结构，再确认并重新加密为当前密码库中的新记录。
- Service Worker 仅预缓存构建时静态文件，没有 API 运行时缓存。离线队列由应用单独保存密文。

## 维护

- 变更前先导出加密备份。每次更新运行 `npm test` 和 `npm run build`，并在测试 Supabase 项目验证 RLS 和跨设备同步。
- SQL 后续改动使用新的迁移文件，不重复执行初始化脚本。保持已有加密参数和格式兼容。
- 定期检查依赖漏洞与 Supabase 公告，升级后重跑测试。`package-lock.json` 锁定构建依赖。
- PWA 新版本在旧页面关闭后接管。更新后关闭所有已安装窗口并重新打开，必要时清理静态站点缓存。
- 日志仅记录无敏感内容的操作状态。不得添加账号明文、搜索词、主密码、恢复密钥或剪贴板内容的日志、分析和错误上报。
- 使用 React 文本渲染，不插入 HTML。网站字段按 HTTP(S) 校验，界面不加载第三方网站图标。
- 发布前实际执行 `supabase/verify.sql` 并检查输出。`TEST-RESULTS.md` 记录本次验证范围。

## 已知边界

- 当前交付尚无真实 Supabase 配置及 GitHub 仓库，因此真实邮件认证、数据库执行、双设备云同步、线上安装和生产发布需要配置后验收。
- 离线待提交数据保存在当前浏览器。清除站点数据会删除尚未上传的密文，请先确认同步完成或导出备份。
- 恢复备份采用追加方式，会产生新 ID，多次导入会出现副本。分类先导入、记录后导入，极端存储失败可留下已导入分类，重试前可在分类管理删除空分类。
- 当前没有自动填充浏览器扩展，通过复制粘贴使用。复制后系统剪贴板可能被其他软件或系统历史读取，浏览器无法保证清除。
- 无离线登录。已登录且已解锁的页面支持断网编辑，刷新后需联网获取密码库元数据再解锁。
- 单个备份上限 20 MB、10,000 条记录，搜索在解锁后本地完成，较大的库受设备内存和浏览器存储配额限制。
- 这份实现尚未经独立安全审计。认证服务、部署来源、浏览器和设备的安全性共同影响密码库安全。

## 官方参考

- [Supabase 邮箱密码重置](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Vite GitHub Pages 部署](https://vite.dev/guide/static-deploy)
