import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { useThemeStore } from './stores/theme';
import { APP_NAME } from './config';

dayjs.locale('zh-cn');

// 浏览器标签标题：以 APP_NAME 为唯一来源（index.html 里的标题只是无 JS 时的兜底）
document.title = `${APP_NAME} · 课程实验一体化平台`;

function Root() {
  const { dark, colorPrimary } = useThemeStore();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        cssVar: true,
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary,
          borderRadius: 8,
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
