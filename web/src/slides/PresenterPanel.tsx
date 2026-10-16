/**
 * 讲者视图的右侧面板：备注（大字）+ 本页/下一页 + 计时 + 翻页。
 *
 * 设计取舍：**不渲染第二份幻灯片预览**。预览等于再建一个完整 deck 文档（构建耗时 + 内存翻倍），
 * 而讲者真正需要的是"下一页讲什么"—— 用页码 + 标题就够，正文留给备注。
 */
import { Button, Space, Tooltip, Typography, theme } from 'antd';
import { LeftOutlined, RightOutlined, StopOutlined } from '@ant-design/icons';

const { Text, Paragraph, Title } = Typography;

export interface PresenterPanelProps {
  /** 当前页（0 基） */
  index: number;
  total: number;
  /** 当前页标题 */
  pageTitle?: string;
  /** 当前页讲稿（可照读） */
  notes: string;
  /** 下一页标题（提示下一张讲什么） */
  nextTitle?: string;
  /** 已用时（毫秒） */
  elapsedMs: number;
  onPrev: () => void;
  onNext: () => void;
  onResetTimer: () => void;
  onExit: () => void;
  /** 观众窗口是否已打开（没打开时给一个"重新打开"的入口） */
  audienceOpened: boolean;
  onOpenAudience: () => void;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function PresenterPanel({
  index,
  total,
  pageTitle,
  notes,
  nextTitle,
  elapsedMs,
  onPrev,
  onNext,
  onResetTimer,
  onExit,
  audienceOpened,
  onOpenAudience,
}: PresenterPanelProps) {
  const { token } = theme.useToken();

  return (
    <aside
      style={{
        width: 420,
        flex: 'none',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        padding: '14px 16px',
        gap: 12,
        overflow: 'hidden',
      }}
    >
      {/* 顶栏：页码 / 计时 / 观众窗口状态 */}
      <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center">
        <Space size={10} align="center">
          <Text strong style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>
            {index + 1}
            <Text type="secondary" style={{ fontSize: 14 }}>
              {' '}
              / {total}
            </Text>
          </Text>
          <Tooltip title="点击重置计时">
            <Button size="small" onClick={onResetTimer} style={{ fontVariantNumeric: 'tabular-nums' }}>
              ⏱ {formatElapsed(elapsedMs)}
            </Button>
          </Tooltip>
        </Space>
        <Space size={6}>
          <Tooltip title={audienceOpened ? '观众窗口已打开（拖到投影屏后按 F11）' : '重新打开观众窗口'}>
            <Button size="small" onClick={onOpenAudience} danger={!audienceOpened}>
              {audienceOpened ? '观众窗口 ✓' : '打开观众窗口'}
            </Button>
          </Tooltip>
          <Tooltip title="退出讲者视图（Esc）">
            <Button size="small" icon={<StopOutlined />} onClick={onExit} />
          </Tooltip>
        </Space>
      </Space>

      {/* 本页标题 */}
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          本页
        </Text>
        <Title level={5} style={{ margin: '2px 0 0' }}>
          {pageTitle || '（无标题）'}
        </Title>
      </div>

      {/* 备注：讲者真正要念的东西，占满剩余高度 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          讲稿（只有这个窗口能看到）
        </Text>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            marginTop: 6,
            padding: '10px 12px',
            borderRadius: token.borderRadius,
            background: token.colorFillTertiary,
          }}
        >
          {notes.trim() ? (
            <Paragraph style={{ fontSize: 17, lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
              {notes}
            </Paragraph>
          ) : (
            <Text type="secondary">（本页没有讲稿）</Text>
          )}
        </div>
      </div>

      {/* 下一页提示 + 翻页 */}
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          下一页
        </Text>
        <div style={{ marginTop: 2, marginBottom: 8, minHeight: 22 }}>
          <Text ellipsis style={{ maxWidth: '100%' }}>
            {index + 1 < total ? nextTitle || '（无标题）' : '— 已是最后一页 —'}
          </Text>
        </div>
        <Space style={{ width: '100%', justifyContent: 'center' }}>
          <Button icon={<LeftOutlined />} onClick={onPrev} disabled={index === 0}>
            上一页
          </Button>
          <Button
            type="primary"
            icon={<RightOutlined />}
            onClick={onNext}
            disabled={index + 1 >= total}
          >
            下一页
          </Button>
        </Space>
      </div>
    </aside>
  );
}
