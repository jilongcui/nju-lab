import { Button, theme, Tooltip, Typography } from 'antd';
import { MenuFoldOutlined, MenuUnfoldOutlined, BulbOutlined } from '@ant-design/icons';
import { useAuxiliaryStore } from '../stores/auxiliary';

const { Text } = Typography;

export const AUX_WIDTH = 280;

/** 右侧辅助区：页面说明 / 待办 / 快捷操作，内容由各页面注入 */
export default function AuxiliaryPanel() {
  const { token } = theme.useToken();
  const { collapsed, title, content, toggleCollapsed } = useAuxiliaryStore();

  if (collapsed) {
    return (
      <div
        style={{
          width: 40,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          display: 'flex',
          justifyContent: 'center',
          paddingTop: 12,
          flexShrink: 0,
        }}
      >
        <Tooltip title="展开辅助面板" placement="left">
          <Button type="text" icon={<MenuUnfoldOutlined />} onClick={toggleCollapsed} />
        </Tooltip>
      </div>
    );
  }

  return (
    <aside
      style={{
        width: AUX_WIDTH,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text strong>{title}</Text>
        <Tooltip title="收起辅助面板" placement="left">
          <Button type="text" size="small" icon={<MenuFoldOutlined />} onClick={toggleCollapsed} />
        </Tooltip>
      </div>
      <div style={{ padding: 16, flex: 1 }}>
        {content ?? (
          <Text type="secondary">
            <BulbOutlined style={{ marginRight: 8 }} />
            这里会显示当前页面的说明、待办与快捷操作。
          </Text>
        )}
      </div>
    </aside>
  );
}
