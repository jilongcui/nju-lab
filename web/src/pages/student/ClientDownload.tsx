import { Alert, Button, Card, Collapse, Steps, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { withBase } from '../../config';

const { Title, Paragraph, Text } = Typography;

/**
 * 是否 Windows：只影响**展示哪套安装步骤**（Windows 走 WSL2 引导脚本）。
 * 不是能力判断 —— 平台侧「实验环境」对任何系统都一样可用。
 */
const IS_WINDOWS = /Windows/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
);

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
      <Paragraph type="secondary">
        Windows 有两条路：① 免安装，直接用「实验环境」（浏览器里的完整 DSH）；② 用安装包里的
        <Text code>install.ps1</Text>把环境装进 WSL2，步骤与 macOS / Linux 完全一致。
      </Paragraph>
      <Paragraph type="secondary">
        注意：<Text strong>官方「DSH 桌面版」（Electron 应用）不支持</Text> —— 它跑自己的运行时与
        <Text code>desktop</Text> profile，本平台插件不会被加载，领取/提交入口不会出现。
      </Paragraph>
    </div>,
  );

  return (
    <div style={{ maxWidth: 720 }}>
      <Title level={4}>客户端下载（学生端 DSH）</Title>

      {IS_WINDOWS && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="不要用「DSH 桌面版」做实验"
          description={
            <>
              DeepSeek Harness 的<Text strong>桌面版</Text>（那个 Electron 应用）跑的是它自己的运行时与
              <Text code>desktop</Text> profile，本平台插件不会被加载 —— 你会找不到「领取 / 提交」，
              也就无法上传实验。请用下面的 WSL2 步骤装本地 DSH，或直接用
              <Link to="/student/workspace">「实验环境」</Link>。
            </>
          }
        />
      )}

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
          包含：nju-lab-student profile、NJU-Lab 插件、一键安装脚本（macOS / Linux 用
          <Text code>install.sh</Text>，Windows 用 <Text code>install.ps1</Text>）、使用手册（README.md）。
        </Paragraph>
      </Card>

      <Alert
        type={IS_WINDOWS ? 'info' : 'success'}
        showIcon
        style={{ marginBottom: 16 }}
        message={IS_WINDOWS ? 'Windows 学生：有更省事的一条路' : '不想在本地装环境？'}
        description={
          <>
            平台左侧菜单的 <Link to="/student/workspace">「实验环境」</Link>
            就在浏览器里给你一个完整的 DSH（python / pandas / torch 等依赖齐全），
            免安装、换电脑也能用；文件放 <Text code>/workspace</Text> 会保留。
            本地 DSH 仍然是主路径（能用自己的 GPU、装任意依赖），两者提交到同一个平台账号。
          </>
        }
      />

      <Card title="安装与首次配置（本地 DSH）">
        <Steps
          direction="vertical"
          size="small"
          items={[
            {
              title: IS_WINDOWS ? '准备 WSL2 与 Node.js 22+（脚本会引导）' : '安装 Node.js 22+',
              description: IS_WINDOWS ? (
                <>
                  Windows 上的本地 DSH 跑在 WSL2 里（实验脚本与平台复验同一条 Linux 口径）。
                  缺 WSL 时脚本会打印 <Text code>wsl --install</Text> 的步骤（需管理员权限 + 重启一次）；
                  <Text strong>WSL 里的 Node.js 要自己装</Text>（脚本只检查、不代装），在 Ubuntu 终端里执行：
                  <pre style={{ margin: '8px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v    # 需要 v22 或更高`}
                  </pre>
                </>
              ) : (
                '从 nodejs.org 或学校镜像安装；已有可跳过。机房电脑已预装，直接从第 3 步开始。'
              ),
            },
            {
              title: IS_WINDOWS ? '解压并在 PowerShell 里运行引导脚本' : '解压并运行一键安装脚本',
              description: IS_WINDOWS ? (
                <>
                  <Text code>{'powershell -ExecutionPolicy Bypass -File .\\install.ps1'}</Text>
                  <br />
                  脚本装完会自动跑一次自检，把「装没装好」当场告诉你。
                </>
              ) : (
                <Text code>{'unzip nju-lab-student-kit.zip && cd nju-lab-student-kit && ./install.sh'}</Text>
              ),
            },
            {
              title: '生成本人 token',
              description: '本页右上角头像菜单 →「API Token」→「生成 token」→ 复制（有效期 365 天，请保密）。',
            },
            {
              title: '启动并填写配置',
              description: IS_WINDOWS
                ? `先打开 WSL 终端（wsl -d Ubuntu），再运行 dsh --profile nju-lab-student；浏览器没自动打开时，把终端打印的 http://127.0.0.1:<端口>/?token=... 复制到浏览器（WSL2 与 Windows 共用 127.0.0.1）。然后进入 设置 → nju-lab：serverUrl 填 ${serverUrl}，token 粘贴上一步的 token。实验文件放 WSL 家目录（如 ~/lab），不要放 /mnt/c。`
                : `终端运行 dsh --profile nju-lab-student，浏览器打开后进入 设置 → nju-lab：serverUrl 填 ${serverUrl}，token 粘贴上一步的 token。`,
            },
          ]}
        />
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12 }}
          message="全程要在校园网或校内 VPN 下"
          description="平台在校外会被校园网关拦去统一认证页，表现就是「提交失败 / 401 / 302」，和系统无关。"
        />
      </Card>

      <Card title="出问题先跑自检（把输出贴给老师）" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          安装包里带 <Text code>check.sh</Text>。它一次就能分清是插件没装上、token 失效、
          不在校园网，还是被 WAF 拦了 —— 比来回描述现象快得多。
        </Paragraph>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{IS_WINDOWS
  ? `wsl -d Ubuntu -- bash -lc 'cd ~/nju-lab-student-kit && bash check.sh'`
  : `bash ~/nju-lab-student-kit/check.sh`}
        </pre>
      </Card>

      <Card title="装不上？两条备选路径" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          引导脚本只是个「摆渡脚本」，真正装东西的永远是 <Text code>install.sh</Text> ——
          所以下面两条路和它完全等价，可以任选。
        </Paragraph>
        <Collapse
          ghost
          items={[
            {
              key: 'manual',
              label: '① 在 WSL 里手敲（引导脚本出问题时的退路）',
              children: (
                <>
                  <Paragraph style={{ marginBottom: 8 }}>
                    先把安装包复制到 WSL 家目录再装（不要直接在 <Text code>/mnt/c</Text> 上装）：
                  </Paragraph>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{IS_WINDOWS
  ? `rm -rf ~/nju-lab-student-kit
cp -a "/mnt/c/Users/你/Downloads/nju-lab-student-kit" ~/
cd ~/nju-lab-student-kit && bash install.sh`
  : `cd nju-lab-student-kit && ./install.sh`}
                  </pre>
                  <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    路径里的「你」换成你的 Windows 用户名；装完同样会跑一次自检。
                  </Paragraph>
                </>
              ),
            },
            {
              key: 'ai',
              label: '② 交给 DSH 里的 AI 装（不想碰命令）',
              children: (
                <>
                  <Paragraph style={{ marginBottom: 8 }}>
                    前提：你已经在 WSL 里装好 dsh，且<Text strong>会话工作区是家目录</Text>
                    （<Text code>~</Text>）—— 否则沙箱不允许写 <Text code>~/.dsh</Text>。
                    把安装包里的 <Text code>INSTALL-by-ai.md</Text> 拖进对话，说「按它装」即可：
                    里面是固定命令 + 硬约束，AI 只会执行 <Text code>bash install.sh</Text>，
                    缺 node / 权限不足会停下来告诉你，不会自己乱试。
                  </Paragraph>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    装完 <Text code>exit</Text> 退出，重新 <Text code>dsh --profile nju-lab-student</Text>。
                  </Paragraph>
                </>
              ),
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
