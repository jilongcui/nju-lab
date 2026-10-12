import { useCallback, useEffect, useState } from 'react';
import { Empty, List, Skeleton, Tag, Typography } from 'antd';
import { listCourseAudits } from '../api';
import type { CourseAuditItem } from '../types';

const { Text } = Typography;

/**
 * 课程的操作记录（谁在什么时候改了什么）。
 *
 * 多教师协作的配套能力（见 docs/DESIGN-2026-10-11-course-co-teachers.md）：
 * 乐观锁只告诉「这份内容刚被别人改过」，这里回答「**这段时间里谁改了什么**」——
 * 两位老师共备一门课时，用来对齐「刚才那版是谁动的」。
 *
 * 只读展示服务端的写操作流水（章节保存/删除、幻灯片保存/生成、课程信息更新、
 * 转让、协作名单变更、删课），不记读操作。
 */
export default function CourseAuditList({ courseId }: { courseId: string }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<CourseAuditItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listCourseAudits(courseId, 30);
      setItems(res?.items ?? []);
    } catch {
      // 取不到不影响其它页签（权限/网络问题都走这里）
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (!items.length) {
    return <Empty description="还没有操作记录（章节、幻灯片、课程信息的改动都会记在这里）" />;
  }

  const actionLabel: Record<string, { text: string; color: string }> = {
    chapter_create: { text: '新建章节', color: 'green' },
    chapter_save: { text: '保存章节', color: 'blue' },
    chapter_delete: { text: '删除章节', color: 'red' },
    deck_save: { text: '保存幻灯片', color: 'blue' },
    deck_generate: { text: '生成幻灯片', color: 'purple' },
    course_update: { text: '更新课程', color: 'default' },
    course_create: { text: '创建课程', color: 'green' },
    course_transfer: { text: '转让课程', color: 'orange' },
    course_delete: { text: '删除课程', color: 'red' },
    teachers_update: { text: '协作名单', color: 'gold' },
  };

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(item) => {
        const label = actionLabel[item.action] ?? { text: item.action, color: 'default' };
        return (
          <List.Item>
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Tag color={label.color} style={{ marginInlineEnd: 0 }}>
                  {label.text}
                </Tag>
                <Text strong>{item.actor.nickname || '未知用户'}</Text>
                <Text>{item.summary}</Text>
                <Text type="secondary" style={{ marginLeft: 'auto', fontSize: 12 }}>
                  {new Date(item.createdAt).toLocaleString('zh-CN')}
                </Text>
              </div>
            </div>
          </List.Item>
        );
      }}
    />
  );
}
