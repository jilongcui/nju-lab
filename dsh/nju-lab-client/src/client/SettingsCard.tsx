import { useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * 设置页「插件配置」里的 nju-lab 卡片（serverUrl / token）。
 *
 * DSH 0.1.7 起设置节按 profile 条目 id（本插件 = `nju-lab-client`）自动投影，卡片
 * 拿到的是该条目的 `ConfigForm`（`ctx.configForms.get(NAMESPACE)`），由 client 半
 * 注册到 `settings.plugins.tab`。官方内置卡片的辅助组件受 bundle 纯净度门禁限制
 * 不能跨包 import，这里自绘简化版。
 */

export interface NjuLabSettings {
  serverUrl?: string
  token?: string
}

const row = { margin: '12px 0' }
const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 600 } as const
const inputStyle = {
  width: '100%',
  padding: '6px 8px',
  boxSizing: 'border-box',
  font: 'inherit',
} as const
const hint = { color: 'var(--dsh-color-text-secondary, #888)', fontSize: 12, marginTop: 4 }
const btn = { padding: '6px 16px', font: 'inherit', cursor: 'pointer' }

export function SettingsCard({ form }: { form: ConfigForm<NjuLabSettings> }) {
  const snap = useSyncExternalStore(
    (listener) => form.subscribe(listener),
    () => form.getSnapshot(),
  )
  // null = 未编辑，跟随 snapshot；编辑后持有本地草稿
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const [tokenDraft, setTokenDraft] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  if (snap.status === 'loading') return <section>设置加载中…</section>
  if (snap.status === 'unavailable') return <section>nju-lab 设置命名空间不可用。</section>

  const serverUrl = urlDraft ?? snap.value?.serverUrl ?? ''
  const token = tokenDraft ?? snap.value?.token ?? ''
  const dirty = urlDraft !== null || tokenDraft !== null

  const save = async () => {
    setState('saving')
    try {
      // 空串视为「清除回组装层」（serverUrl 回环境变量默认值，token 回未设置）
      if (urlDraft !== null) {
        if (urlDraft === '') await form.unset('serverUrl')
        else await form.set('serverUrl', urlDraft)
      }
      if (tokenDraft !== null) {
        if (tokenDraft === '') await form.unset('token')
        else await form.set('token', tokenDraft)
      }
      setUrlDraft(null)
      setTokenDraft(null)
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <section>
      <h3>NJU-Lab 平台</h3>
      <div style={row}>
        <label style={labelStyle} htmlFor="nju-lab-server-url">serverUrl</label>
        <input
          id="nju-lab-server-url"
          style={inputStyle}
          value={serverUrl}
          disabled={!snap.writable}
          placeholder="https://lab.xiaohe.biz/api"
          onChange={(e) => { setUrlDraft(e.target.value); setState('idle') }}
        />
        <div style={hint}>平台服务基址。清空保存则回到环境变量 NJU_LAB_SERVER_URL 的默认值。</div>
      </div>
      <div style={row}>
        <label style={labelStyle} htmlFor="nju-lab-token">token</label>
        <input
          id="nju-lab-token"
          style={inputStyle}
          type="password"
          value={token}
          disabled={!snap.writable}
          placeholder="平台右上角头像 →「API Token」→ 生成"
          onChange={(e) => { setTokenDraft(e.target.value); setState('idle') }}
        />
        <div style={hint}>长期 token（365 天）。改动即时生效，无需重启。</div>
      </div>
      <button style={btn} disabled={!snap.writable || !dirty || state === 'saving'} onClick={() => void save()}>
        {state === 'saving' ? '保存中…' : '保存'}
      </button>
      {state === 'saved' && <span style={{ ...hint, marginLeft: 8 }}>已保存 ✓</span>}
      {state === 'error' && <span style={{ ...hint, marginLeft: 8 }}>保存失败，请检查取值后重试</span>}
    </section>
  )
}
