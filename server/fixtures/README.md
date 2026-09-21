# 示例实验材料（fixtures）

"CSV 数据清洗"示例实验的模板与标准测试数据集。当前已上传到平台并绑定到两个示例项目：

- template.zip → sha256 `10486f5e…b8f6c1`（fileId `6c645480-9774-4db9-ac28-841bd4b3d666`）
- dataset.zip → sha256 `3f055d84…3befe1`（fileId `e2bd7953-9928-4370-a8df-2e5623c844d3`）

## 内容

- `csv-cleaner/` — Skill 模板源文件（SKILL.md 骨架 + scripts/clean.py + references/checklist.md），关键处留 TODO 引导学生
- `dataset/` — 3 个测试用例（input.csv 脏数据 + expected.csv 期望输出），`dataset/README.md` 写明参考清洗规则；数据集已用参考实现验证自洽（3/3）
- `template.zip` / `dataset.zip` — 上述目录的打包产物（修改源文件后需重新打包）

## 修改后重新发布

```sh
cd server/fixtures
zip -qr template.zip csv-cleaner && zip -qr dataset.zip dataset

# 上传（教师 token）
TOKEN=$(curl -s http://127.0.0.1:3100/api/auth/login -X POST \
  -H 'Content-Type: application/json' \
  -d '{"username":"teacher","password":"teacher123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["accessToken"])')
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@template.zip"
curl -s http://127.0.0.1:3100/api/files -X POST -H "Authorization: Bearer $TOKEN" -F "file=@dataset.zip"
# 拿到新的 fileId 后，PATCH /api/projects/:id 绑定（见 HANDOFF 第 2 节）
```

注意：数据集 `expected.csv` 是评分基准，修改任一 case 即视为新版本，注意已在进行中的实验不要中途换数据。
