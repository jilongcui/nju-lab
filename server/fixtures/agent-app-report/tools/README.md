# 造题说明

本实验的样例数据**直接复用** `../agent-app-studio/problem/cases/*` 的三份附件与 `report_format.json`
（同一家门诊、同一批材料），只删掉了提高档才需要的文件（`requests.jsonl` / `plan_stub.json` /
`tools.json` / `tool_calls.jsonl` / `limits.json` / `template.json` / `kb/`），并各加了一份 `brief.md`。

重算期望值：

```sh
cd server/fixtures/agent-app-report
docker run --rm --env-file ../../../server/.env --user "$(id -u):$(id -g)" \
  -v "$PWD:/w" -w /w --entrypoint python3 nju-lab-verify:0.2.0-rc.2-pkg6 \
  problem/reference/harness/run.py --regen-expected
```

> 图片走视觉（`deepseek-flash` 的 `image_url`），所以重算要带模型额度（`--env-file`）；
> 同一张图的输出格式会漂（空格/换行），但抽出来的行是稳定的。
