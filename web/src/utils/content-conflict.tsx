import { Modal } from 'antd';
import type { AxiosError } from 'axios';

/**
 * 编辑冲突（乐观锁 409）的统一处理 —— 见 docs/DESIGN-2026-10-11-course-co-teachers.md §5。
 *
 * 多教师协作下，两位老师同时编辑同一章正文或同一份课件时，后保存者会拿到 409：
 * 这里负责把它变成一条**说清「被谁改了 + 我的改动没保存」**的提示，而不是让用户以为已保存。
 */

export interface ConflictPayload {
  currentVersion: number;
  updatedBy: { id: string; nickname: string } | null;
}

/** 平台错误响应体：{ code, data, message }（见 server 的 AllExceptionsFilter） */
interface ApiErrorBody {
  message?: string;
  data?: ConflictPayload | null;
}

/** 从错误里取并发冲突信息；不是 409 冲突则返回 null（其它错误由 axios 拦截器统一提示） */
export function conflictOf(error: unknown): ConflictPayload | null {
  const res = (error as AxiosError<ApiErrorBody>)?.response;
  if (res?.status !== 409) return null;
  const payload = res.data?.data;
  if (payload && typeof payload.currentVersion === 'number') return payload;
  return null;
}

/**
 * 弹出统一的冲突提示。`onReload` = 「刷新并加载最新内容」（通常是重新拉取本页数据）。
 * 不做静默合并：内容差异无法自动判定，交由老师决定。
 */
export function showConflictDialog(payload: ConflictPayload, onReload: () => void) {
  const who = payload.updatedBy?.nickname || '另一位老师';
  Modal.confirm({
    title: '内容已被他人修改',
    okText: '刷新并加载最新内容',
    cancelText: '留在此页（我先复制改动）',
    content: (
      <div>
        <p style={{ marginBottom: 8 }}>
          这份内容刚被 <b>{who}</b> 保存过，因此<b>你这一次的修改没有保存</b>。
        </p>
        <p style={{ margin: 0, color: '#8c8c8c' }}>
          点「刷新并加载最新内容」会丢弃你未保存的改动、载入对方的最新版本，请先把你需要的改动复制出去；
          若想自己手动合并，请留在此页。
        </p>
      </div>
    ),
    onOk: onReload,
  });
}
