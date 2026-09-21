import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Empty, message, Skeleton, Space, Table, Tooltip, Typography } from 'antd';
import { DownloadOutlined, LockOutlined, RocketOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { claimAssignment, downloadStoredFile, getProject, listMyAssignments } from '../../api';
import type { Assignment, ExperimentProject, RubricItem } from '../../types';
import StatusTag from '../../components/StatusTag';
import MarkdownView from '../../components/MarkdownView';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Text, Paragraph } = Typography;

export default function ExperimentDetail() {
  const { projectId = '' } = useParams();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ExperimentProject | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [claiming, setClaiming] = useState(false);

  useAuxiliaryPanel(
    '实验须知',
    <div>
      <Paragraph type="secondary">
        领取后，模板与标准测试数据将下发到你的本地工作区；模型与推理档位由平台统一锁定，自测条件与复验条件一致。
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

  if (loading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }
  if (!project) {
    return <Empty description="实验项目不存在" />;
  }

  const unlocked = assignment?.unlocked ?? false;
  const claimed = !!assignment && assignment.status !== 'pending';
  const unlockHint = '请先完成该实验所属章节之前的全部已发布章节';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>
            {project.title}
          </Title>
          <StatusTag status={project.status} />
          {assignment && <StatusTag status={assignment.status} />}
        </Space>
        {claimed ? (
          <Button icon={<RocketOutlined />} disabled>
            已领取
          </Button>
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

      <Card title="实验信息" style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="所属章节">{assignment?.project.chapterTitle || '-'}</Descriptions.Item>
          <Descriptions.Item label="截止时间">
            {project.deadline ? dayjs(project.deadline).format('YYYY-MM-DD HH:mm') : '未设置'}
          </Descriptions.Item>
          <Descriptions.Item label="评估模型">{project.evalConfig?.model || '-'}</Descriptions.Item>
          <Descriptions.Item label="推理档位">{project.evalConfig?.reasoningEffort || '-'}</Descriptions.Item>
          <Descriptions.Item label="工具集白名单">
            {(project.evalConfig?.tools ?? []).length > 0 ? project.evalConfig!.tools!.join(', ') : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="超时（秒）">{project.evalConfig?.timeoutSeconds ?? '-'}</Descriptions.Item>
        </Descriptions>
        {claimed && (
          <>
            <Title level={5}>实验材料</Title>
            <Space wrap style={{ marginBottom: 16 }}>
              {project.skillTemplate ? (
                <Button icon={<DownloadOutlined />} onClick={() => void downloadStoredFile(project.skillTemplate!)}>
                  Skill 模板：{project.skillTemplate.originalName}
                </Button>
              ) : (
                <Text type="secondary">模板未配置</Text>
              )}
              {project.testDataset ? (
                <Button icon={<DownloadOutlined />} onClick={() => void downloadStoredFile(project.testDataset!)}>
                  测试数据集：{project.testDataset.originalName}
                </Button>
              ) : (
                <Text type="secondary">数据集未配置</Text>
              )}
            </Space>
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              完整流程（领取 → 开发 → 自测 → 提交）请在本地 DSH（nju-lab-student profile）中完成。
            </Paragraph>
          </>
        )}
        <Title level={5}>实验目标</Title>
        <MarkdownView content={project.objectives ?? undefined} />
        <Title level={5}>背景知识</Title>
        <MarkdownView content={project.background ?? undefined} />
        <Title level={5}>任务要求</Title>
        <MarkdownView content={project.description ?? undefined} />
        <Title level={5}>评分要求</Title>
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
        <Title level={5}>参考资料</Title>
        <MarkdownView content={project.references ?? undefined} />
        <Title level={5}>常见问题</Title>
        <MarkdownView content={project.faq ?? undefined} />
      </Card>
    </div>
  );
}
