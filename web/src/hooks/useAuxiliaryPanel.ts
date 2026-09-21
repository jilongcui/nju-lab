import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useAuxiliaryStore } from '../stores/auxiliary';

/** 页面向右侧辅助面板注入内容；卸载时自动复位 */
export function useAuxiliaryPanel(title: string, content: ReactNode) {
  const setPanel = useAuxiliaryStore((s) => s.setPanel);
  useEffect(() => {
    setPanel(title, content);
    return () => setPanel('辅助面板', null);
  }, [setPanel, title, content]);
}
