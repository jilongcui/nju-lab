import { Tag } from 'antd';

const MAP: Record<string, { color: string; text: string }> = {
  draft: { color: 'default', text: '草稿' },
  published: { color: 'green', text: '已发布' },
  archived: { color: 'default', text: '已归档' },
  closed: { color: 'red', text: '已截止' },
  submitted: { color: 'blue', text: '已提交' },
  verifying: { color: 'processing', text: '复验中' },
  verified: { color: 'cyan', text: '已复验' },
  failed: { color: 'red', text: '复验失败' },
  graded: { color: 'green', text: '已评分' },
  pending: { color: 'default', text: '待领取' },
  claimed: { color: 'blue', text: '已领取' },
  not_started: { color: 'default', text: '未开始' },
  in_progress: { color: 'processing', text: '学习中' },
  completed: { color: 'green', text: '已完成' },
};

export default function StatusTag({ status }: { status?: string }) {
  const meta = (status && MAP[status]) || { color: 'default', text: status || '-' };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}
