import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const PRESET_COLORS = [
  { name: '南大紫', value: '#5c3c92' },
  { name: '经典蓝', value: '#1677ff' },
  { name: '祖母绿', value: '#0e8a6d' },
  { name: '落日橙', value: '#d9550d' },
  { name: '胭脂红', value: '#c3104e' },
  { name: '石墨青', value: '#0f5e68' },
];

interface ThemeState {
  dark: boolean;
  colorPrimary: string;
  setDark: (dark: boolean) => void;
  setColorPrimary: (color: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      dark: false,
      colorPrimary: PRESET_COLORS[0].value,
      setDark: (dark) => set({ dark }),
      setColorPrimary: (colorPrimary) => set({ colorPrimary }),
    }),
    { name: 'nju-lab-theme' },
  ),
);
