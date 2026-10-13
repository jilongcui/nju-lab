import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, List, Select, Space, theme, Typography } from 'antd';
import { ExperimentOutlined, LockOutlined } from '@ant-design/icons';
import type { Assignment, Chapter, ProjectDifficulty } from '../types';
import StatusTag from './StatusTag';
import { DIFFICULTY_FILTER_OPTIONS, DifficultyTag } from '../utils/difficulty';

const { Paragraph, Text } = Typography;

interface ExperimentPanelProps {
  /** 本课程全部章节（含各章实验摘要），调用方已按 order 排好 */
  chapters: Chapter[];
  /** 当前所在章节：它的实验高亮 —— "刚学完这章，该做哪几个实验"一眼可见 */
  currentChapterId?: string;
  /** student：显示解锁状态与我的任务状态；teacher：显示实验的发布状态 */
  mode: 'student' | 'teacher';
  /** 仅 student 模式使用：`GET /me/assignments` 的结果 */
  assignments?: Assignment[];
}

/**
 * 右栏「实验」tab 的内容：本课程**各章实验一览** + 一键进入。
 *
 * 为什么放右栏而不是工具栏按钮（2026-10-13 用户选定）：右栏常驻、可折叠，与「章节」tab
 * 并列后，学生在章节课里就能看到并进入实验，不必「退出章节 → 回课程详情 → 再点实验」。
 * 教师端（章节编辑 / 幻灯片页）同理，右栏本来就是 tabs。
 *
 * 学生端「未解锁」只作提示：点进去仍能看到实验说明（与课程详情页既有行为一致）。
 * **学生端不会有草稿实验**：`GET /courses/:id` 对学生只返回已发布实验
 * （后端唯一口径，见 `CoursesService.getCourse`），前端不再重复过滤。
 */
export default function ExperimentPanel({
  chapters,
  currentChapterId,
  mode,
  assignments = [],
}: ExperimentPanelProps) {
  const { token } = theme.useToken();
  /** 难度筛选（2026-10-13）：老师标了难度后，学生可按自己的水平挑 */
  const [difficulty, setDifficulty] = useState<'all' | ProjectDifficulty>('all');

  // 章节顺序展开成"实验行"：每行记住所属章节，便于显示「第 N 章 · 章节名」
  const rows = chapters.flatMap((chapter, index) =>
    (chapter.projects ?? []).map((project) => ({
      chapter,
      chapterNo: index + 1,
      project,
    })),
  );
  const currentTotal = rows.filter((row) => row.chapter.id === currentChapterId).length;
  const visibleRows = difficulty === 'all' ? rows : rows.filter((row) => row.project.difficulty === difficulty);
  /**
   * 难度列 NOT NULL、默认「中等」，所以正常情况下筛选控件总是有用；
   * 保留这个判断只是兜底（老接口/异常数据里没有难度时不摆一个空筛选）。
   */
  const hasDifficulty = rows.some((row) => !!row.project.difficulty);

  return (
    <>
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {mode === 'student'
          ? '点实验名直接进入实验页；未解锁的实验需先完成前置章节。本章实验已高亮。老师标注难度后，可按难度挑选。'
          : '点实验名进入该实验详情（实验内容、提交与批改）。'}
      </Paragraph>
      <Text type="secondary" style={{ fontSize: 12 }}>
        本课程共 {rows.length} 个实验
        {currentChapterId ? ` · 本章 ${currentTotal} 个` : ''}
        {difficulty !== 'all' ? ` · 当前显示 ${visibleRows.length} 个` : ''}
      </Text>
      {hasDifficulty && (
        <Select
          size="small"
          value={difficulty}
          onChange={(value) => setDifficulty(value)}
          options={DIFFICULTY_FILTER_OPTIONS}
          style={{ width: '100%', margin: '8px 0' }}
        />
      )}
      {rows.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="本课程还没有实验"
          style={{ marginTop: 12 }}
        />
      ) : (
        <List
          size="small"
          style={{ marginTop: 4 }}
          dataSource={visibleRows}
          locale={{ emptyText: '这个难度下暂时没有实验' }}
          renderItem={({ chapter, chapterNo, project }) => {
            const current = chapter.id === currentChapterId;
            const assignment =
              mode === 'student'
                ? assignments.find((item) => item.project.id === project.id)
                : undefined;
            const unlocked = mode === 'teacher' || (assignment?.unlocked ?? false);
            return (
              <List.Item
                style={{
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: current ? token.colorPrimaryBg : undefined,
                }}
              >
                <Link
                  to={`/${mode}/projects/${project.id}`}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%', minWidth: 0 }}
                >
                  {unlocked ? (
                    <ExperimentOutlined style={{ marginTop: 3 }} />
                  ) : (
                    <LockOutlined style={{ marginTop: 3, color: token.colorTextTertiary }} />
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text strong={current} ellipsis={{ tooltip: project.title }} style={{ fontSize: 13, display: 'block' }}>
                      {project.title}
                    </Text>
                    <Text type="secondary" ellipsis={{ tooltip: chapter.title }} style={{ fontSize: 12, display: 'block' }}>
                      第 {chapterNo} 章 · {chapter.title}
                    </Text>
                  </span>
                  <Space size={4} style={{ flexShrink: 0 }}>
                    <DifficultyTag difficulty={project.difficulty} />
                    {mode === 'teacher' ? (
                      <StatusTag status={project.status} />
                    ) : (
                      assignment &&
                      assignment.status !== 'pending' && <StatusTag status={assignment.status} />
                    )}
                  </Space>
                </Link>
              </List.Item>
            );
          }}
        />
      )}
    </>
  );
}
