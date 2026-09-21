#!/usr/bin/env node
// NJU-Lab 复验 PoC 驱动：对数据集每个 case 跑 baseline（无 Skill）/ treatment（有 Skill）
// 两轮 headless 一次性运行，比对 output.csv 与 expected.csv，汇总结构化 JSON。
//
// 用法：
//   node run-eval.mjs --dataset <dir> [--skill <dir>] [--cases case01,case02]
//                     [--out result.json] [--timeout-ms 300000] [--dsh-home <dir>]
// 例：
//   node run-eval.mjs --dataset ../../server/fixtures/dataset \
//     --skill ../../server/fixtures/csv-cleaner --cases case01 --out result.json
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DSH_BIN = join(HERE, 'node_modules', '.bin', 'dsh');
const DSH_VERSION = '0.1.5-rc.2';
const PROFILE = 'nju-lab-verify';
const REPO_PROFILE = resolve(HERE, '..', 'profiles', PROFILE);

const CLEAN_RULES = `Cleaning rules:
1. Trim leading/trailing whitespace from every field.
2. Normalize the date column to YYYY-MM-DD (inputs may be YYYY/M/D, DD-MM-YYYY, YYYY.MM.DD).
3. After normalization, drop exact duplicate rows, keeping the first occurrence.
4. Drop any row that contains an empty field.
5. Keep the header row unchanged; keep rows in first-occurrence order.`;

function parseArgs(argv) {
  const opts = { cases: null, out: null, timeoutMs: 300_000, dshHome: join(HERE, '.dsh-home') };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') opts.dataset = resolve(argv[++i]);
    else if (a === '--skill') opts.skill = resolve(argv[++i]);
    else if (a === '--cases') opts.cases = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else if (a === '--dsh-home') opts.dshHome = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node run-eval.mjs --dataset <dir> [--skill <dir>] [--cases a,b] [--out f] [--timeout-ms n] [--dsh-home dir]');
      process.exit(0);
    } else { console.error(`unknown arg: ${a}`); process.exit(2); }
  }
  if (!opts.dataset) { console.error('--dataset is required'); process.exit(2); }
  return opts;
}

// 确保复验 profile 已装进 DSH_HOME（以仓库内 profile 为准，每次同步）。
function ensureProfile(dshHome) {
  const dest = join(dshHome, 'profiles', PROFILE);
  mkdirSync(join(dshHome, 'profiles'), { recursive: true });
  cpSync(REPO_PROFILE, dest, { recursive: true });
}

function listCases(opts) {
  const casesRoot = join(opts.dataset, 'cases');
  const all = readdirSync(casesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  return opts.cases ?? all;
}

function normalizeCsv(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

// 从 DSH session 日志（zstd 压缩 JSONL）提取 token 用量。
// 同一 usage 对象会出现在 chunk 与 assistant/message 两处，按序列化字符串去重。
// 注意：日志是**多帧** zstd（每次 flush 追加一帧），node:zlib 只解第一帧，
// 必须走 zstd CLI（容器镜像需带 zstd，或改用 dsh-session-log-export）。
function extractUsage(dshHome, sinceMs) {
  const tokens = { input: 0, output: 0, reasoning: 0 };
  let sessionId = null;
  const sessionsRoot = join(dshHome, 'sessions');
  if (!existsSync(sessionsRoot)) return { tokens, sessionId };
  const logs = [];
  for (const slug of readdirSync(sessionsRoot)) {
    const slugDir = join(sessionsRoot, slug);
    for (const sess of readdirSync(slugDir)) {
      const f = join(slugDir, sess, 'session.v3.jsonl.zstd');
      try {
        const st = spawnSync('stat', ['-c', '%Y', f]);
        if (st.status === 0 && Number(st.stdout) * 1000 >= sinceMs - 1000) logs.push({ f, sess });
      } catch { /* ignore */ }
    }
  }
  for (const { f, sess } of logs) {
    sessionId = sess;
    const dec = spawnSync('zstd', ['-dc', f], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' });
    if (dec.status !== 0) continue;
    const seen = new Set();
    for (const m of dec.stdout.matchAll(/"usage":\{[^}]*\}/g)) {
      if (seen.has(m[0])) continue;
      seen.add(m[0]);
      try {
        const u = JSON.parse(m[0].slice('"usage":'.length));
        tokens.input += u.inputTokens ?? 0;
        tokens.output += u.outputTokens ?? 0;
        tokens.reasoning += u.reasoningTokens ?? 0;
      } catch { /* ignore */ }
    }
  }
  return { tokens, sessionId };
}

function runRound({ opts, caseName, round, workdir }) {
  const treatment = round === 'treatment';
  const task = treatment
    ? `A skill is provided in ./skill (start from skill/SKILL.md). Use it to clean the dirty CSV file input.csv and write the cleaned result to output.csv in the current directory. You may inspect, fix, and run the skill's scripts. Finally make sure output.csv exists.`
    : `Clean the dirty CSV file input.csv and write the cleaned result to output.csv in the current directory.\n${CLEAN_RULES}\nFinally make sure output.csv exists. Reply briefly.`;

  const startedAt = Date.now();
  const proc = spawnSync(DSH_BIN, ['--profile', PROFILE, task], {
    cwd: workdir,
    env: {
      ...process.env,
      DSH_HOME: opts.dshHome,
      DSH_TELEMETRY_DISABLED: '1',
    },
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  const durationMs = Date.now() - startedAt;

  writeFileSync(join(workdir, 'stdout.txt'), proc.stdout ?? '');
  writeFileSync(join(workdir, 'stderr.txt'), proc.stderr ?? '');

  const outputPath = join(workdir, 'output.csv');
  const expectedPath = join(opts.dataset, 'cases', caseName, 'expected.csv');
  let pass = false;
  let passStrict = false;
  if (existsSync(outputPath)) {
    const actual = readFileSync(outputPath, 'utf8');
    const expected = readFileSync(expectedPath, 'utf8');
    // pass：行尾/换行符归一后一致；passStrict：diff 语义（逐字节）。
    pass = normalizeCsv(actual) === normalizeCsv(expected);
    passStrict = actual === expected;
  }
  const { tokens, sessionId } = extractUsage(opts.dshHome, startedAt);

  return {
    round,
    pass,
    passStrict,
    exitCode: proc.status,
    signal: proc.signal,
    timedOut: proc.error?.code === 'ETIMEDOUT' || proc.signal === 'SIGTERM',
    durationMs,
    tokens,
    sessionId,
    outputCsvExists: existsSync(outputPath),
    finalText: (proc.stdout ?? '').trim().slice(0, 500),
    error: proc.error ? String(proc.error.message ?? proc.error) : null,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  ensureProfile(opts.dshHome);

  const runRoot = join(HERE, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
  const cases = listCases(opts);
  const result = {
    evalVersion: 'poc-1',
    startedAt: new Date().toISOString(),
    dshVersion: DSH_VERSION,
    profile: PROFILE,
    model: { provider: 'deepseek-official', model: 'kimi-k2.6', reasoningEffort: 'low', maxTokens: 8192 },
    dataset: opts.dataset,
    skill: opts.skill ?? null,
    runRoot,
    cases: [],
  };

  for (const caseName of cases) {
    const caseDir = join(opts.dataset, 'cases', caseName);
    const entry = { case: caseName, rounds: {} };
    for (const round of ['baseline', 'treatment']) {
      if (round === 'treatment' && !opts.skill) continue;
      const workdir = join(runRoot, caseName, round);
      mkdirSync(workdir, { recursive: true });
      cpSync(join(caseDir, 'input.csv'), join(workdir, 'input.csv'));
      if (round === 'treatment') cpSync(opts.skill, join(workdir, 'skill'), { recursive: true });
      console.error(`[run] ${caseName}/${round} ...`);
      entry.rounds[round] = runRound({ opts, caseName, round, workdir });
      console.error(`[done] ${caseName}/${round}: pass=${entry.rounds[round].pass} exit=${entry.rounds[round].exitCode} in=${entry.rounds[round].tokens.input} out=${entry.rounds[round].tokens.output} ${entry.rounds[round].durationMs}ms`);
    }
    result.cases.push(entry);
  }

  const roundsOf = (r) => result.cases.map((c) => c.rounds[r]).filter(Boolean);
  const stat = (r) => {
    const rs = roundsOf(r);
    return {
      pass: `${rs.filter((x) => x.pass).length}/${rs.length}`,
      tokens: rs.reduce((a, x) => ({
        input: a.input + x.tokens.input, output: a.output + x.tokens.output,
      }), { input: 0, output: 0 }),
      durationMs: rs.reduce((a, x) => a + x.durationMs, 0),
    };
  };
  result.summary = { baseline: stat('baseline') };
  if (opts.skill) result.summary.treatment = stat('treatment');

  const json = JSON.stringify(result, null, 2);
  if (opts.out) { writeFileSync(opts.out, json + '\n'); console.error(`[ok] wrote ${opts.out}`); }
  else console.log(json);
}

main();
