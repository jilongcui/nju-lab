import { Link } from 'react-router-dom';
import { Empty, List, Space, theme, Typography } from 'antd';
import { ExperimentOutlined, FilePptOutlined, LockOutlined } from '@ant-design/icons';
import type { Assignment, Chapter } from '../types';
import StatusTag from './StatusTag';
import { DifficultyTag } from '../utils/difficulty';

const { Paragraph, Text } = Typography;

interface ExperimentPanelProps {
  /** 本课程全部章节（含各章实验摘要），调用方已按 order 排好 —— 组件只取当前章那一项 */
  chapters: Chapter[];
  /** 当前所在章节：**右栏只列这一章**的实验 */
  currentChapterId?: string;
  /** student：显示解锁状态与我的任务状态；teacher：显示实验的发布状态 */
  mode: 'student' | 'teacher';
  /** 仅 student 模式使用：`GET /me/assignments` 的结果 */
  assignments?: Assignment[];
}

/**
 * 右栏「实验」tab 的内容：**当前章节**的实验 + 一键进入。
 *
 * 为什么放右栏（2026-10-13 用户选定）：右栏常驻、可折叠，与「章节」tab 并列后，
 * 学生在章节课里就能看到并进入实验，不必「退出章节 → 回课程详情 → 再点实验」；
 * 教师端（章节编辑 / 幻灯片页）同理。
 *
 * **只列当前章**（同日用户补充：原先列全课程 15 个实验，右栏又挤又难找）：
 * 左面正在看哪一章，右栏就给哪一章的实验；要跳别的章，切章节即可。
 * 因此也没有难度筛选 —— 一章通常 1–3 个实验，难度标签已足够，再摆个筛选框只会更挤。
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
  const chapterIndex = chapters.findIndex((item) => item.id === currentChapterId);
  const chapter = chapterIndex >= 0 ? chapters[chapterIndex] : null;
  const projects = chapter?.projects ?? [];

  return (
    <>
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
        {mode === 'student'
          ? '点实验名直接进入实验页；未解锁的实验需先完成本实验所属章节。'
          : '点实验名进入该实验详情（实验内容、提交与批改）。'}
      </Paragraph>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {chapter ? `第 ${chapterIndex + 1} 章 · 共 ${projects.length} 个实验` : '本章实验'}
      </Text>
      {projects.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="本章还没有实验"
          style={{ marginTop: 12 }}
        />
      ) : (
        <List
          size="small"
          style={{ marginTop: 4 }}
          dataSource={projects}
          renderItem={(project, index) => {
            const assignment =
              mode === 'student'
                ? assignments.find((item) => item.project.id === project.id)
                : undefined;
            const unlocked = mode === 'teacher' || (assignment?.unlocked ?? false);
            return (
              <List.Item style={{ padding: '8px 4px' }}>
                <Link
                  to={`/${mode}/projects/${project.id}`}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%', minWidth: 0 }}
                >
                  {unlocked ? (
                    <ExperimentOutlined style={{ marginTop: 3 }} />
                  ) : (
                    <LockOutlined style={{ marginTop: 3, color: token.colorTextTertiary }} />
                  )}
                  {/* 标题独占一行（不再挤右侧标签），标签放第二行 —— 280px 宽也不显得拥挤 */}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Text ellipsis={{ tooltip: project.title }} style={{ fontSize: 13, display: 'block' }}>
                      {index + 1}. {project.title}
                    </Text>
                    <Space size={4} wrap style={{ marginTop: 2 }}>
                      <DifficultyTag difficulty={project.difficulty} />
                      {mode === 'teacher' ? (
                        <StatusTag status={project.status} />
                      ) : (
                        assignment &&
                        assignment.status !== 'pending' && <StatusTag status={assignment.status} />
                      )}
                    </Space>
                  </span>
                </Link>
              </List.Item>
            );
          }}
        />
      )}
      {mode === 'teacher' && (
        <>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            <FilePptOutlined style={{ marginRight: 4 }} />
            {chapter
              ? `本章课件 ${chapter.slideCount ?? 0} 页（在「幻灯片」页生成/编辑）`
              : '课件页数见章节「幻灯片」页'}
          </Text>
        </>
      )}
    </>
  );
}
