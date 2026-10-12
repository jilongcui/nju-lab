import { ConflictException } from '@nestjs/common';

/**
 * 编辑冲突（乐观锁）的统一错误体 —— 见 docs/DESIGN-2026-10-11-course-co-teachers.md §5。
 *
 * 多教师协作下，两位老师同时编辑同一份内容时，后保存者若带着**过期版本**，
 * 不能再静默覆盖：返回 409 + 当前版本 + 最后修改者，前端据此提示
 * 「已被 X 修改，你的修改未保存，刷新后请重新合并」。
 *
 * 章节保存与幻灯片保存共用这一个实现，避免两边错误结构漂移。
 */
export interface ConflictEditor {
  id: string;
  nickname?: string | null;
  username?: string | null;
}

export function buildConflictError(
  currentVersion: number,
  editor: ConflictEditor | null,
): ConflictException {
  return new ConflictException({
    message: '内容已被他人修改',
    currentVersion,
    updatedBy: editor
      ? { id: editor.id, nickname: editor.nickname || editor.username || '' }
      : null,
  });
}
