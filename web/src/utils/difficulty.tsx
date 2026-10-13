import { Tag } from 'antd';
import type { ProjectDifficulty } from '../types';

/**
 * 实验难度（2026-10-13）：容易 / 中等 / 提高。
 *
 * 口径在**一处**：标签文字、颜色、顺序、筛选项都由这里派生 ——
 * 教师端（设置与列表）、学生端（详情页、章节右栏、工作台待办）都引用它。
 *
 * **难度不允许为空**（同日用户补充）：列 NOT NULL、默认 `medium`，
 * 老师没特意标就是「中等」，所以学生端总能按难度筛选、界面不再出现"未标注"。
 */
export const DIFFICULTY_ORDER: ProjectDifficulty[] = ['easy', 'medium', 'hard'];

/** 没指定难度时的默认值（与后端列默认值一致，见 migration 1791100000000） */
export const DEFAULT_DIFFICULTY: ProjectDifficulty = 'medium';

export const DIFFICULTY_META: Record<ProjectDifficulty, { label: string; color: string }> = {
  easy: { label: '容易', color: 'green' },
  medium: { label: '中等', color: 'blue' },
  hard: { label: '提高', color: 'volcano' },
};

/** 难度标签。传空仍安全返回 null（老数据/异常兜底），但正常路径上难度一定有值 */
export function DifficultyTag({ difficulty }: { difficulty?: ProjectDifficulty | null }) {
  const meta = difficulty ? DIFFICULTY_META[difficulty] : undefined;
  if (!meta) return null;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 学生/教师列表的难度筛选项（含"全部"） */
export const DIFFICULTY_FILTER_OPTIONS = [
  { label: '全部难度', value: 'all' },
  ...DIFFICULTY_ORDER.map((value) => ({ label: DIFFICULTY_META[value].label, value })),
];

/** 表单里的难度选项（三档齐全，没有"未标注"—— 难度不允许为空） */
export const DIFFICULTY_FORM_OPTIONS = DIFFICULTY_ORDER.map((value) => ({
  label: DIFFICULTY_META[value].label,
  value,
}));
