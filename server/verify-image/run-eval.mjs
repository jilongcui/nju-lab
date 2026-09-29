#!/usr/bin/env node
// NJU-Lab 复验驱动（生产版，运行于 nju-lab-verify 一次性容器内）。
//
// 输入：skill.zip|dir + dataset.zip|dir + 评判配置 → 逐 case 跑 baseline/treatment
// 两轮 dsh headless（approval=never / workspace-write），按 judge-mode 评分，
// 输出单个结构化结果 JSON。
//
// 用法：
//   node run-eval.mjs --skill <zip|dir> --dataset <zip|dir> --out <result.json>
//     [--judge-mode llm|exact]          默认 llm（LLM judge，平台钉死 prompt/模型）
//     [--cases case01,case02 | --max-cases N]   默认全部 case
//     [--timeout-ms N]                  每轮 dsh 运行上限，默认 300000
//     [--dsh-home DIR]                  默认 $DSH_HOME 或 /tmp/dsh-home
//     [--profile-src DIR]               nju-lab-verify profile 源目录
//
// 模型配置（环境变量）：DEEPSEEK_API_KEY（官方，优先）或 MOONSHOT_API_KEY（OpenAI 兼容回退）；
//   VERIFY_MODEL（默认 deepseek-flash）、VERIFY_BASE_URL（默认 https://api.deepseek.com）、
//   VERIFY_JUDGE_MODEL（默认同 VERIFY_MODEL）。judge 与 eval 同 provider（平台决策）。
// DeepSeek 官方实测（2026-09-21，GET /models + chat/completions）：
//   可用模型 deepseek-flash / deepseek-v4-pro；
//   reasoning_effort 合法值 none|minimal|low|medium|high|xhigh|max。
//
// 遗留（生产化）：网络白名单代理——当前容器网络不隔离，模型 API 与学生 Skill
// 的任意出站请求混在同一网络面，需在容器编排层加 egress 白名单代理。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DSH_BIN = join(HERE, 'node_modules', '.bin', 'dsh');
const DSH_VERSION = '0.1.7-rc.2';
const PROFILE = 'nju-lab-verify';
const MODEL = process.env.VERIFY_MODEL || 'deepseek-flash';
const BASE_URL = process.env.VERIFY_BASE_URL || 'https://api.deepseek.com';
const JUDGE_MODEL = process.env.VERIFY_JUDGE_MODEL || MODEL;
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.MOONSHOT_API_KEY;

// 评判规则：来自标准数据集 README，judge prompt 与 baseline 任务共用同一份事实源。
const CLEAN_RULES = `Cleaning rules:
1. Trim leading/trailing whitespace from every field.
2. Normalize the date column to YYYY-MM-DD (inputs may be YYYY/M/D, DD-MM-YYYY, YYYY.MM.DD).
3. After normalization, drop exact duplicate rows, keeping the first occurrence.
4. Drop any row that contains an empty field.
5. Keep the header row unchanged; keep rows in first-occurrence order.`;

// 平台钉死的 judge prompt（教师批改页消费 rationale；不要随学生输入变化）
const JUDGE_PROMPT = `你是一个严格的 CSV 数据清洗结果评判器。给定清洗规则、期望输出 expected.csv 和实际输出 output.csv，判断实际输出是否达到清洗目标。

评判标准：
- 数据行内容是否与期望输出等价（字段值逐行对比）。
- 行尾空白、行末换行符数量、CRLF/LF 换行符差异不扣分；其他差异（字段值、行数、行序、日期格式、表头）都要扣分。
- pass = 完全等价；score 0~1 表示等价程度（1=完全等价，0=完全错误）。

只输出一个 JSON 对象，不要输出其他内容：{"pass": true|false, "score": 0~1, "rationale": "中文一句话说明判定依据，不通过时指出具体差异"}`;

function fail(message) {
  console.error(`run-eval: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    judgeMode: 'llm', cases: null, maxCases: 0, out: null,
    timeoutMs: 300_000, dshHome: process.env.DSH_HOME || '/tmp/dsh-home',
    profileSrc: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--skill') opts.skill = resolve(argv[++i]);
    else if (a === '--dataset') opts.dataset = resolve(argv[++i]);
    else if (a === '--out') opts.out = resolve(argv[++i]);
    else if (a === '--judge-mode') opts.judgeMode = argv[++i];
    else if (a === '--cases') opts.cases = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--max-cases') opts.maxCases = Number(argv[++i]);
    else if (a === '--timeout-ms') opts.timeoutMs = Number(argv[++i]);
    else if (a === '--dsh-home') opts.dshHome = resolve(argv[++i]);
    else if (a === '--profile-src') opts.profileSrc = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      console.log('usage: node run-eval.mjs --skill <zip|dir> --dataset <zip|dir> [--out f] [--judge-mode llm|exact] [--cases a,b|--max-cases n] [--timeout-ms n] [--dsh-home dir] [--profile-src dir]');
      process.exit(0);
    } else fail(`unknown arg: ${a}`);
  }
  if (!opts.dataset) fail('--dataset is required');
  if (!['llm', 'exact'].includes(opts.judgeMode)) fail('--judge-mode must be llm or exact');
  return opts;
}

// ---------- 解包与根解析 ----------

const cleanupDirs = [];

/** ZIP 解到临时目录；目录原样返回。返回待解析根目录。 */
function unpack(path, kind) {
  if (!existsSync(path)) fail(`${kind} not found: ${path}`);
  if (!path.toLowerCase().endsWith('.zip')) return path;
  const dest = mkdtempSync(join(tmpdir(), `nju-verify-${kind}-`));
  cleanupDirs.push(dest);
  const r = spawnSync('unzip', ['-q', path, '-d', dest], { encoding: 'utf8' });
  if (r.status !== 0) fail(`unzip ${kind} failed: ${r.stderr || r.stdout}`);
  return dest;
}

/**
 * resolveSkillRoot 语义：含 SKILL.md 的那一层为 Skill 根。
 * 允许 ZIP 带一层顶层目录；多层或无 SKILL.md 视为非法提交物。
 */
function resolveSkillRoot(dir) {
  if (existsSync(join(dir, 'SKILL.md'))) return dir;
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const withSkillMd = entries.filter((e) => existsSync(join(dir, e.name, 'SKILL.md')));
  if (withSkillMd.length === 1) return join(dir, withSkillMd[0].name);
  fail(`invalid skill package: no unique SKILL.md layer under ${dir}`);
}

/** 数据集根：含 cases/ 的那一层（同样允许一层顶层目录）。 */
function resolveDatasetRoot(dir) {
  if (existsSync(join(dir, 'cases'))) return dir;
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const withCases = entries.filter((e) => existsSync(join(dir, e.name, 'cases')));
  if (withCases.length === 1) return join(dir, withCases[0].name);
  fail(`invalid dataset package: no unique cases/ layer under ${dir}`);
}

/** Skill 根下全部文件的 sha256 登记（相对路径 -> hex），供服务端完整性对照。 */
function hashTree(root) {
  const hashes = {};
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, rel);
      else hashes[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(root, '');
  return hashes;
}

/** SKILL.md 实测档案扫描：能力边界是否填写（无 TODO 残留）、踩坑记录条数。 */
function scanSkillMd(root) {
  try {
    const md = readFileSync(join(root, 'SKILL.md'), 'utf8');
    const section = (title) => {
      const m = new RegExp(`##[^\\n]*${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(md);
      return m?.[1] ?? '';
    };
    const boundary = section('能力边界');
    // 踩坑记录可能是独立二级标题，也可能是「实测档案」等小节的列表项（平台模板即后者）
    let pitfallsText = section('踩坑记录');
    if (!pitfallsText.trim()) {
      const m = /踩坑记录[^\n]*\n((?:[ \t]+(?:[-*]|\d+\.)[^\n]*\n?)+)/.exec(md);
      pitfallsText = m?.[1] ?? '';
    }
    return {
      boundariesDocumented: boundary.trim() !== '' && !boundary.includes('TODO'),
      pitfallsRecorded: pitfallsText.split('\n').filter((l) => /^\s*(?:[-*]|\d+\.)\s*\S/.test(l) && !l.includes('TODO')).length,
    };
  } catch {
    return { boundariesDocumented: false, pitfallsRecorded: 0 };
  }
}

// ---------- dsh 运行 ----------

function ensureProfile(opts) {
  const src = opts.profileSrc
    ?? [join(HERE, 'profile', PROFILE), join(HERE, '..', 'profiles', PROFILE)].find(existsSync);
  if (!src) fail('nju-lab-verify profile source not found');
  const dest = join(opts.dshHome, 'profiles', PROFILE);
  cpSync(src, dest, { recursive: true });
  // 逐项目模型映射：平台经 VERIFY_MODEL / VERIFY_REASONING_EFFORT 下发
  // project.evalConfig（"学生自测条件 = 平台复验条件"），此处改写拷贝后的
  // patch（镜像内的模板保持不变）。值做白名单校验，防 YAML 注入。
  const patchFile = join(dest, 'cordis.patch.yml');
  let yml = readFileSync(patchFile, 'utf8');
  const safe = (v) => (/^[a-z0-9][a-z0-9._-]*$/i.test(v) ? v : null);
  const model = safe(process.env.VERIFY_MODEL || '');
  const effort = safe(process.env.VERIFY_REASONING_EFFORT || '');
  if (model) yml = yml.replace(/^(\s*)model: .+$/m, `$1model: ${model}`);
  if (effort) yml = yml.replace(/^(\s*)reasoningEffort: .+$/m, `$1reasoningEffort: ${effort}`);
  if (model || effort) writeFileSync(patchFile, yml);
}

function normalizeCsv(text) {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

// 从 DSH session 日志（多帧 zstd JSONL，必须走 zstd CLI）提取 token 用量。
function extractUsage(dshHome, sinceMs) {
  const tokens = { input: 0, output: 0, reasoning: 0 };
  let sessionId = null;
  const sessionsRoot = join(dshHome, 'sessions');
  if (!existsSync(sessionsRoot)) return { tokens, sessionId };
  for (const slug of readdirSync(sessionsRoot)) {
    for (const sess of readdirSync(join(sessionsRoot, slug))) {
      const f = join(sessionsRoot, slug, sess, 'session.v3.jsonl.zstd');
      if (!existsSync(f)) continue;
      const ageMs = Date.now() - Number(spawnSync('stat', ['-c', '%Y', f]).stdout) * 1000;
      if (Date.now() - ageMs < sinceMs - 1000) continue;
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
    env: { ...process.env, DSH_HOME: opts.dshHome, DSH_TELEMETRY_DISABLED: '1' },
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  const durationMs = Date.now() - startedAt;
  writeFileSync(join(workdir, 'stdout.txt'), proc.stdout ?? '');
  writeFileSync(join(workdir, 'stderr.txt'), proc.stderr ?? '');

  const outputPath = join(workdir, 'output.csv');
  const outputCsv = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
  const { tokens, sessionId } = extractUsage(opts.dshHome, startedAt);
  return {
    round,
    exitCode: proc.status,
    timedOut: proc.error?.code === 'ETIMEDOUT' || proc.signal === 'SIGTERM',
    durationMs,
    tokens,
    sessionId,
    outputCsv,
    finalText: (proc.stdout ?? '').trim().slice(0, 500),
    error: proc.error ? String(proc.error.message ?? proc.error) : null,
  };
}

// ---------- judge ----------

async function judgeWithLlm({ expectedCsv, actualCsv }) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY or MOONSHOT_API_KEY is required for llm judge');
  const body = {
    model: JUDGE_MODEL,
    // kimi-k2.6 只允许 temperature=1（400 invalid temperature），不传用默认
    max_tokens: 1024,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: JUDGE_PROMPT },
      {
        role: 'user',
        content: `清洗规则：\n${CLEAN_RULES}\n\nexpected.csv：\n${expectedCsv}\n\noutput.csv：\n${actualCsv ?? '(未生成)'}`,
      },
    ],
  };
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    const usage = data.usage ?? {};
    const text = data.choices?.[0]?.message?.content ?? '';
    try {
      const m = text.replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m[0]);
      return {
        pass: Boolean(parsed.pass),
        score: Math.max(0, Math.min(1, Number(parsed.score) || 0)),
        rationale: String(parsed.rationale ?? '').slice(0, 500),
        judgeTokens: {
          input: usage.prompt_tokens ?? 0,
          output: usage.completion_tokens ?? 0,
        },
      };
    } catch (e) { lastError = new Error(`judge output not parseable: ${text.slice(0, 200)}`); }
  }
  throw lastError;
}

function judgeExact({ expectedCsv, actualCsv }) {
  if (actualCsv === null) {
    return { pass: false, score: 0, rationale: '未生成 output.csv', judgeTokens: { input: 0, output: 0 } };
  }
  const pass = normalizeCsv(actualCsv) === normalizeCsv(expectedCsv);
  return {
    pass,
    score: pass ? 1 : 0,
    rationale: pass ? '与 expected.csv 完全一致（exact 模式）' : '与 expected.csv 不一致（exact 模式）',
    judgeTokens: { input: 0, output: 0 },
  };
}

async function judge(opts, expectedCsv, actualCsv) {
  const args = { expectedCsv, actualCsv };
  return opts.judgeMode === 'llm' ? judgeWithLlm(args) : judgeExact(args);
}

// ---------- 主流程 ----------

async function main() {
  const opts = parseArgs(process.argv);
  ensureProfile(opts);

  const datasetRoot = resolveDatasetRoot(unpack(opts.dataset, 'dataset'));
  const skillRoot = opts.skill ? resolveSkillRoot(unpack(opts.skill, 'skill')) : null;
  const skillFileHashes = skillRoot ? hashTree(skillRoot) : null;

  let caseNames = readdirSync(join(datasetRoot, 'cases'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (opts.cases) caseNames = caseNames.filter((c) => opts.cases.includes(c));
  if (opts.maxCases > 0) caseNames = caseNames.slice(0, opts.maxCases);
  if (caseNames.length === 0) fail('no cases to run');

  const runRoot = mkdtempSync(join(tmpdir(), 'nju-verify-runs-'));
  const result = {
    evalVersion: 'docker-1',
    startedAt: new Date().toISOString(),
    dshVersion: DSH_VERSION,
    profile: PROFILE,
    model: { provider: 'deepseek-official', baseURL: BASE_URL, model: MODEL, reasoningEffort: 'low', maxTokens: 8192 },
    judge: { mode: opts.judgeMode, model: opts.judgeMode === 'llm' ? JUDGE_MODEL : null },
    skillFileHashes,
    skillInfo: skillRoot ? scanSkillMd(skillRoot) : null,
    cases: [],
  };

  for (const caseName of caseNames) {
    const caseDir = join(datasetRoot, 'cases', caseName);
    const expectedCsv = readFileSync(join(caseDir, 'expected.csv'), 'utf8');
    const entry = { case: caseName, rounds: {} };
    for (const round of ['baseline', 'treatment']) {
      if (round === 'treatment' && !skillRoot) continue;
      const workdir = join(runRoot, caseName, round);
      mkdirSync(workdir, { recursive: true });
      cpSync(join(caseDir, 'input.csv'), join(workdir, 'input.csv'));
      if (round === 'treatment') cpSync(skillRoot, join(workdir, 'skill'), { recursive: true });
      console.error(`[run] ${caseName}/${round} ...`);
      const r = runRound({ opts, caseName, round, workdir });
      const j = await judge(opts, expectedCsv, r.outputCsv);
      r.judge = { pass: j.pass, score: j.score, rationale: j.rationale };
      r.tokens.input += j.judgeTokens.input;
      r.tokens.output += j.judgeTokens.output;
      delete r.outputCsv; // 结果 JSON 不带全量输出，只带判定（输出留在容器内 workdir）
      entry.rounds[round] = r;
      console.error(`[done] ${caseName}/${round}: pass=${j.pass} score=${j.score} exit=${r.exitCode} in=${r.tokens.input} out=${r.tokens.output} ${r.durationMs}ms`);
    }
    result.cases.push(entry);
  }

  const roundsOf = (r) => result.cases.map((c) => c.rounds[r]).filter(Boolean);
  const stat = (r) => {
    const rs = roundsOf(r);
    return {
      passCount: rs.filter((x) => x.judge.pass).length,
      runs: rs.length,
      successRate: rs.length ? Math.round((rs.filter((x) => x.judge.pass).length / rs.length) * 100) / 100 : 0,
      avgScore: rs.length ? Math.round((rs.reduce((a, x) => a + x.judge.score, 0) / rs.length) * 100) / 100 : 0,
      tokens: rs.reduce((a, x) => ({ input: a.input + x.tokens.input, output: a.output + x.tokens.output }), { input: 0, output: 0 }),
      durationMs: rs.reduce((a, x) => a + x.durationMs, 0),
    };
  };
  result.summary = { baseline: stat('baseline') };
  if (skillRoot) result.summary.treatment = stat('treatment');

  const json = JSON.stringify(result, null, 2);
  if (opts.out) { writeFileSync(opts.out, json + '\n'); console.error(`[ok] wrote ${opts.out}`); }
  else console.log(json);
  for (const d of [...cleanupDirs, runRoot]) {
    spawnSync('rm', ['-rf', d]);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
