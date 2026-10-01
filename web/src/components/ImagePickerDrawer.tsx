import { Drawer } from 'antd';
import type { StoredFileInfo } from '../types';
import ImageLibraryPanel from './ImageLibraryPanel';

interface Props {
  open: boolean;
  /** 多选模式（image-grid 插页用，上限 4 张，按点选顺序排） */
  multiple?: boolean;
  title?: string;
  onClose: () => void;
  onConfirm: (images: StoredFileInfo[]) => void;
}

/**
 * 教师个人图片库的 Drawer 壳（幻灯片页用）。
 * 面板本体是 ImageLibraryPanel——章节编辑页把它直接挂在右侧辅助栏的「图片」tab 里。
 */
export default function ImagePickerDrawer({
  open,
  multiple = false,
  title,
  onClose,
  onConfirm,
}: Props) {
  return (
    <Drawer title={title ?? '图片库'} width={520} open={open} onClose={onClose} footer={null}>
      <ImageLibraryPanel
        active={open}
        multiple={multiple}
        onConfirm={onConfirm}
        onCancel={onClose}
      />
    </Drawer>
  );
}
