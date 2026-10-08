#!/usr/bin/env node
// NJU-Lab 复验驱动（生产版，运行于 nju-lab-verify 一次性容器内）。
//
// 输入：skill.zip|dir + dataset.zip|dir → 逐 case 跑一轮 dsh headless
// （approval=never / workspace-write），按 judge-mode 评分，输出单个结构化结果 JSON。
//
// **单轮（无 baseline）**：2026-10-06 起平台取消 baseline（"只给题干"）轮 ——
// 面向学生的实验只判「学生交付的工具是否产出了正确结果」，不再度量 lift。
// 因此 --skill 是必需输入，驱动不再产出 baseline 汇总。
//
// **任务知识随数据集包走（包驱动）** —— 数据集 ZIP 根目录可放三个可选文件：
//   manifest.json  机器读的结构声明（输出文件名 / 输入文件 / judgeMode / 依赖）
//   task.md        任务提示（被测 agent 看到的题干）
//   judge.md       评分细则（LLM judge 的判据）
// 三者都不放 → **逐字回落内置的「CSV 数据清洗」行为**（历史数据集与在跑实验零影响）。
// 由此：新增实验类型只需重新上传数据集包，裁判程序与镜像都不动 ——
// 题目与评分细则由教师的包决定，执行与判分口径由平台钉死。
//
// 用法：
//   node run-eval.mjs --skill <zip|dir> --dataset <zip|dir> --out <result.json>
//     [--judge-mode llm|exact]          默认取包内 manifest.judgeMode，再回落 llm
//     [--cases case01,case02 | --max-cases N]   默认全部 case
//     [--timeout-ms N]                  dsh 单轮运行上限，默认 300000
//     [--dsh-home DIR]                  默认 $DSH_HOME 或 /tmp/dsh-home
//     [--profile-src DIR]               nju-lab-verify profile 源目录
//     [--check]                         只解析与校验包（结构 + 依赖），不跑模型、不烧 token
//
// 模型配置（环境变量）：DEEPSEEK_API_KEY（官方，优先）或 MOONSHOT_API_KEY（OpenAI 兼容回退）；
//   VERIFY_MODEL（默认 deepseek-flash）、VERIFY_BASE_URL（默认 https://api.deepseek.com）、
//   VERIFY_JUDGE_MODEL（默认同 VERIFY_MODEL）。judge 与 eval 同 provider（平台决策）。
// DeepSeek 官方实测（2026-09-21，GET /models + chat/completions）：
//   可用模型 deepseek-flash / deepseek-v4-pro；
//   reasoning_effort 合法值 none|minimal|low|medium|high|xhigh|max。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const DSH_BIN = join(HERE, 'node_modules', '.bin', 'dsh');
const DSH_VERSION = '0.2.0-rc.2';
const PROFILE = 'nju-lab-verify';
const MODEL = process.env.VERIFY_MODEL || 'deepseek-flash';
const BASE_URL = process.env.VERIFY_BASE_URL || 'https://api.deepseek.com';
const JUDGE_MODEL = process.env.VERIFY_JUDGE_MODEL || MODEL;
const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.MOONSHOT_API_KEY;

// ---------- 内置回落：CSV 数据清洗 ----------
// 数据集包没放 task.md / judge.md 时用这一套，保证历史数据集行为逐字不变。

// 评判规则：来自标准数据集 README，与题干（task.md）共用同一份事实源。
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

const BUILTIN_TASK = `A skill is provided in ./skill (start from skill/SKILL.md). Use it to clean the dirty CSV file input.csv and write the cleaned result to output.csv in the current directory. You may inspect, fix, and run the skill's scripts. Finally make sure output.csv exists.`;

/**
 * 包内含 judge.md 时的判分 prompt 外壳。
 * 平台统一的只有「输出形状 + 差异容忍口径」，判据正文由教师的 judge.md 提供 ——
 * 教师定评分口径，平台保证结果可解析、可比较、口径一致。
 */
function judgeShell(rules) {
  return `你是一个严格执行教师给定评分细则的评判器。给定评分细则、期望产出与实际产出，判断实际产出是否达到要求。

判定原则（平台统一，教师细则不得与之冲突）：
- 行尾空白、行末换行符数量、CRLF/LF 换行符差异不扣分；其余差异（键名、字段值、行数、行序、格式与取值）都要扣分。
- pass = 达到细则要求；score 0~1 表示达成程度（1=完全达成，0=完全不符）。

只输出一个 JSON 对象，不要输出其他内容：{"pass": true|false, "score": 0~1, "rationale": "中文一句话说明判定依据，不通过时指出具体差异"}

教师评分细则：
${rules}`;
}

function fail(message) {
  console.error(`run-eval: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    judgeMode: null, cases: null, maxCases: 0, out: null, check: false,
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
    else if (a === '--check') opts.check = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node run-eval.mjs --skill <zip|dir> --dataset <zip|dir> [--out f] [--judge-mode llm|exact] [--cases a,b|--max-cases n] [--timeout-ms n] [--dsh-home dir] [--profile-src dir] [--check]');
      process.exit(0);
    } else fail(`unknown arg: ${a}`);
  }
  if (!opts.dataset) fail('--dataset is required');
  if (opts.judgeMode !== null && !['llm', 'exact'].includes(opts.judgeMode)) fail('--judge-mode must be llm or exact');
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

function cleanup() {
  for (const d of cleanupDirs) spawnSync('rm', ['-rf', d]);
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
  if (withCases.length === 1) return join(withCases[0].name);
  fail(`invalid dataset package: no unique cases/ layer under ${dir}`);
}

// ---------- 数据集的包声明（manifest.json / task.md / judge.md） ----------

const EXPECTED_RE = /^expected(\..+)?$/i;

/**
 * 读数据集包的声明。三者皆无 → 全部回落内置「CSV 数据清洗」语义。
 * 缺某个字段只在字段级回落，不做静默猜测以外的处理。
 */
function readDatasetSpec(datasetRoot) {
  const spec = {
    name: null,
    title: null,
    outputFile: 'output.csv',
    inputs: null,
    judgeMode: null,
    maxCases: 0,
    requires: { python: [], commands: [] },
    taskPrompt: null,
    judgeRules: null,
    source: 'builtin',
    files: { manifest: false, task: false, judge: false },
  };

  const manifestPath = join(datasetRoot, 'manifest.json');
  if (existsSync(manifestPath)) {
    spec.files.manifest = true;
    spec.source = 'manifest';
    let raw;
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      fail(`dataset/manifest.json 不是合法 JSON: ${e.message}`);
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      fail('dataset/manifest.json 必须是 JSON 对象');
    }
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== 1) {
      fail(`dataset/manifest.json 的 schemaVersion=${raw.schemaVersion} 不被本驱动支持（当前支持 1）`);
    }
    if (raw.name !== undefined) spec.name = String(raw.name);
    if (raw.title !== undefined) spec.title = String(raw.title);
    if (raw.outputFile !== undefined) {
      const v = String(raw.outputFile).replace(/^\.\//, '');
      if (!v || v.startsWith('/') || v.split('/').includes('..')) {
        fail(`dataset/manifest.json 的 outputFile 非法（须是工作目录内的相对路径）: ${raw.outputFile}`);
      }
      spec.outputFile = v;
    }
    if (raw.inputs !== undefined) {
      if (!Array.isArray(raw.inputs) || raw.inputs.some((x) => typeof x !== 'string')) {
        fail('dataset/manifest.json 的 inputs 必须是字符串数组（相对 case 目录的路径）');
      }
      spec.inputs = raw.inputs;
    }
    if (raw.judgeMode !== undefined) {
      if (!['llm', 'exact'].includes(raw.judgeMode)) {
        fail(`dataset/manifest.json 的 judgeMode 只能是 llm 或 exact: ${raw.judgeMode}`);
      }
      spec.judgeMode = raw.judgeMode;
    }
    if (raw.maxCases !== undefined) spec.maxCases = Number(raw.maxCases) || 0;
    if (raw.requires !== undefined) {
      const req = raw.requires ?? {};
      if (typeof req !== 'object' || Array.isArray(req)) {
        fail('dataset/manifest.json 的 requires 必须是对象，如 {"python": ["pandas"], "commands": ["jq"]}');
      }
      spec.requires = {
        python: Array.isArray(req.python) ? req.python.map(String) : [],
        commands: Array.isArray(req.commands) ? req.commands.map(String) : [],
      };
    }
  }

  const taskPath = join(datasetRoot, 'task.md');
  if (existsSync(taskPath)) {
    spec.files.task = true;
    spec.taskPrompt = readFileSync(taskPath, 'utf8').trim();
    if (!spec.taskPrompt) fail('dataset/task.md 是空的：题干不能为空');
  }
  const judgePath = join(datasetRoot, 'judge.md');
  if (existsSync(judgePath)) {
    spec.files.judge = true;
    spec.judgeRules = readFileSync(judgePath, 'utf8').trim();
    if (!spec.judgeRules) fail('dataset/judge.md 是空的：评分细则不能为空');
  }

  return spec;
}

/**
 * 依赖自检：包声明要用的 Python 模块 / 命令必须在镜像里存在，缺了就明确失败（不静默）。
 *
 * `requires.python` 按 **import 名**校验（`yaml` / `bs4` / `dateutil`），同时认常见的
 * pip 包名（`PyYAML` / `beautifulsoup4` / `python-dateutil` / `Pillow` / `scikit-learn`）——
 * 教师写声明时不必区分这两套命名，否则会误报"依赖缺失"。
 */
const PY_MODULE_ALIASES = {
  pyyaml: 'yaml',
  'beautifulsoup4': 'bs4',
  'python-dateutil': 'dateutil',
  pillow: 'PIL',
  'scikit-learn': 'sklearn',
  'opencv-python': 'cv2',
  'python-docx': 'docx',
  'python-pptx': 'pptx',
};

function checkRequires(spec) {
  const missing = [];
  const py = spec.requires?.python ?? [];
  const cmds = spec.requires?.commands ?? [];
  for (const raw of py) {
    // 允许写 "pandas>=2.0"：只取包名做存在性校验（版本约束靠镜像预装集保证）
    const base = String(raw).split(/[<>=!~\s\[]/)[0].trim();
    if (!base) continue;
    const mod = PY_MODULE_ALIASES[base.toLowerCase()] ?? base;
    const r = spawnSync('python3', ['-c', `import importlib.util,sys;sys.exit(0 if importlib.util.find_spec(${JSON.stringify(mod)}) else 1)`], { encoding: 'utf8' });
    if (r.status !== 0) missing.push(`python:${base}${mod === base ? '' : ` (import ${mod})`}`);
  }
  for (const raw of cmds) {
    const c = String(raw).trim();
    if (!c) continue;
    const r = spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' });
    if (r.status !== 0) missing.push(`command:${c}`);
  }
  return { ok: missing.length === 0, missing, declared: { python: py, commands: cmds } };
}

/** case 输入文件：manifest.inputs 优先，否则 case 目录下除 expected.* 之外的全部条目。 */
function caseInputs(caseDir, spec) {
  if (spec.inputs?.length) {
    return spec.inputs.map((rel) => {
      const abs = join(caseDir, rel);
      if (!existsSync(abs)) {
        fail(`case 声明的输入不存在：${abs}（manifest.inputs 写的是相对 case 目录的路径）`);
      }
      return { rel, abs };
    });
  }
  return readdirSync(caseDir, { withFileTypes: true })
    .filter((e) => !EXPECTED_RE.test(e.name))
    .map((e) => ({ rel: e.name, abs: join(caseDir, e.name) }));
}

/** case 期望产出：expected.<outputFile 的扩展名>，或目录下唯一的 expected.* 。 */
function caseExpected(caseDir, spec) {
  const cands = readdirSync(caseDir).filter((f) => EXPECTED_RE.test(f));
  if (cands.length === 0) {
    fail(`case 缺少期望产出文件（expected.*）：${caseDir}`);
  }
  const wantName = `expected${extname(spec.outputFile)}`.toLowerCase();
  const exact = cands.find((f) => f.toLowerCase() === wantName);
  const picked = exact ?? (cands.length === 1 ? cands[0] : null);
  if (!picked) {
    fail(`case 有多个候选期望产出且无法断定（outputFile=${spec.outputFile}）：${caseDir} → ${cands.join(', ')}`);
  }
  return { name: picked, path: join(caseDir, picked) };
}

/** 任务提示：包内 task.md（占位符替换 + 兜底补产出要求），否则内置 CSV 题干。 */
function buildTaskPrompt({ spec, inputs, outputFile }) {
  if (!spec.taskPrompt) return BUILTIN_TASK;
  const firstInput = inputs[0]?.rel ?? '输入文件';
  let text = spec.taskPrompt
    .replace(/\{\{\s*input\s*\}\}/g, firstInput)
    .replace(/\{\{\s*inputs\s*\}\}/g, inputs.map((i) => i.rel).join(', '))
    .replace(/\{\{\s*output\s*\}\}/g, outputFile)
    .replace(/\{\{\s*skill\s*\}\}/g, './skill');
  // 题干里没提到产出文件名时补一句，否则任务不可完成。
  if (!text.includes(outputFile)) {
    text += `\n\n产出要求：把结果写到当前目录的 ${outputFile}，完成后确认该文件存在。`;
  }
  text += `\n\n一个 Skill 已提供在 ./skill（从 skill/SKILL.md 开始读）。优先使用它完成任务：可以检查、修正并运行其中的脚本。`;
  return text;
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

/** 文本归一：换行统一 LF、去尾部空白、末尾补一个换行（exact 模式与内容比对用）。 */
function normalizeText(text) {
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

function runRound({ opts, spec, inputs, workdir }) {
  const task = buildTaskPrompt({ spec, inputs, outputFile: spec.outputFile });

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

  const outputPath = join(workdir, spec.outputFile);
  const outputText = existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : null;
  const { tokens, sessionId } = extractUsage(opts.dshHome, startedAt);
  return {
    exitCode: proc.status,
    timedOut: proc.error?.code === 'ETIMEDOUT' || proc.signal === 'SIGTERM',
    durationMs,
    tokens,
    sessionId,
    outputText,
    finalText: (proc.stdout ?? '').trim().slice(0, 500),
    error: proc.error ? String(proc.error.message ?? proc.error) : null,
  };
}

// ---------- judge ----------

async function judgeWithLlm({ spec, expected, expectedName, actual }) {
  if (!API_KEY) throw new Error('DEEPSEEK_API_KEY or MOONSHOT_API_KEY is required for llm judge');
  const useBuiltin = !spec.judgeRules;
  const body = {
    model: JUDGE_MODEL,
    // kimi-k2.6 只允许 temperature=1（400 invalid temperature），不传用默认
    max_tokens: 1024,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: useBuiltin ? JUDGE_PROMPT : judgeShell(spec.judgeRules) },
      {
        role: 'user',
        content: useBuiltin
          ? `清洗规则：\n${CLEAN_RULES}\n\nexpected.csv：\n${expected}\n\noutput.csv：\n${actual ?? '(未生成)'}`
          : `期望产出（${expectedName}）：\n${expected}\n\n实际产出（${spec.outputFile}）：\n${actual ?? '(未生成)'}`,
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

function judgeExact({ spec, expected, expectedName, actual }) {
  if (actual === null) {
    return { pass: false, score: 0, rationale: `未生成 ${spec.outputFile}`, judgeTokens: { input: 0, output: 0 } };
  }
  const pass = normalizeText(actual) === normalizeText(expected);
  return {
    pass,
    score: pass ? 1 : 0,
    rationale: pass
      ? `与 ${expectedName} 完全一致（exact 模式）`
      : `与 ${expectedName} 不一致（exact 模式）`,
    judgeTokens: { input: 0, output: 0 },
  };
}

function judge(mode, args) {
  return mode === 'llm' ? judgeWithLlm(args) : judgeExact(args);
}

// ---------- 主流程 ----------

function listCases(datasetRoot, opts, spec) {
  const casesDir = join(datasetRoot, 'cases');
  let names = readdirSync(casesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  if (opts.cases) names = names.filter((c) => opts.cases.includes(c));
  const max = opts.maxCases > 0 ? opts.maxCases : (spec.maxCases > 0 ? spec.maxCases : 0);
  if (max > 0) names = names.slice(0, max);
  if (names.length === 0) fail('no cases to run');
  return names;
}

/** 包结构自检摘要（--check 的输出，也是复验结果里的可追溯快照）。 */
function inspectPackage({ datasetRoot, spec, skillRoot, caseNames }) {
  return {
    datasetRoot,
    source: spec.source,
    name: spec.name,
    title: spec.title,
    outputFile: spec.outputFile,
    inputs: spec.inputs,
    judgeMode: spec.judgeMode,
    maxCases: spec.maxCases,
    requires: spec.requires,
    declaredFiles: spec.files,
    taskPromptSource: spec.taskPrompt ? 'dataset/task.md' : 'builtin(csv-cleaner)',
    judgeRulesSource: spec.judgeRules ? 'dataset/judge.md' : 'builtin(csv-cleaner)',
    cases: caseNames.map((name) => {
      const caseDir = join(datasetRoot, 'cases', name);
      return {
        name,
        inputs: caseInputs(caseDir, spec).map((i) => i.rel),
        expected: caseExpected(caseDir, spec).name,
      };
    }),
    skill: skillRoot
      ? { root: skillRoot, files: Object.keys(hashTree(skillRoot)), info: scanSkillMd(skillRoot) }
      : null,
  };
}

async function main() {
  const opts = parseArgs(process.argv);

  const datasetRoot = resolveDatasetRoot(unpack(opts.dataset, 'dataset'));
  const spec = readDatasetSpec(datasetRoot);
  const skillRoot = opts.skill ? resolveSkillRoot(unpack(opts.skill, 'skill')) : null;
  // 单轮复验必须带 Skill：baseline 轮已取消，"没有 Skill 的裸做"不再是评测对象。
  if (!opts.check && !skillRoot) {
    fail('--skill is required：baseline 轮已取消，复验只跑「使用 Skill」一轮');
  }
  const caseNames = listCases(datasetRoot, opts, spec);
  // 判分模式优先级：命令行（平台项目配置）> 包内 manifest > 内置 llm
  const judgeMode = opts.judgeMode ?? spec.judgeMode ?? 'llm';
  const judgeModel = judgeMode === 'llm' ? JUDGE_MODEL : null;

  const deps = checkRequires(spec);
  const pkg = inspectPackage({ datasetRoot, spec, skillRoot, caseNames });

  if (opts.check) {
    console.log(JSON.stringify({
      check: 'ok',
      dshVersion: DSH_VERSION,
      profile: PROFILE,
      judge: { mode: judgeMode, model: judgeModel },
      package: pkg,
      dependencyCheck: deps,
    }, null, 2));
    cleanup();
    if (!deps.ok) {
      fail(`依赖自检未通过：${deps.missing.join(', ')}（镜像预装集里没有这些；需在镜像里补装后重建）`);
    }
    return;
  }

  // 依赖缺失直接失败：不做「跑到一半才发现脚本跑不起来」的静默降级。
  if (!deps.ok) {
    fail(`实验包声明的依赖在复验镜像中缺失：${deps.missing.join(', ')}（镜像预装集见 server/verify-image/README.md）`);
  }

  ensureProfile(opts);
  const skillFileHashes = skillRoot ? hashTree(skillRoot) : null;

  const runRoot = mkdtempSync(join(tmpdir(), 'nju-verify-runs-'));
  const result = {
    evalVersion: 'docker-3',
    startedAt: new Date().toISOString(),
    dshVersion: DSH_VERSION,
    profile: PROFILE,
    model: { provider: 'deepseek-official', baseURL: BASE_URL, model: MODEL, reasoningEffort: 'low', maxTokens: 8192 },
    judge: { mode: judgeMode, model: judgeModel },
    package: pkg,
    dependencyCheck: deps,
    skillFileHashes,
    skillInfo: skillRoot ? scanSkillMd(skillRoot) : null,
    cases: [],
  };

  for (const caseName of caseNames) {
    const caseDir = join(datasetRoot, 'cases', caseName);
    const inputs = caseInputs(caseDir, spec);
    const expected = caseExpected(caseDir, spec);
    const expectedText = readFileSync(expected.path, 'utf8');
    const workdir = join(runRoot, caseName, 'run');
    mkdirSync(workdir, { recursive: true });
    for (const inp of inputs) {
      const dest = join(workdir, inp.rel);
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(inp.abs, dest, { recursive: true });
    }
    cpSync(skillRoot, join(workdir, 'skill'), { recursive: true });
    console.error(`[run] ${caseName} ...`);
    const r = runRound({ opts, spec, inputs, workdir });
    const j = await judge(judgeMode, {
      spec,
      expected: expectedText,
      expectedName: expected.name,
      actual: r.outputText,
    });
    r.judge = { pass: j.pass, score: j.score, rationale: j.rationale };
    r.tokens.input += j.judgeTokens.input;
    r.tokens.output += j.judgeTokens.output;
    delete r.outputText; // 结果 JSON 不带全量输出，只带判定（输出留在容器内 workdir）
    console.error(`[done] ${caseName}: pass=${j.pass} score=${j.score} exit=${r.exitCode} in=${r.tokens.input} out=${r.tokens.output} ${r.durationMs}ms`);
    result.cases.push({ case: caseName, ...r });
  }

  const rs = result.cases;
  const passCount = rs.filter((x) => x.judge.pass).length;
  result.summary = {
    passCount,
    runs: rs.length,
    successRate: rs.length ? Math.round((passCount / rs.length) * 100) / 100 : 0,
    avgScore: rs.length ? Math.round((rs.reduce((a, x) => a + x.judge.score, 0) / rs.length) * 100) / 100 : 0,
    tokens: rs.reduce((a, x) => ({ input: a.input + x.tokens.input, output: a.output + x.tokens.output }), { input: 0, output: 0 }),
    durationMs: rs.reduce((a, x) => a + x.durationMs, 0),
  };

  const json = JSON.stringify(result, null, 2);
  if (opts.out) { writeFileSync(opts.out, json + '\n'); console.error(`[ok] wrote ${opts.out}`); }
  else console.log(json);
  for (const d of [...cleanupDirs, runRoot]) {
    spawnSync('rm', ['-rf', d]);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
