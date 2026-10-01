import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, InputNumber, Modal, Segmented, Slider, Space, Switch, Typography, theme } from 'antd';
import { RotateLeftOutlined, RotateRightOutlined } from '@ant-design/icons';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';

const { Text } = Typography;

/** 输出尺寸上限：防止超大 canvas 把页面内存打爆 */
const MAX_OUT = 4096;

const ASPECT_OPTIONS = [
  { label: '原图', value: 'origin' },
  { label: '自由', value: 'free' },
  { label: '1:1', value: '1' },
  { label: '4:3', value: '1.3333' },
  { label: '3:4', value: '0.75' },
  { label: '16:9', value: '1.7778' },
];

/** 旋转后原图的轴对齐包围盒（react-easy-crop 官方裁切配方的第一步） */
function rotateSize(width: number, height: number, rotationDeg: number) {
  const rad = (rotationDeg * Math.PI) / 180;
  return {
    width: Math.abs(Math.cos(rad) * width) + Math.abs(Math.sin(rad) * height),
    height: Math.abs(Math.sin(rad) * width) + Math.abs(Math.cos(rad) * height),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败'));
    img.src = url;
  });
}

/** 把 裁剪框 + 旋转 + 输出尺寸 烘培成新文件（类型沿用原图，jpeg 白底防透明角变黑） */
async function renderEditedFile(
  file: File,
  url: string,
  cropPixels: Area,
  rotation: number,
  outW: number,
  outH: number,
): Promise<File> {
  const image = await loadImage(url);

  // 1) 整图按旋转角画进包围盒
  const bbox = rotateSize(image.naturalWidth, image.naturalHeight, rotation);
  const rotated = document.createElement('canvas');
  rotated.width = Math.round(bbox.width);
  rotated.height = Math.round(bbox.height);
  const rctx = rotated.getContext('2d')!;
  rctx.translate(rotated.width / 2, rotated.height / 2);
  rctx.rotate((rotation * Math.PI) / 180);
  rctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

  // 2) 裁出目标区域（cropPixels 就是包围盒坐标系里的像素框）
  const cropped = document.createElement('canvas');
  cropped.width = Math.max(1, Math.round(cropPixels.width));
  cropped.height = Math.max(1, Math.round(cropPixels.height));
  cropped
    .getContext('2d')!
    .drawImage(
      rotated,
      cropPixels.x,
      cropPixels.y,
      cropPixels.width,
      cropPixels.height,
      0,
      0,
      cropped.width,
      cropped.height,
    );

  // 3) 缩放到输出尺寸
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d')!;
  if (file.type === 'image/jpeg') {
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, outW, outH);
  }
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(cropped, 0, 0, outW, outH);

  const type = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, type, type === 'image/png' ? undefined : 0.92),
  );
  if (!blob) throw new Error('导出图片失败');
  return new File([blob], file.name, { type });
}

interface Props {
  /** 待编辑的原图文件；null = 关闭 */
  file: File | null;
  onCancel: () => void;
  onConfirm: (file: File) => void;
}

/** 上传前的图片编辑器：裁剪（自由/常用比例）+ 旋转（滑杆/±90°）+ 输出尺寸 */
export default function ImageEditModal({ file, onCancel, onConfirm }: Props) {
  const { token } = theme.useToken();
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspectKey, setAspectKey] = useState('origin');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [outW, setOutW] = useState(0);
  const [outH, setOutH] = useState(0);
  const [lockRatio, setLockRatio] = useState(true);
  // 用户手改过尺寸后不再跟随裁剪框自动同步（「重置」可恢复跟随）
  const [sizeTouched, setSizeTouched] = useState(false);
  const [exporting, setExporting] = useState(false);

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  // 每个新文件重置全部编辑状态
  useEffect(() => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setAspectKey('origin');
    setLockRatio(true);
    setSizeTouched(false);
    setCropPixels(null);
  }, [file]);

  // 「原图」比例在旋转 90°/270° 时随图翻转（2:1 转 90° 后应为 1:2），
  // 保证转完裁剪框仍覆盖整图，不会出现「只转不裁却丢了边缘」
  const quarterFlipped = Math.abs(rotation) % 180 === 90;
  const effectiveAspect =
    aspectKey === 'free'
      ? undefined
      : aspectKey === 'origin'
        ? natural
          ? quarterFlipped
            ? natural.h / natural.w
            : natural.w / natural.h
          : undefined
        : Number(aspectKey);

  // 尺寸未手改时，跟随裁剪框（旋转/缩放/换比例都会反映到输出尺寸上）
  useEffect(() => {
    if (sizeTouched || !cropPixels) return;
    setOutW(Math.min(MAX_OUT, Math.round(cropPixels.width)));
    setOutH(Math.min(MAX_OUT, Math.round(cropPixels.height)));
  }, [cropPixels, sizeTouched]);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCropPixels(pixels);
  }, []);

  const cropRatio = cropPixels && cropPixels.height > 0 ? cropPixels.width / cropPixels.height : 1;

  const changeOutW = (w: number | null) => {
    if (!w) return;
    setSizeTouched(true);
    setOutW(w);
    if (lockRatio) setOutH(Math.max(1, Math.round(w / cropRatio)));
  };
  const changeOutH = (h: number | null) => {
    if (!h) return;
    setSizeTouched(true);
    setOutH(h);
    if (lockRatio) setOutW(Math.max(1, Math.round(h * cropRatio)));
  };

  const rotateBy = (delta: number) => {
    // 归一到 (-180, 180]
    setRotation((r) => {
      let v = (r + delta) % 360;
      if (v > 180) v -= 360;
      if (v <= -180) v += 360;
      return v;
    });
  };

  const handleOk = async () => {
    if (!file || !url || !cropPixels) return;
    setExporting(true);
    try {
      const w = Math.min(MAX_OUT, Math.max(1, outW));
      const h = Math.min(MAX_OUT, Math.max(1, outH));
      const edited = await renderEditedFile(file, url, cropPixels, rotation, w, h);
      onConfirm(edited);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title="编辑图片"
      open={!!file}
      onCancel={onCancel}
      width={680}
      destroyOnClose
      okText="应用并上传"
      cancelText="取消"
      confirmLoading={exporting}
      onOk={handleOk}
    >
      {url && (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: 340,
              background: token.colorFillSecondary,
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={effectiveAspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
              onMediaLoaded={(ms) =>
                setNatural({ w: ms.naturalWidth, h: ms.naturalHeight })
              }
              cropShape="rect"
              showGrid
            />
          </div>

          <Space wrap size={16}>
            <span>
              <Text type="secondary" style={{ marginRight: 8 }}>比例</Text>
              <Segmented
                size="small"
                options={ASPECT_OPTIONS}
                value={aspectKey}
                onChange={(v) => setAspectKey(v as string)}
              />
            </span>
            <span>
              <Text type="secondary" style={{ marginRight: 4 }}>旋转</Text>
              <Button size="small" icon={<RotateLeftOutlined />} onClick={() => rotateBy(-90)} />
              <Slider
                style={{ width: 120, display: 'inline-block', verticalAlign: 'middle', margin: '0 8px' }}
                min={-180}
                max={180}
                value={rotation}
                onChange={setRotation}
              />
              <Button size="small" icon={<RotateRightOutlined />} onClick={() => rotateBy(90)} />
              <Text type="secondary" style={{ marginLeft: 8 }}>{rotation}°</Text>
            </span>
            <span>
              <Text type="secondary" style={{ marginRight: 4 }}>缩放</Text>
              <Slider
                style={{ width: 120, display: 'inline-block', verticalAlign: 'middle', margin: '0 8px' }}
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={setZoom}
              />
            </span>
          </Space>

          <Space wrap size={12} align="center">
            <Text type="secondary">输出尺寸</Text>
            <InputNumber
              size="small"
              min={1}
              max={MAX_OUT}
              value={outW}
              onChange={changeOutW}
              addonAfter="宽"
              style={{ width: 110 }}
            />
            <span>×</span>
            <InputNumber
              size="small"
              min={1}
              max={MAX_OUT}
              value={outH}
              onChange={changeOutH}
              addonAfter="高"
              style={{ width: 110 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              锁定比例 <Switch size="small" checked={lockRatio} onChange={setLockRatio} />
            </Text>
            <Button size="small" onClick={() => setSizeTouched(false)}>
              尺寸跟随裁剪框
            </Button>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {file?.name}（原图上传前生效）
            </Text>
          </Space>
        </Space>
      )}
    </Modal>
  );
}
