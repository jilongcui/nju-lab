import type { ApplicationState } from './types';

/** 申请状态的展示文案与颜色（状态由后端算，前端只负责呈现）。
 * 文案保持短：卡片右上角要放得下，过长会把标题挤掉。 */
export const STATE_META: Record<
  ApplicationState,
  { text: string; color: string }
> = {
  open: { text: '可申请', color: 'green' },
  not_open_yet: { text: '待开放', color: 'blue' },
  full: { text: '名额已满', color: 'orange' },
  closed: { text: '未开放', color: 'default' },
  not_published: { text: '未公开', color: 'default' },
};

/** 卡片上的状态文案：把 closed 细分为「未开放」与「已截止」 */
export function courseStateLabel(c: {
  applicationState: ApplicationState;
  applicationCloseAt?: string | null;
}): string {
  if (
    c.applicationState === 'closed' &&
    c.applicationCloseAt &&
    new Date(c.applicationCloseAt) <= new Date()
  ) {
    return '已截止';
  }
  return STATE_META[c.applicationState].text;
}

export function formatDateTime(v?: string | null): string {
  if (!v) {
    return '';
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('zh-CN');
}

/** 开课信息里的名额描述 */
export function formatSeats(
  capacity: number | null,
  seatsLeft: number | null,
  approvedCount: number,
): string {
  if (capacity == null) {
    return `已加入 ${approvedCount} 人（不限名额）`;
  }
  return `剩余 ${seatsLeft ?? 0} / ${capacity} 个名额`;
}
