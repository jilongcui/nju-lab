import { Course, CourseStatus } from './course.entity';

/**
 * 公开课程页展示的申请状态。
 *
 * 必须由后端算：它依赖「已批准人数」（count of enrollments），
 * 前端拿不到别人的入册数，无法自行判断。
 */
export type ApplicationState =
  | 'not_published'
  | 'not_open_yet'
  | 'open'
  | 'full'
  | 'closed';

type CourseStateFields = Pick<
  Course,
  'status' | 'applicationOpenAt' | 'applicationCloseAt' | 'capacity'
>;

/**
 * 申请入口状态。
 *
 * 核心语义：`status = published` 只表示「别人能看到」；
 * **能否申请由开放时间与名额独立决定**——这是"先展示、到点开放申请"的基础。
 */
export function resolveApplicationState(
  course: CourseStateFields,
  approvedCount: number,
  now: Date = new Date(),
): ApplicationState {
  if (course.status !== CourseStatus.PUBLISHED) {
    return 'not_published';
  }
  if (!course.applicationOpenAt) {
    return 'closed';
  }
  if (course.applicationOpenAt > now) {
    return 'not_open_yet';
  }
  if (course.applicationCloseAt && course.applicationCloseAt <= now) {
    return 'closed';
  }
  // 容量口径：已批准数
  if (course.capacity != null && approvedCount >= course.capacity) {
    return 'full';
  }
  return 'open';
}

/** 剩余名额；capacity 为空表示不限 */
export function seatsLeft(
  capacity: number | null,
  approvedCount: number,
): number | null {
  if (capacity == null) {
    return null;
  }
  return Math.max(0, capacity - approvedCount);
}
