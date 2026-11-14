# 完整项目文件目录

源码文件如下。安装依赖后生成 node_modules，构建后生成 dist。

```text
personal-vault/
  .env.example
  .github/workflows/deploy.yml
  .gitignore
  index.html
  package-lock.json
  package.json
  public/icon-192.png
  public/icon-512.png
  README.md
  scripts/check-env.mjs
  src/App.tsx
  src/backend.ts
  src/backup.ts
  src/clipboard.ts
  src/crypto.ts
  src/main.tsx
  src/store.ts
  src/styles.css
  src/types.ts
  src/useVault.ts
  supabase/init.sql
  supabase/verify.sql
  TEST-RESULTS.md
  tests/clipboard.test.ts
  tests/database.test.ts
  tests/interface.test.tsx
  tests/preview.html
  tests/preview.tsx
  tests/security.test.ts
  tsconfig.json
  vite.config.ts
  DIRECTORY.md
  dist/  # 生产构建产物，单独发布包包含完整内容
```
