# NJU-Lab × DSH（本地侧构件）

本目录是 `nju-lab-client-design.md` 的落地实现，与 `server/`、`web/` 并列。

```
dsh/
  nju-lab-client/           # 定制客户端双半插件（host + client）
  profiles/
    nju-lab-student/        # 学生本地：base + web-app + nju-lab-client
    nju-lab-verify/         # 平台复验：base + headless（approval=never）
  dev/
    overlay.yml             # 本地调试 overlay（指向 TS 源）
  scripts/
    smoke.sh                # 冒烟：把 host 半装进 web 并确认加载
```

## 版本锁定

锁定 `@deepseek-ai/dsh@0.1.7-rc.2`（rc 阶段，官方明示破坏性变更；学期内不升级）。

## 快速开始

```sh
# 1. 构建插件（profile 经由 lib/ 产物加载，必须先构建）
(cd dsh/nju-lab-client && npm install && npm run build)

# 2. 冒烟：确认插件能被 DSH 加载
dsh/scripts/smoke.sh

# 3. 装学生 profile（需要 pnpm：`dsh plugin` 用它安装 profile 依赖）
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$DSH_HOME/profiles"
cp -r dsh/profiles/nju-lab-student "$DSH_HOME/profiles/"
# 该 profile 依赖声明为 file:../../nju-lab-client，从 profiles/<name>/ 出发
# 解析到 $DSH_HOME/nju-lab-client，因此这个路径必须存在：符号链接到仓库即可，
# 分发到别的机器时改为真实拷贝。
ln -sfn "$PWD/dsh/nju-lab-client" "$DSH_HOME/nju-lab-client"
dsh plugin --profile nju-lab-student install
dsh --profile nju-lab-student --dump-config | grep -A2 nju-lab-client

# 4. 起学生端（--profile 是全局选项，必须写在子命令之前；
#    `dsh web --profile <name>` 会报 unknown option —— dsh web 只是 --profile web 的别名）
dsh --profile nju-lab-student --no-open
```

详见 `../nju-lab-client-design.md`、`nju-lab-client/README.md` 与各 profile 的 README。
