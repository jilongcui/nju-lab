import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  message,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { DownloadOutlined, LockOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  claimAssignment,
  downloadStoredFile,
  getProject,
  listMyAssignments,
  resetAssignment,
} from '../../api';
import type { Assignment, ExperimentProject, RubricItem } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import { DifficultyTag } from '../../utils/difficulty';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

/**
 * 学生端实验详情页。
 *
 * 2026-10-13 学员反馈重新分层（此前把十来个字段平铺，页面又长又"技术"：
 * 最显眼的反而是评估模型/推理档位这些配置，真正的题面却只存在于题目包里）：
 *   · **首屏 = 实验本身（做什么）**：实验内容 + 实验目标 + 难度/章节/截止 + 领取按钮；
 *     领取后紧跟着「实验材料」下载 —— 学生第一眼就要知道"这实验是干嘛的、我要交什么"。
 *   · **「实验指导」折叠区（怎么做）**：背景知识、任务要求（口径）、评分要求、参考资料、
 *     常见问题、运行环境与评估配置 —— 技术细节不该跟"做什么"抢首屏，想深入的学生展开看。
 * 难度（容易/中等/提高）**总有一个值**（列 NOT NULL、默认中等），首屏直接显示标签。
 * 空字段不再渲染"标题 + 暂无内容"，避免一片空壳把关键信息埋掉。
 */
export default function ExperimentDetail() {
  const { projectId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ExperimentProject | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [resetting, setResetting] = useState(false);

  useAuxiliaryPanel(
    '实验须知',
    <div>
      <Paragraph type="secondary">
        领取后，模板与标准测试数据将下发到你的本地工作区；模型与推理档位由平台统一锁定，
        自测条件与复验条件一致。
      </Paragraph>
      <Paragraph type="secondary">提交内容：完整 Skill 目录包 + .dshc 证据包 + 审计事件。</Paragraph>
    </div>,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, assignments] = await Promise.all([
        getProject(projectId),
        listMyAssignments().catch(() => [] as Assignment[]),
      ]);
      setProject(p);
      setAssignment((assignments ?? []).find((a) => a.project.id === projectId) ?? null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleClaim = async () => {
    if (!assignment) return;
    setClaiming(true);
    try {
      await claimAssignment(assignment.id);
      message.success('领取成功，模板与测试数据已下发');
      await load();
    } finally {
      setClaiming(false);
    }
  };

  /**
   * 重新开始：把任务重置回「未领取」（历史提交保留，平台不动评分记录）。
   * 学生自助入口 —— 之前只能找老师或改库。
   */
  const handleReset = async () => {
    if (!assignment) return;
    setResetting(true);
    try {
      await resetAssignment(assignment.id);
      message.success('已重置为未领取，可重新领取（之前的提交仍保留）');
      await load();
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!project) {
    return <Empty description="实验项目不存在" />;
  }

  const unlocked = assignment?.unlocked ?? false;
  const claimed = !!assignment && assignment.status !== 'pending';
  const unlockHint = '请先完成本实验所属章节（看完后在章节页点「标记完成」）';
  const evalConfig = project.evalConfig;
  const hasEvalConfig =
    !!evalConfig &&
    (!!evalConfig.model ||
      !!evalConfig.reasoningEffort ||
      (evalConfig.tools ?? []).length > 0 ||
      evalConfig.timeoutSeconds != null);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {project.title}
          </Title>
          <DifficultyTag difficulty={project.difficulty} />
          {assignment && <StatusTag status={assignment.status} />}
        </Space>
        {claimed ? (
          <Space>
            {/* 顶部已有「已领取」状态标签，这里只留动作按钮，避免同一句话出现三遍 */}
            <Popconfirm
              title="重新开始这个实验？"
              description="会把你重置为「未领取」，重新领取会下发新模板；之前的提交记录仍保留。"
              okText="重新开始"
              cancelText="取消"
              onConfirm={() => void handleReset()}
            >
              <Button icon={<ReloadOutlined />} loading={resetting}>
                重新开始
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Tooltip title={!unlocked ? unlockHint : undefined}>
            <Button
              type="primary"
              icon={unlocked ? <RocketOutlined /> : <LockOutlined />}
              disabled={!unlocked || !assignment}
              loading={claiming}
              onClick={handleClaim}
            >
              {unlocked ? '领取实验' : '未解锁'}
            </Button>
          </Tooltip>
        )}
      </div>

      {!unlocked && !claimed && (
        <Alert type="info" showIcon message={unlockHint} style={{ marginBottom: 16 }} />
      )}

      {/* ---------- 首屏：实验本身（做什么） ---------- */}
      <Card title="实验内容">
        <Descriptions column={3} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="难度">
            <DifficultyTag difficulty={project.difficulty} />
          </Descriptions.Item>
          <Descriptions.Item label="所属章节">{assignment?.project.chapterTitle || '-'}</Descriptions.Item>
          <Descriptions.Item label="截止时间">
            {project.deadline ? dayjs(project.deadline).format('YYYY-MM-DD HH:mm') : '未设置'}
          </Descriptions.Item>
        </Descriptions>
        <MarkdownView
          content={project.content ?? undefined}
          emptyText="老师还没有填写实验内容（题面也在题目包 task.md 里，可下载查看）"
        />
        {(project.objectives ?? '').trim() && (
          <>
            <Title level={5} style={{ marginTop: 24 }}>
              实验目标
            </Title>
            <MarkdownView content={project.objectives ?? undefined} />
          </>
        )}
      </Card>

      {/* ---------- 领取后：材料下载（做实验就得先拿到，不进折叠） ---------- */}
      {claimed && (
        <Card title="实验材料" size="small" style={{ marginTop: 16 }}>
          <Space wrap>
            {project.skillTemplate ? (
              <Button icon={<DownloadOutlined />} onClick={() => void downloadStoredFile(project.skillTemplate!)}>
                Skill 模板：{project.skillTemplate.originalName}
              </Button>
            ) : (
              <Text type="secondary">模板未配置</Text>
            )}
            {project.problem ? (
              <Button icon={<DownloadOutlined />} onClick={() => void downloadStoredFile(project.problem!)}>
                题目包：{project.problem.originalName}
              </Button>
            ) : (
              <Text type="secondary">题目包未配置</Text>
            )}
          </Space>
          <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            完整流程（领取 → 开发 → 自测 → 提交）请在本地 DSH（nju-lab-student profile）中完成。
          </Paragraph>
        </Card>
      )}

      {/* ---------- 实验指导：怎么做（背景 · 口径 · 评分 · 环境） ---------- */}
      <Collapse
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'guide',
            label: '实验指导（背景知识 · 任务口径 · 评分要求 · 参考资料 · 常见问题 · 运行环境）',
            children: (
              <>
                {(project.background ?? '').trim() && (
                  <>
                    <Title level={5}>背景知识</Title>
                    <MarkdownView content={project.background ?? undefined} />
                  </>
                )}
                {(project.description ?? '').trim() && (
                  <>
                    <Title level={5} style={{ marginTop: 16 }}>
                      任务要求（口径）
                    </Title>
                    <MarkdownView content={project.description ?? undefined} />
                  </>
                )}
                <Title level={5} style={{ marginTop: 16 }}>
                  评分要求
                </Title>
                {(project.rubric ?? []).length === 0 ? (
                  <Text type="secondary">暂未公布评分维度</Text>
                ) : (
                  <Table<RubricItem>
                    size="small"
                    rowKey="name"
                    pagination={false}
                    dataSource={project.rubric}
                    columns={[
                      { title: '维度', dataIndex: 'name' },
                      { title: '权重（%）', dataIndex: 'weight', width: 120 },
                    ]}
                  />
                )}
                {(project.references ?? '').trim() && (
                  <>
                    <Title level={5} style={{ marginTop: 16 }}>
                      参考资料
                    </Title>
                    <MarkdownView content={project.references ?? undefined} />
                  </>
                )}
                {(project.faq ?? '').trim() && (
                  <>
                    <Title level={5} style={{ marginTop: 16 }}>
                      常见问题
                    </Title>
                    <MarkdownView content={project.faq ?? undefined} />
                  </>
                )}
                <Title level={5} style={{ marginTop: 16 }}>
                  运行环境与评估配置
                </Title>
                {hasEvalConfig ? (
                  <Descriptions column={2} size="small">
                    <Descriptions.Item label="评估模型">{project.evalConfig?.model || '-'}</Descriptions.Item>
                    <Descriptions.Item label="推理档位">
                      {project.evalConfig?.reasoningEffort || '平台默认'}
                    </Descriptions.Item>
                    <Descriptions.Item label="工具集白名单">
                      {(project.evalConfig?.tools ?? []).length > 0
                        ? project.evalConfig!.tools!.join(', ')
                        : '不限'}
                    </Descriptions.Item>
                    <Descriptions.Item label="超时（秒）">
                      {project.evalConfig?.timeoutSeconds ?? '-'}
                    </Descriptions.Item>
                  </Descriptions>
                ) : (
                  <Text type="secondary">由题目包与平台默认值决定（无需你配置）。</Text>
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
