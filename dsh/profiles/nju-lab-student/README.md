# nju-lab-student profile

学生本地 DSH 的启动形态：`dsh-base` + `dsh-web-app` + `nju-lab-client`。

## 安装到 Harness home

```sh
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
mkdir -p "$DSH_HOME/profiles"
cp -r nju-lab-student "$DSH_HOME/profiles/nju-lab-student"

# 本 profile 通过 file:../../nju-lab-client 依赖本地插件；从
# profiles/nju-lab-student/ 出发解析到 $DSH_HOME/nju-lab-client，
# 所以该路径必须存在（符号链接到仓库即可，分发时改真实拷贝）。
ln -sfn "<repo>/dsh/nju-lab-client" "$DSH_HOME/nju-lab-client"

# 装依赖（含本地插件 nju-lab-client）。注意：dsh plugin 需要 pnpm，
# 它把依赖装到 profile 目录下。
dsh plugin --profile nju-lab-student install
```

## 启动

```sh
dsh --profile nju-lab-student --no-open       # 启动（--profile 必须放在子命令前）
dsh --profile nju-lab-student --dump-config   # 检查最终组合树
```

## 约束

见 `cordis.patch.yml`：`workspace-write` + `ask`；`danger-full-access` 不提供。
插件配置里 `serverUrl` 默认取 `NJU_LAB_SERVER_URL` 环境变量。
