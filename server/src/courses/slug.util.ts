/**
 * 课程公开链接标识（slug）生成。
 *
 * 标题里的 ASCII 字母数字转成 kebab-case；纯中文标题转不出可用片段时，
 * 退回 id 前 8 位以保证可用性（同一课程 slug 发布后锁定，见 CoursesService.publishCourse）。
 */
export function buildSlugBase(title: string, idSeed: string): string {
  const ascii = (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (ascii) {
    return ascii;
  }
  return `course-${(idSeed || '').replace(/-/g, '').slice(0, 8)}`;
}
