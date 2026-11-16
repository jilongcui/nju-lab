import { Alert, Button, Card, Collapse, Steps, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { withBase } from '../../config';

const { Title, Paragraph, Text } = Typography;

/**
 * 是否 Windows：只影响**默认展开哪套安装方式**。
 * Windows 走「插件包」（免 WSL、免装 dsh CLI），其它系统走命令行安装。
 * 不是能力判断 —— 平台侧「实验环境」对任何系统都一样可用。
 */
const IS_WINDOWS = /Windows/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
);

/** 插件包文件名（托管在 /lab/kit/ 下，与 kit 同目录）。 */
const PLUGIN_ZIP = 'kit/nju-lab-client-plugin-win-x64.zip';

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
        DSH 版本以 0.2.2 为基线（0.2.x 各版本都能用）。
      </Paragraph>
      <Paragraph type="secondary">
        Windows 最省事的装法是<Text strong>装一个插件包</Text>：不用 WSL、不用装 dsh 命令行、不用新建 profile，
        装进你正在用的 DSH 就能用（桌面版也可以）。其它系统见本页「命令行安装」。
      </Paragraph>
      <Paragraph type="secondary">
        不想在本机装任何东西？平台左侧菜单的<Link to="/student/workspace">「实验环境」</Link>
        就是浏览器里的完整 DSH，判据与复验容器完全一致。
      </Paragraph>
    </div>,
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <Title level={4}>客户端下载（学生端 DSH）</Title>

      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message={
          IS_WINDOWS
            ? '推荐：装一个插件就行（不用 WSL、不用装 dsh 命令行）'
            : 'Windows 同学看「插件包」；你当前系统请用下面的命令行安装'
        }
        description={
          IS_WINDOWS ? (
            <>
              插件包已内置全部依赖，解压后在 DSH 里「添加插件」指向该目录即可，右侧栏与设置页里立刻出现
              「NJU-Lab 平台」。平台侧仍提供两种更严格的口径：
              <Link to="/student/workspace">「实验环境」</Link>（零安装，Linux 容器）
              与 WSL2（本机 Linux 口径），见下方折叠区。
            </>
          ) : (
            <>
              本页的插件包是 Windows x64 专用。macOS / Linux 请用下方
              <Text code>install.sh</Text>，或者直接用
              <Link to="/student/workspace">「实验环境」</Link>（浏览器即用，免安装）。
            </>
          )
        }
      />

      <Card title="插件包（Windows x64）">
        <Button
          type="primary"
          size="large"
          icon={<CloudDownloadOutlined />}
          href={withBase(PLUGIN_ZIP)}
          download
          style={{ marginBottom: 12 }}
        >
          下载 nju-lab-client-plugin-win-x64.zip
        </Button>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          约 4.2 MB，<Text strong>已内置运行依赖</Text>（解压后不需要联网装包）。
          装的是与命令行安装包<Text strong>同一个插件</Text>（<Text code>nju-lab-client</Text>），
          区别只在安装方式：不需要 WSL、不需要全局装 dsh CLI、不需要新建 profile。
        </Paragraph>
      </Card>

      <Card title="三步装好" style={{ marginTop: 16 }}>
        <Steps
          direction="vertical"
          size="small"
          items={[
            {
              title: '解压到一个固定位置',
              description: (
                <>
                  例如 <Text code>{'C:\\nju-lab\\nju-lab-client'}</Text>，确认里面有
                  <Text code>package.json</Text>、<Text code>lib\</Text>、<Text code>node_modules\</Text>。
                  <br />
                  ⚠️ 这个目录<Text strong>之后不要删或移动</Text> —— DSH 是链接到它的，挪走插件就失效。
                </>
              ),
            },
            {
              title: '在 DSH 里添加插件',
              description: (
                <>
                  打开 DSH → 左下角<Text strong>设置（齿轮）</Text> → <Text strong>插件</Text> →
                  右上角<Text strong>「添加插件 / Add plugin」</Text> → 填（或选择）目录路径：
                  <pre style={{ margin: '8px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`C:\\nju-lab\\nju-lab-client`}
                  </pre>
                  装好后插件列表里会出现 <Text code>nju-lab-client</Text>，状态应为「已启用」。
                </>
              ),
            },
            {
              title: '填 token',
              description: (
                <>
                  <Text strong>设置 → 插件 → 「NJU-Lab 平台」</Text>：
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    <li>
                      <Text code>serverUrl</Text>：已预填 <Text code>{serverUrl}</Text>，一般不用改
                    </li>
                    <li>
                      <Text code>token</Text>：本页右上角头像 →「API Token」→ 生成后粘贴
                    </li>
                  </ul>
                  保存即生效（这两个字段是实时的，不用重启 DSH）。
                </>
              ),
            },
          ]}
        />
      </Card>

      <Card title="验证装好了" style={{ marginTop: 16 }}>
        <Paragraph style={{ marginBottom: 0 }}>
          在对话框里说一句<Text strong>「列出我的实验任务」</Text> —— 能列出任务列表就说明整条链路通了
          （token 有效、能连上平台、工具已注册）。若提示「未配置平台 token」，就是第 3 步没保存成功。
        </Paragraph>
      </Card>

      <Card title="说明与限制" style={{ marginTop: 16 }}>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Text strong>适用版本</Text>：DSH 0.2.x（插件依赖按 0.2.2 编译，本包在{' '}
            <Text code>0.2.2-rc.3</Text> 上实测通过；平台运行时为 <Text code>0.2.2-rc.1</Text>）。
          </li>
          <li>
            <Text strong>口径提醒</Text>：平台的实验判据与复验容器是 <Text strong>Linux</Text> 口径。
            Windows 本地自测可能与复验有差异（涉及 <Text code>bash</Text>、<Text code>chmod</Text>、Linux 路径的脚本）。
            需要严格一致时用「实验环境」或下方 WSL2。
          </li>
          <li>
            <Text strong>更新</Text>：右侧 NJU-Lab 面板顶部出现「发现新版本 → 立即更新」时点一下即可，
            它会从平台拉新包覆盖插件目录里的 <Text code>lib\</Text>（<Text code>node_modules\</Text> 保留），
            更新后重启 DSH 生效。
          </li>
          <li>
            <Text strong>卸载</Text>：设置 → 插件 → <Text code>nju-lab-client</Text> → 移除。
          </li>
          <li>
            包里<Text strong>不含</Text> token、也不含 profile 配置（<Text code>cordis.patch.yml</Text> 属于 DSH 自己的 profile）。
          </li>
        </ul>
      </Card>

      <Card title="其它安装方式" style={{ marginTop: 16 }}>
        <Collapse
          ghost
          // 非 Windows 用户默认展开命令行那条 —— 那才是他们的主路径
          defaultActiveKey={IS_WINDOWS ? [] : ['cli']}
          items={[
            {
              key: 'workspace',
              label: '① 浏览器「实验环境」（零安装，判据与复验完全一致）',
              children: (
                <Paragraph style={{ margin: 0 }}>
                  左侧菜单的 <Link to="/student/workspace">「实验环境」</Link>
                  在浏览器里给你一个完整的 Linux 容器 DSH（python / pandas / torch 齐全），
                  文件放 <Text code>/workspace</Text> 会保留。没有本机 GPU、也不能自己装额外依赖，
                  但「自测条件 = 复验条件」。
                </Paragraph>
              ),
            },
            {
              key: 'wsl',
              label: `② WSL2 + 安装包（本机 Linux 口径，适合 bash/chmod 类实验）`,
              children: (
                <>
                  <Paragraph style={{ marginBottom: 8 }}>
                    下载 <Text code>nju-lab-student-kit.zip</Text>，解压后在 PowerShell 里运行引导脚本
                    （缺 WSL 时它会打印 <Text code>wsl --install</Text> 的步骤；WSL 里还需自装 Node.js 22+）：
                  </Paragraph>
                  <pre style={{ margin: '0 0 8px', fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`powershell -ExecutionPolicy Bypass -File .\\install.ps1`}
                  </pre>
                  <Paragraph type="secondary" style={{ margin: 0 }}>
                    装完用 <Text code>dsh --profile nju-lab-student</Text> 启动，浏览器打开终端里打印的
                    <Text code> http://127.0.0.1:…/?token=…</Text>（WSL2 与 Windows 共用 127.0.0.1）。
                    包内 <Text code>check.sh</Text> 可做自检。
                  </Paragraph>
                </>
              ),
            },
            {
              key: 'cli',
              label: '③ macOS / Linux 命令行安装',
              children: (
                <>
                  <Paragraph style={{ marginBottom: 8 }}>
                    同样使用 <Text code>nju-lab-student-kit.zip</Text>（需先装 Node.js 22+）：
                  </Paragraph>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`unzip nju-lab-student-kit.zip && cd nju-lab-student-kit && ./install.sh`}
                  </pre>
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
