import type { ApplicationState } from './types';

/** 申请状态的展示文案与颜色（状态由后端算，前端只负责呈现） */
export const STATE_META: Record<
  ApplicationState,
  { text: string; color: string }
> = {
  open: { text: '申请开放中', color: 'green' },
  not_open_yet: { text: '待开放申请', color: 'blue' },
  full: { text: '名额已满', color: 'orange' },
  closed: { text: '申请未开放/已截止', color: 'default' },
  not_published: { text: '未公开', color: 'default' },
};

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
