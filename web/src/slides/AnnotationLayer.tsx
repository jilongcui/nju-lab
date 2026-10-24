/**
 * 讲者视图的「白板」层：盖在幻灯片之上，**接管鼠标**用来指点和画线。
 *
 * 三件事：
 *   1. 把鼠标位置换算成 **deck 画布坐标**（1920×1080）后回调出去 —— 讲者窗口广播、观众窗口画光点；
 *   2. 按住拖动画线（一条线 = 按下→拖动→松开），逐条回调；
 *   3. 渲染指针光点与已画的线。
 *
 * 为什么覆盖层用 `viewBox="0 0 1920 1080"` + `preserveAspectRatio="xMidYMid meet"`：
 * deck 画布本身就是按 `min(vw/1920, vh/1080)` 居中缩放的（letterbox），这一套 SVG 规则与它**完全一致**
 * —— 于是"画布坐标"既是广播用的坐标系，也是 SVG 里直接可用的坐标系，不需要在两端各写一遍缩放。
 *
 * ⚠️ 覆盖层会挡住 iframe 里的鼠标交互（点两侧翻页 / 双击编辑等）——这是刻意的：
 * 讲者视图里翻页靠键盘与顶栏按钮，鼠标专门用来讲解（2026-10-17 用户确认「默认接管」）。
 * `readOnly`（观众窗口）时不接管鼠标，只渲染收到的东西。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnnotationStroke } from './presentChannel';

/** deck 画布尺寸（与 semantic/stage.ts 的 CANVAS 一致） */
const CANVAS = { width: 1920, height: 1080 };

/** 画笔颜色（投影上对比度优先，暖色打头） */
export const PEN_COLORS = [
  { name: '红', value: '#ff3b30' },
  { name: '黄', value: '#ffcc00' },
  { name: '蓝', value: '#0a84ff' },
  { name: '绿', value: '#34c759' },
] as const;

/** 画笔粗细（单位是 deck 画布像素，投影到任何尺寸都等比） */
export const PEN_WIDTHS = [
  { name: '细', value: 3 },
  { name: '中', value: 6 },
  { name: '粗', value: 12 },
] as const;

export type AnnotationTool = 'pointer' | 'pen';

export interface AnnotationLayerProps {
  /** 已画的线（讲者窗口是本地状态，观众窗口来自广播） */
  strokes: AnnotationStroke[];
  /** 当前指针位置（画布坐标）；null = 不在幻灯片上 */
  pointer: { x: number; y: number } | null;
  /** 观众窗口：只渲染，不接管鼠标 */
  readOnly?: boolean;
  /**
   * 层级。默认 3（讲者窗口：幻灯片是普通内嵌渲染，压住它即可）。
   * **观众窗口必须传更高的值**：那里的 `SlideStage` 是放映态（`position: fixed; z-index: 1200`），
   * 用默认值会被它整个盖住 —— 表现是"线画了、数据也到了，投影上就是看不见"（实测踩到）。
   */
  zIndex?: number;
  tool?: AnnotationTool;
  color?: string;
  width?: number;
  /** 指针移动（每帧最多一次，见 `handleMove`）；`null` = 离开了幻灯片 */
  onPointer?: (point: { x: number; y: number } | null) => void;
  /**
   * 外部给的"清屏信号"（讲者窗口传一个递增计数，翻页/手动清除时 +1）。值一变就收起本地光点 ——
   * 翻页后鼠标没动，光点也不该停在新页的旧位置上。
   */
  resetSignal?: unknown;
  /**
   * 正在画的线：**只带新增的点**（每帧最多一次）。讲者窗口用它把草稿实时同步到投影 ——
   * 否则投影要等到松手才看得见线（2026-10-24 用户反馈）。
   */
  onDraft?: (payload: { points: { x: number; y: number }[]; color: string; width: number }) => void;
  /** 这趟拖动结束（松手，或点数太少没成为一条线）→ 投影收起草稿 */
  onDraftEnd?: () => void;
  /** 观众窗口：讲者那边正在画、还没结束的那条线（只读渲染） */
  draftStroke?: AnnotationStroke | null;
  /** 画完一条线 */
  onStroke?: (stroke: AnnotationStroke) => void;
}

export default function AnnotationLayer({
  strokes,
  pointer,
  readOnly = false,
  zIndex = 3,
  tool = 'pen',
  color = '#ff3b30',
  width = 5,
  onPointer,
  onStroke,
  onDraft,
  onDraftEnd,
  draftStroke = null,
  resetSignal,
}: AnnotationLayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x: number; y: number }[] | null>(null);
  /**
   * 草稿同时存一份在 ref 里。
   * ⚠️ 不能在 `setDraft` 的 updater 里回调 `onStroke` —— React StrictMode 会双调用 updater
   * 来探测副作用，结果是**画一条线出两条**（2026-10-17 被 verify-presenter 抓到的）。
   */
  const draftRef = useRef<{ x: number; y: number }[] | null>(null);
  const drawingRef = useRef(false);
  /**
   * 讲者窗口的光点位置**留在本组件内部**，不走父组件 state。
   *
   * 走父 state 的代价：一次鼠标移动 = 父组件（整页）重渲染，而父组件里挂着 `SlideStage` ——
   * 只要它的构建输入引用变了就会重拼整份 deck 文档（2026-10-24 现场实测：移动鼠标 1 秒触发
   * 22 次重建、~400ms 主线程，投影光标严重滞后）。光点只是本层的一个圆点，没必要惊动整页。
   */
  const [ownPointer, setOwnPointer] = useState<{ x: number; y: number } | null>(null);
  /** 待发送的指针位置 + 已排的帧（同一帧内多次移动只广播最后一次） */
  const pendingPointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerRafRef = useRef(0);
  /** 回调走 ref：父组件传内联箭头函数不会让 handleMove 每次重建 */
  const onPointerRef = useRef(onPointer);
  onPointerRef.current = onPointer;

  const cancelPointerFrame = useCallback(() => {
    if (pointerRafRef.current) {
      cancelAnimationFrame(pointerRafRef.current);
      pointerRafRef.current = 0;
    }
    pendingPointerRef.current = null;
  }, []);

  /** 每帧最多广播一次（浏览器的 mousemove 频率跟着显示器走，MacBook 触控板可达 120Hz） */
  const broadcastPointer = useCallback(
    (point: { x: number; y: number }) => {
      pendingPointerRef.current = point;
      if (pointerRafRef.current) return;
      pointerRafRef.current = requestAnimationFrame(() => {
        pointerRafRef.current = 0;
        const latest = pendingPointerRef.current;
        pendingPointerRef.current = null;
        if (latest) onPointerRef.current?.(latest);
      });
    },
    [],
  );

  /** 已广播出去的点数（一趟拖动内只发增量，不重发整条线） */
  const sentDraftPointsRef = useRef(0);
  const draftRafRef = useRef(0);
  const pendingDraftRef = useRef<{
    points: { x: number; y: number }[];
    color: string;
    width: number;
  } | null>(null);
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const onDraftEndRef = useRef(onDraftEnd);
  onDraftEndRef.current = onDraftEnd;

  /** 把这一帧攒下的新点发出去（同一帧内多次移动合并成一条消息） */
  const broadcastDraft = useCallback(() => {
    const points = draftRef.current;
    if (!points) return;
    const fresh = points.slice(sentDraftPointsRef.current);
    if (!fresh.length) return;
    sentDraftPointsRef.current = points.length;
    const prev = pendingDraftRef.current;
    pendingDraftRef.current = {
      points: prev ? [...prev.points, ...fresh] : fresh,
      color,
      width,
    };
    if (draftRafRef.current) return;
    draftRafRef.current = requestAnimationFrame(() => {
      draftRafRef.current = 0;
      const payload = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (payload) onDraftRef.current?.(payload);
    });
  }, [color, width]);

  const cancelDraftFrame = useCallback(() => {
    if (draftRafRef.current) {
      cancelAnimationFrame(draftRafRef.current);
      draftRafRef.current = 0;
    }
    pendingDraftRef.current = null;
  }, []);

  // 卸载时别留着挂起的帧
  useEffect(
    () => () => {
      cancelPointerFrame();
      cancelDraftFrame();
    },
    [cancelPointerFrame, cancelDraftFrame],
  );

  // 清屏信号（讲者窗口传当前页）：翻页就收起本地光点
  useEffect(() => {
    if (readOnly) return;
    setOwnPointer(null);
    cancelPointerFrame();
  }, [resetSignal, readOnly, cancelPointerFrame]);

  /**
   * 屏幕坐标 → deck 画布坐标。与 deck 的缩放规则一致：
   * `scale = min(w/1920, h/1080)`，画布居中（多出来的部分是黑边）。
   * 落在黑边上的点会被夹到画布边缘（画到边上比"点不动"更好用）。
   */
  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const scale = Math.min(rect.width / CANVAS.width, rect.height / CANVAS.height);
    const offsetX = (rect.width - CANVAS.width * scale) / 2;
    const offsetY = (rect.height - CANVAS.height * scale) / 2;
    const x = (clientX - rect.left - offsetX) / scale;
    const y = (clientY - rect.top - offsetY) / scale;
    return {
      x: Math.max(0, Math.min(CANVAS.width, x)),
      y: Math.max(0, Math.min(CANVAS.height, y)),
    };
  }, []);

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      const point = toCanvas(event.clientX, event.clientY);
      if (!point) return;
      // 本地光点立即跟上（本项目自己的 state，代价只有一个 SVG 圆点）
      setOwnPointer(point);
      // 广播合并到下一帧：跨窗口消息不必逐像素发，也不能比屏幕刷新还密
      broadcastPointer(point);
      if (drawingRef.current && tool === 'pen') {
        const next = draftRef.current ? [...draftRef.current, point] : [point];
        draftRef.current = next;
        setDraft(next);
        // 投影边画边长：只发新增的点（每帧最多一条）
        broadcastDraft();
      }
    },
    [toCanvas, broadcastPointer, broadcastDraft, tool],
  );

  const handleDown = useCallback(
    (event: React.MouseEvent) => {
      const point = toCanvas(event.clientX, event.clientY);
      if (!point) return;
      if (tool !== 'pen') return;
      drawingRef.current = true;
      draftRef.current = [point];
      sentDraftPointsRef.current = 0;
      setDraft([point]);
      // 落笔点立刻过去：按下后不动，投影上也能看到落点
      broadcastDraft();
      event.preventDefault();
    },
    [toCanvas, broadcastDraft, tool],
  );

  const finishStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    // 还没发出去的增量直接丢掉：下面要么发整条线，要么这条线不成立
    cancelDraftFrame();
    sentDraftPointsRef.current = 0;
    // 点太少（单击）不当作一条线 —— 那只是想指一下
    if (points && points.length > 2) onStroke?.({ points, color, width });
    // 无论成不成线都告诉投影"草稿结束"，否则会残留半条（尤其单击那种情况）
    onDraftEndRef.current?.();
  }, [color, width, onStroke, cancelDraftFrame]);

  /** 要画出来的光点：讲者窗口用本地位置，观众窗口用广播来的位置 */
  const shownPointer = readOnly ? pointer : ownPointer ?? pointer;

  /** 要画出来的"正在画的线"：讲者窗口是本地草稿，观众窗口是讲者实时传来的草稿 */
  const shownDraft = readOnly
    ? draftStroke
    : draft
      ? { points: draft, color, width }
      : null;

  const toPath = (points: { x: number; y: number }[]) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  return (
    <div
      ref={rootRef}
      onMouseMove={readOnly ? undefined : handleMove}
      onMouseDown={readOnly ? undefined : handleDown}
      onMouseUp={readOnly ? undefined : finishStroke}
      onMouseLeave={() => {
        if (readOnly) return;
        finishStroke();
        setOwnPointer(null);
        cancelPointerFrame();
        onPointerRef.current?.(null);
      }}
      style={{
        position: 'absolute',
        inset: 0,
        // 讲者窗口必须接管鼠标（否则画不了）；观众窗口穿透，免得挡住自己（投影上也没人操作）
        pointerEvents: readOnly ? 'none' : 'auto',
        // 画笔模式下用十字光标（"正在画"的即时反馈）；仅指示时用默认箭头
        cursor: !readOnly && tool === 'pen' ? 'crosshair' : 'default',
        zIndex,
      }}
    >
      <svg
        viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        {strokes.map((stroke, i) => (
          <path
            key={i}
            data-annotation="stroke"
            d={toPath(stroke.points)}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {shownDraft && shownDraft.points.length > 1 ? (
          <path
            data-annotation="draft"
            d={toPath(shownDraft.points)}
            fill="none"
            stroke={shownDraft.color}
            strokeWidth={shownDraft.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
        {shownPointer ? (
          <g data-annotation="pointer">
            <circle cx={shownPointer.x} cy={shownPointer.y} r={26} fill="rgba(255,59,48,.22)" />
            <circle cx={shownPointer.x} cy={shownPointer.y} r={9} fill="#ff3b30" stroke="#fff" strokeWidth={3} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}
