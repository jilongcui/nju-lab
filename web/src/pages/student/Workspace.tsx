import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  ExportOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiUrl } from '../../config';
import { getWorkspaceStatus, startWorkspace, stopWorkspace } from '../../api';
import type { WorkspaceInfo } from '../../types';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';

const { Title, Paragraph, Text } = Typography;

/** dsh web 首次启动约 20-30 秒（实测），轮询间隔取 2.5s */
const POLL_INTERVAL_MS = 2500;
/** 超过这个时长仍未就绪 → 补一句解释（不停止轮询） */
const SLOW_HINT_MS = 60_000;

const STATUS_TEXT: Record<WorkspaceInfo['status'], string> = {
  starting: '启动中',
  running: '已就绪',
  failed: '启动失败',
};

/**
 * 平台侧实验工作台入口页（浏览器兜底环境）。
 *
 * 设计见 `docs/DESIGN-2026-09-28-platform-workspace.md`：**本地 DSH 仍是主路径**，
 * 这里只服务「没有可用电脑 / 本地装不上 DSH」的学生——一人一容器，浏览器即用。
 *
 * 流程：`POST /api/workspace/start`（立即返回 starting）→ 轮询 `GET /api/workspace/status`
 * （后端惰性探测：读容器日志里的 launch token，约 20-30s 就绪）→ 就绪后导航到 `enterUrl`。
 */
export default function Workspace() {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useAuxiliaryPanel(
    '关于实验环境',
    <div>
      <Paragraph type="secondary">
        实验以 <Text strong>本地 DSH</Text> 为主路径；这一页是「没有可用电脑 / 本地装不上 DSH」
        时的浏览器兜底环境。
      </Paragraph>
      <Paragraph type="secondary">
        一人一容器，空闲 30 分钟自动回收。提交物走平台 API（不依赖容器内数据），
        所以容器回收不会丢已提交的成果。
      </Paragraph>
      <Paragraph type="secondary">
        ⚠️ 同一浏览器同时只能进入一个实验环境；地址请勿转发他人——它就是你的访问凭证。
      </Paragraph>
    </div>,
  );

  const refresh = useCallback(async () => {
    try {
      setInfo(await getWorkspaceStatus());
    } catch {
      // 请求错误已由 axios 拦截器统一提示
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 启动中 → 轮询推进（就绪判定在后端，前端只负责驱动）
  useEffect(() => {
    if (info?.status !== 'starting') return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [info?.status, refresh]);

  const handleStart = async () => {
    setBusy(true);
    try {
      setInfo(await startWorkspace());
    } catch {
      // 已提示
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopWorkspace();
      setInfo(null);
      message.success('已结束实验环境');
    } catch {
      // 已提示
    } finally {
      setBusy(false);
    }
  };

  const handleEnter = () => {
    if (!info?.enterUrl) return;
    // ⚠️ 必须走这个入口，不要直接打开容器地址：后端会先种下会话 cookie，
    // dsh 那些写死在根路径的请求（/api/**、/plugins/**…）才能被路由到你的容器
    window.location.assign(apiUrl(info.enterUrl));
  };

  const elapsedSec = info ? Math.round((Date.now() - info.startedAt) / 1000) : 0;
  const slow = info?.status === 'starting' && elapsedSec * 1000 > SLOW_HINT_MS;

  return (
    <div style={{ maxWidth: 760 }}>
      <Title level={4}>实验环境（浏览器兜底）</Title>

      {info?.status === 'failed' && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="实验环境启动失败"
          description={info.error || '请点「结束」后重试；若反复失败请联系教师。'}
        />
      )}

      <Card
        title={
          <Space>
            <CloudServerOutlined />
            <span>我的实验环境</span>
            {info ? (
              <Tag
                color={
                  info.status === 'running'
                    ? 'green'
                    : info.status === 'failed'
                      ? 'red'
                      : 'blue'
                }
              >
                {STATUS_TEXT[info.status]}
              </Tag>
            ) : (
              <Tag>未启动</Tag>
            )}
          </Space>
        }
        loading={loading}
      >
        <Paragraph type="secondary">
          无需安装任何软件：点「启动实验环境」后平台为你准备一台专属容器（首次约 20–30 秒），
          就绪后点「进入实验环境」即可在浏览器里做实验。
        </Paragraph>

        {info?.status === 'starting' && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={slow ? '仍在准备中（首次启动偶尔会更久）' : '正在准备实验环境…'}
            description={`已等待 ${elapsedSec} 秒`}
          />
        )}

        {info && (
          <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
            <Descriptions.Item label="会话标识">
              <Text code>{info.wsKey}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="启动时间">
              {dayjs(info.startedAt).format('YYYY-MM-DD HH:mm:ss')}
            </Descriptions.Item>
            <Descriptions.Item label="最近活跃">
              {dayjs(info.lastSeenAt).format('HH:mm:ss')}
            </Descriptions.Item>
          </Descriptions>
        )}

        <Space wrap>
          {!info && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={busy}
              onClick={handleStart}
            >
              启动实验环境
            </Button>
          )}
          {info?.status === 'running' && (
            <Button type="primary" icon={<ExportOutlined />} onClick={handleEnter}>
              进入实验环境
            </Button>
          )}
          {info?.status === 'failed' && (
            <Button icon={<ReloadOutlined />} loading={busy} onClick={handleStart}>
              重新启动
            </Button>
          )}
          {info && (
            <Button danger icon={<PoweroffOutlined />} loading={busy} onClick={handleStop}>
              结束实验环境
            </Button>
          )}
        </Space>
      </Card>

      <Card title="什么时候用它" style={{ marginTop: 16 }}>
        <Paragraph>
          正常情况请在<Text strong>自己电脑</Text>上安装 DSH 做实验（见「客户端下载」），
          那种方式有完整的文件上传与交付物面板。
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          只有这几种情况才用这里：身边没有可用电脑（如只在手机/平板上）、
          实验室机器装不上环境、或需要「确定一致的环境」做课堂演示。
          受虚拟机 CPU 限制，此环境暂不含 UI 文件上传与交付物面板，其余流程（领取 → 开发 → 自测 → 提交）一致。
        </Paragraph>
      </Card>
    </div>
  );
}
