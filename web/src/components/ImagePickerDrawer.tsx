import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Empty, message, Space, Spin, Upload } from 'antd';
import { CheckOutlined, UploadOutlined } from '@ant-design/icons';
import { listFiles, uploadFile } from '../api';
import client from '../api/client';
import type { StoredFileInfo } from '../types';

/** 幻灯片/章节插图允许的图片类型（SVG 经 <img> 加载不执行脚本，安全） */
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const PAGE_SIZE = 24;
/** 多图网格版式的上限（与 server deck.schema 一致） */
const MAX_GRID_IMAGES = 4;

// 缩略图 objectURL 的会话级缓存：图片库不大，避免每次打开 Drawer 都重新下载
const thumbCache = new Map<string, string>();
// 取失败的不再重试（文件已删等情况），防止死循环
const failedThumbs = new Set<string>();

async function loadThumb(fileId: string): Promise<void> {
  if (thumbCache.has(fileId) || failedThumbs.has(fileId)) return;
  try {
    const blob = await client.get<unknown, Blob>(`/files/${fileId}`, {
      responseType: 'blob',
    });
    thumbCache.set(fileId, URL.createObjectURL(blob));
  } catch {
    failedThumbs.add(fileId);
  }
}

interface Props {
  open: boolean;
  /** 多选模式（image-grid 插页用，上限 4 张，按点选顺序排） */
  multiple?: boolean;
  title?: string;
  onClose: () => void;
  onConfirm: (images: StoredFileInfo[]) => void;
}

/**
 * 教师个人图片库：上传新图 + 从已上传图片里选（缩略图网格）。
 * 缩略图与幻灯片同一条鉴权管线（axios 带 JWT 取 blob → objectURL）。
 */
export default function ImagePickerDrawer({
  open,
  multiple = false,
  title,
  onClose,
  onConfirm,
}: Props) {
  const [items, setItems] = useState<StoredFileInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // 缩略图异步填充完成后 bump 一下触发重渲染（缓存本体是模块级 Map）
  const [, setThumbTick] = useState(0);

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const res = await listFiles({ kind: 'image', limit: PAGE_SIZE, offset });
      setItems((prev) => (offset === 0 ? res.items : [...prev, ...res.items]));
      setTotal(res.total);
    } catch {
      message.error('图片库加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    void load(0);
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const missing = items.filter(
      (item) => !thumbCache.has(item.fileId) && !failedThumbs.has(item.fileId),
    );
    if (!missing.length) return;
    let cancelled = false;
    void Promise.all(missing.map((item) => loadThumb(item.fileId))).then(() => {
      if (!cancelled) setThumbTick((tick) => tick + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open, items]);

  const toggle = (fileId: string) => {
    setSelected((prev) => {
      if (prev.includes(fileId)) return prev.filter((id) => id !== fileId);
      if (!multiple) return [fileId];
      if (prev.length >= MAX_GRID_IMAGES) {
        message.info(`多图页最多 ${MAX_GRID_IMAGES} 张`);
        return prev;
      }
      return [...prev, fileId];
    });
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const info = await uploadFile(file);
      setItems((prev) => [info, ...prev]);
      setTotal((prev) => prev + 1);
      // 新上传的直接选中（单选替换、多选追加）
      setSelected((prev) =>
        multiple ? [...prev, info.fileId].slice(0, MAX_GRID_IMAGES) : [info.fileId],
      );
      message.success('图片已上传');
    } catch {
      message.error('图片上传失败，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = () => {
    const byId = new Map(items.map((item) => [item.fileId, item]));
    const images = selected
      .map((id) => byId.get(id))
      .filter((item): item is StoredFileInfo => !!item);
    if (!images.length) return;
    onConfirm(images);
  };

  return (
    <Drawer
      title={title ?? '图片库'}
      width={520}
      open={open}
      onClose={onClose}
      footer={
        <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={!selected.length} onClick={handleConfirm}>
            确定{selected.length ? `（已选 ${selected.length} 张）` : ''}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Upload
            accept={IMAGE_ACCEPT}
            showUploadList={false}
            customRequest={({ file }) => void handleUpload(file as File)}
            disabled={uploading}
          >
            <Button icon={<UploadOutlined />} loading={uploading}>
              上传图片
            </Button>
          </Upload>
          <span style={{ fontSize: 12, opacity: 0.65 }}>
            {multiple ? '多选，按点选顺序排列（2–4 张）' : '点选一张图片'}
          </span>
        </Space>

        {loading && !items.length ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin />
          </div>
        ) : !items.length ? (
          <Empty description="还没有上传过图片，点上方「上传图片」开始" />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
            }}
          >
            {items.map((item) => {
              const pickedAt = selected.indexOf(item.fileId);
              const thumb = thumbCache.get(item.fileId);
              return (
                <div
                  key={item.fileId}
                  onClick={() => toggle(item.fileId)}
                  style={{
                    position: 'relative',
                    cursor: 'pointer',
                    borderRadius: 8,
                    overflow: 'hidden',
                    border:
                      pickedAt >= 0
                        ? '2px solid #1677ff'
                        : '2px solid rgba(128,128,128,0.2)',
                  }}
                >
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={item.originalName}
                      style={{ width: '100%', height: 96, objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: 96,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        opacity: 0.5,
                      }}
                    >
                      {failedThumbs.has(item.fileId) ? '图片不可用' : '加载中…'}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={item.originalName}
                  >
                    {item.originalName}
                  </div>
                  {pickedAt >= 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: '#1677ff',
                        color: '#fff',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {multiple ? pickedAt + 1 : <CheckOutlined />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {items.length < total && (
          <Button block loading={loading} onClick={() => void load(items.length)}>
            加载更多（{items.length}/{total}）
          </Button>
        )}
      </Space>
    </Drawer>
  );
}
