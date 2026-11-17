import { Alert, Button, Card, Collapse, Space, Steps, Typography } from 'antd';
import { CloudDownloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuxiliaryPanel } from '../../hooks/useAuxiliaryPanel';
import { withBase } from '../../config';

const { Title, Paragraph, Text } = Typography;

/** 当前系统的判断只用来**默认展开**哪套安装方式，不做能力判断。 */
const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const IS_WINDOWS = /Windows/i.test(UA);
const IS_MAC = /Mac OS X|Macintosh/i.test(UA);
const IS_LINUX = /Linux/i.test(UA) && !/Android/i.test(UA);

/** 插件包（托管在 /lab/kit/ 下）：同一份插件代码，四个平台各一份依赖树。 */
const PLUGIN_ZIPS = {
  'win-x64': 'kit/nju-lab-client-plugin-win-x64.zip',
  'darwin-arm64': 'kit/nju-lab-client-plugin-darwin-arm64.zip',
  'darwin-x64': 'kit/nju-lab-client-plugin-darwin-x64.zip',
  'linux-x64': 'kit/nju-lab-client-plugin-linux-x64.zip',
} as const;

type Platform = keyof typeof PLUGIN_ZIPS;

/** 本机该默认给哪个包（mac 无法从 UA 分辨芯片，返回两个）。 */
const MY_PLATFORMS: Platform[] = IS_WINDOWS
  ? ['win-x64']
  : IS_MAC
    ? ['darwin-arm64', 'darwin-x64']
    : IS_LINUX
      ? ['linux-x64']
      : ['win-x64', 'darwin-arm64', 'darwin-x64', 'linux-x64'];

const PLUGIN_DIR = IS_WINDOWS ? 'C:\\nju-lab\\nju-lab-client' : '~/nju-lab/nju-lab-client';

/** 平台 → 给人看的名字（下载按钮与折叠区共用）。 */
const labelOf = (p: Platform): string =>
  p === 'darwin-arm64'
    ? 'macOS（Apple 芯片）'
    : p === 'darwin-x64'
      ? 'macOS（Intel）'
      : p === 'win-x64'
        ? 'Windows x64'
        : 'Linux x64';

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
        最省事的装法是<Text strong>装一个插件包</Text>：不用 WSL、不用装 dsh 命令行、不用新建 profile，
        装进你正在用的 DSH 就能用（桌面版也可以）。Windows / macOS / Linux 各有一个包，
        插件代码完全一样，只有依赖树里那颗原生模块不同。
      </Paragraph>
      <Paragraph type="secondary">
        还没装 DSH？先装 DSH（桌面版或 <Text code>npm i -g @deepseek-ai/dsh</Text>），再回来装插件。
        完全不想装也没关系：左侧菜单的<Link to="/student/workspace">「实验环境」</Link>
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
        message="推荐：装一个插件就行（不用 WSL、不用装 dsh 命令行）"
        description={
          <>
            插件包已内置全部依赖，解压后在 DSH 里「添加插件」指向该目录即可，右侧栏与设置页里立刻出现
            「NJU-Lab 平台」。平台侧仍提供两种更严格的口径：
            <Link to="/student/workspace">「实验环境」</Link>（零安装，Linux 容器）
            与 WSL2（Windows 上的本机 Linux 口径），见下方折叠区。
          </>
        }
      />

      <Card title="插件包（按平台下载）">
        <Space wrap size="middle" style={{ marginBottom: 12 }}>
          {MY_PLATFORMS.map((p) => (
            <Button
              key={p}
              type="primary"
              size="large"
              icon={<CloudDownloadOutlined />}
              href={withBase(PLUGIN_ZIPS[p])}
              download
            >
              {labelOf(p)}
            </Button>
          ))}
        </Space>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          约 2.6 MB，<Text strong>已内置运行依赖</Text>（解压后不需要联网装包）。
          {IS_MAC && ' 不确定芯片型号？左上角苹果 →「关于本机」看「芯片」；M1/M2/M3/M4 选 Apple 芯片，Intel 选 Intel。'}
        </Paragraph>
        <Collapse
          ghost
          items={[
            {
              key: 'all',
              label: '其它平台的包',
              children: (
                <Space wrap>
                  {(Object.keys(PLUGIN_ZIPS) as Platform[]).map((p) => (
                    <Button key={p} size="small" href={withBase(PLUGIN_ZIPS[p])} download>
                      {labelOf(p)}
                    </Button>
                  ))}
                </Space>
              ),
            },
          ]}
        />
        <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
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
                  例如 <Text code>{PLUGIN_DIR}</Text>，确认里面有
                  <Text code>package.json</Text>、<Text code>lib/</Text>、<Text code>node_modules/</Text>。
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
                  <pre style={{ margin: '8px 0 0', fontSize: 12, whiteSpace: 'pre-wrap' }}>{PLUGIN_DIR}</pre>
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
            <Text strong>前置</Text>：这个包装的是<Text strong>插件</Text>，需要你已经有一个 DSH
            （官方桌面版，或 <Text code>npm i -g @deepseek-ai/dsh</Text> 装的 CLI）。
          </li>
          <li>
            <Text strong>适用版本</Text>：DSH 0.2.x（插件依赖按 <Text code>0.2.2</Text> 编译；
            平台运行时为 <Text code>0.2.2-rc.1</Text>）。
          </li>
          <li>
            <Text strong>平台包差异</Text>：四个包里的插件代码完全一样（纯 JS），差别只有依赖树里那一颗
            平台相关的原生模块。装错平台会在加载时报「找不到原生模块」。
          </li>
          <li>
            <Text strong>口径提醒</Text>：平台的实验判据与复验容器是 <Text strong>Linux</Text> 口径。
            在 Windows / macOS 本地自测可能与复验有差异（涉及 <Text code>bash</Text>、
            <Text code>chmod</Text>、Linux 路径的脚本）。需要严格一致时用「实验环境」或 Windows 上的 WSL2。
          </li>
          <li>
            <Text strong>更新</Text>：右侧 NJU-Lab 面板顶部出现「发现新版本 → 立即更新」时点一下即可，
            它会从平台拉新包覆盖插件目录里的 <Text code>lib/</Text>（<Text code>node_modules/</Text> 保留），
            更新后重启 DSH 生效。
          </li>
          <li>
            <Text strong>卸载</Text>：设置 → 插件 → <Text code>nju-lab-client</Text> → 移除。
          </li>
          <li>
            包里<Text strong>不含</Text> token，也不含 profile 配置（<Text code>cordis.patch.yml</Text> 属于 DSH 自己的 profile）。
          </li>
        </ul>
      </Card>

      <Card title="实验依赖（torch / scikit-learn / matplotlib…）" style={{ marginTop: 16 }}>
        <Paragraph style={{ marginBottom: 8 }}>
          平台把常用包<Text strong>镜像在本站</Text>。配一次之后，<Text strong>所有 pip install 默认走
          「本站优先 → 清华镜像兜底」</Text>，不直连境外 PyPI（外网慢或不通时最省事）：
        </Paragraph>
        <pre style={{ margin: '0 0 8px', fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`python -m pip config set global.index-url ${window.location.origin}${withBase('pypi/simple')}
python -m pip config set global.extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple`}
        </pre>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          撤销：<Text code>python -m pip config unset global.index-url</Text>（另一条同理）。
          只想这一次用、不改配置的话：
        </Paragraph>
        <pre style={{ margin: '0 0 8px', fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`python -m pip install --index-url ${window.location.origin}${withBase('pypi/simple')} \\
  --extra-index-url https://pypi.tuna.tsinghua.edu.cn/simple \\
  torch==2.14.1+cpu scikit-learn matplotlib pandas numpy`}
        </pre>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Text strong>torch 一定要写 <Text code>torch==2.14.1+cpu</Text></Text>：清华镜像上的
            Windows/Linux torch 是 CUDA 版，会带几百 MB 的 <Text code>nvidia-*</Text> 依赖；
            <Text code>+cpu</Text> 只有本站有，pip 会因此只从本站取。
          </li>
          <li>
            覆盖 <Text strong>Windows x64 / macOS（Apple 芯片、Intel）/ Linux x64</Text> ×
            <Text strong>Python 3.12 / 3.13</Text>；依赖（sympy / filelock / pillow 等）已一并收录。
            Intel Mac 的 torch 上游停在 2.2.2，该平台没放 torch —— 深度学习请用「实验环境」。
          </li>
          <li>
            只收录实验真正用到的那几类；缺什么包告诉老师，补进索引后同一条命令即可。
            索引页：<Text code>{`${window.location.origin}${withBase('pypi/simple')}`}</Text>
          </li>
        </ul>
      </Card>

      <Card title="其它安装方式" style={{ marginTop: 16 }}>
        <Collapse
          ghost
          // 非 Windows 用户默认展开命令行那条 —— 想整套装 DSH 的人走它
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
              label: '② Windows：WSL2 + 安装包（本机 Linux 口径，适合 bash/chmod 类实验）',
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
              label: '③ macOS / Linux：命令行安装整套 DSH + 插件',
              children: (
                <>
                  <Paragraph style={{ marginBottom: 8 }}>
                    同样使用 <Text code>nju-lab-student-kit.zip</Text>（需先装 Node.js 22+）：
                  </Paragraph>
                  <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{`unzip nju-lab-student-kit.zip && cd nju-lab-student-kit && ./install.sh`}
                  </pre>
                  <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
                    只是想给已有的 DSH 加插件的话，用上面的插件包更省事（不用装 profile）。
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
