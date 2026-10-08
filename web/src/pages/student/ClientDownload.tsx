import { Button, Card, Steps, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { withBase } from '../../config';

const { Title, Paragraph, Text } = Typography;

export default function ClientDownload() {
  // 当前部署的平台 API 地址（根/子目录部署自适应）
  const serverUrl = `${window.location.origin}${withBase('api')}`;
  useAuxiliaryPanel(
    '关于学生端',
    <div>
      <Paragraph type="secondary">
        实验全程在你自己电脑的 DSH 中完成：领取任务、开发 Skill、自测、提交。平台网页用于看课程、看反馈与生成 token。
      </Paragraph>
      <Paragraph type="secondary">
        DSH 版本学期内锁定 0.2.0-rc.2，请勿升级；异常时装回本安装包即可。
      </Paragraph>
    </div>,
  );

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4}>客户端下载（学生端 DSH）</Title>

      <Card style={{ marginBottom: 16 }}>
        <Button
          type="primary"
          size="large"
          icon={<CloudDownloadOutlined />}
          href={withBase('kit/nju-lab-student-kit.zip')}
          download
        >
          下载 nju-lab-student-kit.zip
        </Button>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          包含：nju-lab-student profile、NJU-Lab 插件、一键安装脚本、使用手册（README.md）。
        </Paragraph>
      </Card>

      <Card title="安装与首次配置">
        <Steps
          direction="vertical"
          size="small"
          items={[
            {
              title: '安装 Node.js 22+',
              description: '从 nodejs.org 或学校镜像安装；已有可跳过。机房电脑已预装，直接从第 3 步开始。',
            },
            {
              title: '解压并运行一键安装脚本',
              description: (
                <Text code>{'unzip nju-lab-student-kit.zip && cd nju-lab-student-kit && ./install.sh'}</Text>
              ),
            },
            {
              title: '生成本人 token',
              description: '本页右上角头像菜单 →「API Token」→「生成 token」→ 复制（有效期 365 天，请保密）。',
            },
            {
              title: '启动并填写配置',
              description: `终端运行 dsh --profile nju-lab-student，浏览器打开后进入 设置 → nju-lab：serverUrl 填 ${serverUrl}，token 粘贴上一步的 token。`,
            },
          ]}
        />
      </Card>

      <Card title="做一次实验" style={{ marginTop: 16 }}>
        <Steps
          direction="vertical"
          size="small"
          items={[
            { title: '看任务', description: '对 AI 说「列出我的实验任务」' },
            { title: '领取', description: '「领取 <任务名>」——模板与测试数据自动下载解压，评估条件被平台钉死' },
            { title: '开发与自测', description: '在工作区 skill/ 目录完成 SKILL.md 与脚本，用题目包自测' },
            { title: '提交', description: '「提交我的实验」——自动打包、生成证据包并上传' },
            { title: '看反馈', description: '教师复验批改后，到「我的提交与反馈」查看分数与评语' },
          ]}
        />
      </Card>
    </div>
  );
}
