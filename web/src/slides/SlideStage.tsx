import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin } from 'antd';
import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { SlideDeckConfig, SlideJson } from '../types';
import { buildDeckHtml } from './renderDeck';

/**
 * 幻灯片舞台：把 deck 渲染成**自包含文档**塞进 `<iframe srcdoc>`。
 *
 * 安全与隔离（设计文档 §4/§11）：
 *   · `sandbox="allow-scripts"` 且**不给 `allow-same-origin`** → iframe 处于 opaque origin，
 *     reveal 的 reset.css 不会污染 antd，且文档里任何脚本都读不到平台的 localStorage/cookie；
 *   · 父 ↔ 子只走 `postMessage`：父转发按键、子回传当前页；
 *   · 内容里的图片只允许平台文件（`file:<id>`），由页面层预取成 data URL 传入，文档内不发任何外部请求。
 */
export interface SlideStageProps {
  slides: SlideJson[];
  template: { baseTheme: string; css: string };
  config?: SlideDeckConfig;
  footerText?: string | null;
  logoDataUrl?: string | null;
  imageDataUrls?: Record<string, string>;
  onIndexChange?: (index: number) => void;
  /** 外部请求跳到某页（缩略图列表点击）；变化即生效 */
  gotoIndex?: number;
  /** 演示模式：铺满视口 + 父窗口接管键盘 */
  presenting?: boolean;
  onExitPresenting?: () => void;
  height?: number | string;
}

export default function SlideStage({
  slides,
  template,
  config,
  footerText,
  logoDataUrl,
  imageDataUrls,
  onIndexChange,
  gotoIndex,
  presenting = false,
  onExitPresenting,
  height = 520,
}: SlideStageProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** 放映浮层透明度：hover 只挂在按钮容器上（父容器 pointer-events: none 不会触发 hover） */
  const [controlsOpacity, setControlsOpacity] = useState(0.35);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** 上一份构建产物：输入"等价但引用变了"（父组件行内对象）时不重建 —— 否则 Spin 会常驻
   * （iframe 的 srcdoc 相同就不会重载，ready 事件不会再发，loading 态永远消不掉，2026-09-29 实测） */
  const lastDocRef = useRef<string | null>(null);

  // 内容/模板/配置变化 → 重建文档（重建 iframe 的 srcdoc，状态最干净）
  useEffect(() => {
    let cancelled = false;
    buildDeckHtml({
      slides,
      template,
      config: config ?? {},
      footerText,
      logoDataUrl,
      imageDataUrls,
    })
      .then((doc) => {
        if (cancelled || lastDocRef.current === doc) return;
        lastDocRef.current = doc;
        setReady(false);
        setError(null);
        setHtml(doc);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slides, template, config, footerText, logoDataUrl, imageDataUrls]);

  // 接收 iframe 回传（就绪 / 翻页）
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = (event.data ?? {}) as {
        __deck?: boolean;
        type?: string;
        index?: number;
      };
      if (data.__deck !== true) return;
      if (data.type === 'exit-present') {
        // iframe 内按 Esc：由父窗口决定是否退出放映（非放映态则无事发生）
        onExitPresenting?.();
        return;
      }
      if (data.type === 'ready') setReady(true);
      if (typeof data.index === 'number') onIndexChange?.(data.index);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onIndexChange, onExitPresenting]);

  const post = useCallback((action: string, extra?: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(
      { __deckAction: true, action, ...extra },
      '*',
    );
  }, []);

  // 外部跳页（左侧缩略列表点击）：等 iframe 就绪后再发，避免文档尚未初始化
  useEffect(() => {
    if (gotoIndex === undefined || !ready) return;
    post('goto', { index: gotoIndex });
  }, [gotoIndex, ready, post]);

  // 演示模式下父窗口接管键盘（iframe 内不再依赖 Fullscreen API，opaque origin 下不保险）
  useEffect(() => {
    if (!presenting) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
        post('next');
        event.preventDefault();
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        post('prev');
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'o') {
        post('overview');
      } else if (event.key === 'Escape') {
        onExitPresenting?.();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presenting, post, onExitPresenting]);

  const frame = (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: presenting ? '100%' : height,
        background: '#000',
        borderRadius: presenting ? 0 : 8,
        overflow: 'hidden',
      }}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          message="幻灯片渲染失败"
          description={error}
          style={{ margin: 16 }}
        />
      ) : (
        <>
          {!ready && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2,
                // 只是加载指示，绝不能拦鼠标
                pointerEvents: 'none',
              }}
            >
              <Spin tip="正在加载幻灯片…" />
            </div>
          )}
          <iframe
            ref={iframeRef}
            title="幻灯片"
            // ⚠️ 关键：只给 allow-scripts，**不给 allow-same-origin** → opaque origin
            sandbox="allow-scripts"
            srcDoc={html ?? ''}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          />
        </>
      )}
    </div>
  );

  if (!presenting) return frame;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>{frame}</div>
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          display: 'flex',
          gap: 8,
          opacity: controlsOpacity,
          transition: 'opacity 0.2s',
          // ⚠️ 容器绝不拦鼠标：iframe 内 reveal 自己的翻页控件就在右下角，
          // 浮层盖上去会表现为「键盘能翻页、点左右箭头没反应」（教师端反馈过）。
          pointerEvents: 'none',
        }}
      >
        <Space
          size={4}
          style={{ pointerEvents: 'auto' }}
          onMouseEnter={() => setControlsOpacity(1)}
          onMouseLeave={() => setControlsOpacity(0.35)}
        >
          <Button size="small" icon={<LeftOutlined />} onClick={() => post('prev')} />
          <Button size="small" icon={<RightOutlined />} onClick={() => post('next')} />
          <Button size="small" icon={<CloseOutlined />} onClick={onExitPresenting}>
            退出（Esc）
          </Button>
        </Space>
      </div>
    </div>
  );
}
