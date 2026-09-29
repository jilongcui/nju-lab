/**
 * 假 LLM（DSH 0.1.7 的 DeepSeek Messages 协议），让 L2 端到端测试在
 * **无模型 key、确定性**的条件下跑通 DSH。
 *
 * `dsh-llm-deepseek`（0.1.7）走的是 **Anthropic Messages 风格**的流式协议：
 *   - 请求体：`{ model, stream: true, messages, max_tokens, thinking, tools? }`
 *     （`tools` 元素是 `{ name, description, input_schema }`；工具结果在 user turn
 *     的 content 里，形如 `{ type: 'tool_result', tool_use_id }`）
 *   - 响应：带 `type` 字段的 SSE 事件序列
 *     `message_start` → `content_block_start` → `content_block_stop`
 *     → `message_delta`(stop_reason) → `message_stop`
 *
 * 旧版（0.1.5）发的是 OpenAI 的 `chat.completion.chunk`，0.1.7 会直接报
 * `DeepSeek Messages SSE event type mismatch` —— 改协议时务必同步这里。
 *
 * 本服务的行为：
 *   - 带 `tools` 且还没出现工具结果的请求：回一个 `tool_use` block
 *   - 其它请求（含会话标题生成）：回一段纯文本
 */
import { createServer } from 'node:http'

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
}

/**
 * @param {{ toolName?: string, toolArguments?: string, finalText?: string, titleText?: string }} [options]
 * @returns {Promise<{ url: string, calls: Array<object>, close(): Promise<void> }>}
 */
export async function startFakeLlm(options = {}) {
  const toolName = options.toolName ?? 'nju_lab_list_assignments'
  const toolArguments = options.toolArguments ?? '{}'
  const finalText = options.finalText ?? '已找到 2 个实验任务，其中 1 个已解锁。'
  const titleText = options.titleText ?? '实验任务'

  /** @type {Array<{url: string, body: any}>} */
  const calls = []

  const server = createServer(async (req, res) => {
    const raw = await readBody(req)
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {
      body = {}
    }
    calls.push({ url: req.url ?? '', body })

    const hasTools = Array.isArray(body.tools) && body.tools.length > 0
    // Messages 协议的工具结果：user turn 的 content 里带 `tool_result` block。
    // （旧 OpenAI 协议是 `role: 'tool'` 的独立 message。）
    const sawToolResult = (body.messages ?? []).some(
      (m) => Array.isArray(m?.content) && m.content.some((block) => block?.type === 'tool_result'),
    )
    const wantsToolCall = hasTools && !sawToolResult
    const text = hasTools ? finalText : titleText

    // 非流式请求也支持，方便单独用 curl 验证
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_fake',
          type: 'message',
          role: 'assistant',
          model: body.model ?? 'fake',
          content: wantsToolCall
            ? [
                {
                  type: 'tool_use',
                  id: 'call_1',
                  name: toolName,
                  input: JSON.parse(toolArguments),
                },
              ]
            : [{ type: 'text', text }],
          stop_reason: wantsToolCall ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      )
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    // 只发 `data:` 行（不发 `event:`）：解析器的 frame.event 为 undefined 时跳过
    // "事件名必须与 type 一致"的校验，事件类型完全由 data 里的 `type` 决定。
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)

    send({
      type: 'message_start',
      message: { id: 'msg_fake', role: 'assistant', usage: { input_tokens: 10, output_tokens: 0 } },
    })
    if (wantsToolCall) {
      send({
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'call_1',
          name: toolName,
          input: JSON.parse(toolArguments),
        },
      })
      send({ type: 'content_block_stop', index: 0 })
      send({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } })
    } else {
      send({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text },
      })
      send({ type: 'content_block_stop', index: 0 })
      send({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } })
    }
    send({ type: 'message_stop' })
    res.end()
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close() {
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
