import type { ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AuxiliaryState {
  collapsed: boolean;
  title: string;
  content: ReactNode;
  toggleCollapsed: () => void;
  setPanel: (title: string, content: ReactNode) => void;
}

export const useAuxiliaryStore = create<AuxiliaryState>()(
  persist(
    (set) => ({
      collapsed: false,
      title: '辅助面板',
      content: null,
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
      setPanel: (title, content) => set({ title, content }),
    }),
    {
      name: 'nju-lab-aux',
      // content 为 ReactNode 不可持久化，只记住收起状态
      partialize: (s) => ({ collapsed: s.collapsed }) as AuxiliaryState,
    },
  ),
);
