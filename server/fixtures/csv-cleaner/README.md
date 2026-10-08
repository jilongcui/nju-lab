# csv-cleaner —— CSV 数据清洗（内置回落型 / 最简样板）

「CSV 数据清洗」示例实验。它同时是**最简样板**（只有一块必要内容）与**历史回归基线**
（题目包故意不带 `task.md`/`judge.md`/`manifest.json`，走驱动内置语义）。

## 目录结构（实验项目的四块）

```
csv-cleaner/
├── problem/            → problem.zip        题目包：题面 + 判据 + IO 契约 + 用例（标准，不可改）
│   ├── README.md                           题面/清洗规则（本包是回落型：题面走驱动内置语义）
│   └── cases/case0N/{input.csv, expected.csv}
├── skill-template/     → skill-template.zip 学生起点：SKILL.md 骨架 + TODO
│   ├── SKILL.md  scripts/clean.py  references/checklist.md
├── skill-solution/                          满配 Skill = 标准答案（不打包、不下发）
│   ├── SKILL.md  scripts/clean.py
└── README.md
```

**同一个 Skill 目录形态、三处不同用途**（"Skill 三态"）：

| | 骨架 `skill-template/` | 满配 `skill-solution/` | 学生提交 |
|---|---|---|---|
| 谁用 | 学生起点 | 教师（答案） | 学生本人 |
| 会下发吗 | ✅ 打包成 `skill-template.zip` | ❌ 永不下发 | — |
| 完成度 | 关键处留 `TODO` | 全部填满 | 学生自己写 |
| 必须满足 | 唯一一层 `SKILL.md` | 同左（但不被校验） | 唯一一层 `SKILL.md` |

## 打包与上传

```sh
cd server/fixtures/csv-cleaner
rm -f skill-template.zip problem.zip
(cd skill-template && zip -qr ../skill-template.zip .)   # zip 根即 SKILL.md
(cd problem        && zip -qr ../problem.zip .)          # zip 根即 README.md + cases/

# 上传（教师 token）→ 拿 fileId → PATCH /api/projects/:id 绑定
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@skill-template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@problem.zip"
```

> 平台上绑定的是 **fileId**，与 zip 文件名无关；但文件名会作为学生下载到的原始名。
> 线上示例项目目前仍绑定 2026-10-01 上传的旧版包（`template.zip` / `dataset.zip`）——
> 想让新结构生效（含新文件名），按上面命令重新上传并绑定。

## 上传前自检（不烧 token）

```sh
docker run --rm -v "$PWD/server/fixtures/csv-cleaner:/p:ro" \
  nju-lab-verify:0.2.0-rc.2-pkg3 --check --skill /p/skill-template.zip --dataset /p/problem.zip
```

## 教师侧自检闭环：拿满配 Skill 跑一遍复验

`skill-solution/` 不下发，但**可以被复验直接当 Skill 装入**（驱动接受目录）——
这就是"题目可解性"的机器证明：

```sh
docker run --rm --env-file server/.env \
  -v "$PWD/server/fixtures/csv-cleaner:/p:ro" -v /tmp/out:/outputs \
  nju-lab-verify:0.2.0-rc.2-pkg3 \
  --skill /p/skill-solution --dataset /p/problem.zip --out /outputs/result.json
```

## 改口径时三处一起改

`problem/README.md`（题面/规则）、`problem/cases/*/expected.csv`（标准答案）、
`skill-solution/scripts/clean.py`（参考实现）是三份独立事实源，平台不做同步。
改完 `python3 skill-solution/scripts/clean.py --regen-cases` 重算期望值，再重新打包上传。

## 实测记录（2026-10-08）

- 满配 Skill 复现期望值：**3/3 逐字节一致**（`cmp` 无差异）
- 复验（`--skill skill-solution`，pkg3）：**3/3 通过**，`successRate=1`，30.3s / 1407 tokens
- ⚠️ **骨架也通过了**（`--skill skill-template.zip` → case01 pass）：题面与规则足够清楚时，
  模型能临场把清洗做对，用不上脚本里的 TODO。这不是包的 bug，而是**区分度问题** ——
  简单任务上"用不用 Skill"都可能做对。要提高区分度，让口径更细（更多边界/陷阱用例），
  而不是把信息藏进模板。
