import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Spin, theme } from 'antd';
import { CloseOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons';
import type { DeckSlide, SlideDeckConfig, SlideJson, SlideTemplateDesign } from '../types';
import type { Page } from './semantic/types';
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
  /** v2 语义页或 v1 旧版式页（服务端两种都可能返回；渲染器按结构自辨识） */
  slides: DeckSlide[];
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
  /**
   * 渲染器：`semantic`（新，默认）= 语义模型 + 固定 1920×1080 舞台；
   * `reveal` = 旧渲染器（保留回退能力；也可用 `VITE_SLIDES_RENDERER=reveal` 全局回退）。
   * 两者与父窗口的 postMessage 契约完全相同，因此这里的切换对页面无感。
   */
  renderer?: 'semantic' | 'reveal';
  /** 新渲染器的主题（内置模板 id + 课程自定义调参）；不传则用平台默认主题 */
  slideTheme?: { id?: string; design?: SlideTemplateDesign };
  /** 页脚上下文（课程/章节名） */
  meta?: { course?: string; chapter?: string };
  /** 文档构建完成（导出 PDF 用；回调不入依赖数组，父组件传内联函数也不会重复构建） */
  onDocument?: (html: string) => void;
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
  renderer,
  slideTheme,
  meta,
  onDocument,
}: SlideStageProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /** 看门狗重载计数：改 key 强制 iframe 重挂载（srcdoc 不重载就不会回 ready 的那类浏览器竞态） */
  const [reloadKey, setReloadKey] = useState(0);
  /** 当前这份文档已自动重载的次数（封顶后转错误态，不再无限转圈） */
  const reloadAttemptsRef = useRef(0);
  /** 放映浮层透明度：hover 只挂在按钮容器上（父容器 pointer-events: none 不会触发 hover） */
  const [controlsOpacity, setControlsOpacity] = useState(0.35);
  const { token } = theme.useToken();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  /** 上一份构建产物：输入"等价但引用变了"（父组件行内对象）时不重建 —— 否则 Spin 会常驻
   * （iframe 的 srcdoc 相同就不会重载，ready 事件不会再发，loading 态永远消不掉，2026-09-29 实测） */
  const lastDocRef = useRef<string | null>(null);
  /** 构建序号：每份被采纳的文档拼上唯一 HTML 注释 —— 即使 React 复用了 iframe 元素，
   * srcdoc 字符串也必然变化 → 浏览器一定重载、ready 一定回传（"srcdoc 相同不重载"
   * 这一类竞态在源头消除；等价去重仍由 lastDocRef 在拼序号之前完成） */
  const buildSeqRef = useRef(0);
  /** 当前文档下发的时间戳（就绪耗时日志用） */
  const htmlSetAtRef = useRef(0);
  /** onDocument 走 ref：父组件传内联箭头函数不会导致 effect 重复构建 */
  const onDocumentRef = useRef(onDocument);
  onDocumentRef.current = onDocument;

  /** 生效的渲染器：显式 prop 优先，其次环境变量回退，最后默认新版 */
  const effectiveRenderer: 'semantic' | 'reveal' =
    renderer ?? (import.meta.env.VITE_SLIDES_RENDERER === 'reveal' ? 'reveal' : 'semantic');

  // 内容/模板/配置变化 → 重建文档（重建 iframe 的 srcdoc，状态最干净）
  useEffect(() => {
    let cancelled = false;
    // 两条渲染路径产出的是同一种"自包含文档"，对页面其余部分完全等价。
    // 新版渲染器（版式 + vendor 主题 CSS）走**动态 import** —— 只有真的要看幻灯片才加载，
    // 不拖累应用主包（与 reveal 资产按需加载的做法一致）。
    const docPromise =
      effectiveRenderer === 'reveal'
        ? buildDeckHtml({
            // 旧渲染器只吃 v1（回退路径）；v2 deck 走下面语义分支
            slides: slides as SlideJson[],
            template,
            config: config ?? {},
            footerText,
            logoDataUrl,
            imageDataUrls,
          })
        : (async () => {
            const [{ buildSemanticDeckHtml }, { designToTokenOverrides, legacyDeckToPages }, { isSemanticDeck }] =
              await Promise.all([
                import('./semantic/stage'),
                import('./semantic/legacy'),
                import('./semantic/detect'),
              ]);
            // v2 语义 deck 直接渲染；历史 deck（v1）先过适配器，教师无需重生成
            const pages = isSemanticDeck(slides) ? slides : legacyDeckToPages(slides as SlideJson[]);
            return buildSemanticDeckHtml({
              // 服务端返回的语义页与前端 Page 同构（服务端已按 semantic.schema.ts 校验过）
              pages: pages as Page[],
              meta: { course: meta?.course ?? '', chapter: meta?.chapter ?? '' },
              themeId: slideTheme?.id,
              themeOverrides: designToTokenOverrides(slideTheme?.design),
              slideNumber: config?.slideNumber !== false,
              progress: config?.progress !== false,
              footerText,
              logoDataUrl,
              resolveImage: (fileId) => imageDataUrls?.[`file:${fileId}`] ?? imageDataUrls?.[fileId],
            });
          })();
    docPromise
      .then((doc) => {
        if (cancelled || lastDocRef.current === doc) return;
        lastDocRef.current = doc;
        reloadAttemptsRef.current = 0;
        buildSeqRef.current += 1;
        setReady(false);
        setError(null);
        htmlSetAtRef.current = Date.now();
        onDocumentRef.current?.(doc);
        setHtml(`${doc}\n<!-- deck-build:${buildSeqRef.current} -->`);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [slides, template, config, footerText, logoDataUrl, imageDataUrls, effectiveRenderer, slideTheme, meta]);

  // 就绪看门狗：html 已下发但 iframe 迟迟不回 ready（个别环境下 srcdoc 不重载/脚本未跑的竞态，
  // 表现为"转圈永不停"）—— 超时自动重挂载 iframe（换 key），重试 2 次仍不行就给出明确错误。
  // srcdoc 全内联、加载是本地的，5s 足够宽裕；构建耗时发生在 html 下发之前，不在此计时内。
  useEffect(() => {
    if (!html || ready || error) return;
    const timer = setTimeout(() => {
      if (reloadAttemptsRef.current < 2) {
        reloadAttemptsRef.current += 1;
        console.warn(`[SlideStage] iframe 5s 未就绪，自动重载（第 ${reloadAttemptsRef.current} 次）`);
        setReloadKey((key) => key + 1);
      } else {
        setError('幻灯片加载超时（已自动重试）。请切换视图或刷新页面重试。');
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [html, ready, error, reloadKey]);

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
      if (data.type === 'deck-error') {
        // iframe 内脚本异常：仅记录（个别异常不致命，失败判定交给就绪看门狗）
        console.warn('[SlideStage] iframe 内脚本异常：', (data as { message?: string }).message);
        return;
      }
      if (data.type === 'ready') {
        console.info(`[SlideStage] 已就绪（${Date.now() - htmlSetAtRef.current}ms）`);
        setReady(true);
      }
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
        // 只有放映模式才用黑底（全屏黑边）；内嵌模式加载瞬间露出容器底色，
        // 用跟随主题的浅色，避免「显示前短暂黑屏」（2026-09-30 教师反馈）
        background: presenting ? '#000' : token.colorBgLayout,
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
          {/*
           * ⚠️ iframe 必须等 html 就绪再挂载（出生即带完整 srcdoc）：
           * 若先挂空 srcdoc 再在毫秒级后更新（缓存命中时构建只需 ~1ms），
           * 「初始空文档尚未就位」的 iframe 会把这次 srcdoc 更新吞掉 ——
           * 永远停在空文档、ready 永远不来（2026-09-30 教师 Chrome 实测：
           * 首次构建慢（要拉 chunk ~100ms）不踩、二次进入必踩，看门狗重挂载自愈）。
           */}
          {html ? (
            <iframe
              key={reloadKey}
              ref={iframeRef}
              title="幻灯片"
              // ⚠️ 关键：只给 allow-scripts，**不给 allow-same-origin** → opaque origin
              sandbox="allow-scripts"
              srcDoc={html}
              style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            />
          ) : null}
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
