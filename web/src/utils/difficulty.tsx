import { Tag } from 'antd';
import type { ProjectDifficulty } from '../types';

/**
 * 实验难度（2026-10-13）：容易 / 中等 / 提高。
 *
 * 口径在**一处**：标签文字、颜色、顺序、筛选项都由这里派生 ——
 * 教师端（设置与列表）、学生端（详情页、章节右栏、工作台待办）都引用它。
 * `null` 一律表示"老师还没标注"，此时不显示任何标签（不是"默认容易"）。
 */
export const DIFFICULTY_ORDER: ProjectDifficulty[] = ['easy', 'medium', 'hard'];

export const DIFFICULTY_META: Record<ProjectDifficulty, { label: string; color: string }> = {
  easy: { label: '容易', color: 'green' },
  medium: { label: '中等', color: 'blue' },
  hard: { label: '提高', color: 'volcano' },
};

/** 难度标签：未标注时渲染为 null（不占位、不留空标签） */
export function DifficultyTag({ difficulty }: { difficulty?: ProjectDifficulty | null }) {
  if (!difficulty) return null;
  const meta = DIFFICULTY_META[difficulty];
  if (!meta) return null;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 学生/教师列表的难度筛选项（含"全部"） */
export const DIFFICULTY_FILTER_OPTIONS = [
  { label: '全部难度', value: 'all' },
  ...DIFFICULTY_ORDER.map((value) => ({ label: DIFFICULTY_META[value].label, value })),
];
