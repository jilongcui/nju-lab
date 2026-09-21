/**
 * 假 LLM（OpenAI 兼容），让 L2 端到端测试在**无模型 key、确定性**的条件下跑通 DSH。
 *
 * DSH 通过 `POST /chat/completions`（SSE 流式）访问模型。本服务的行为：
 *   - 带 `tools` 的对话请求：首次返回一个工具调用，看到工具结果后返回最终文本
 *   - 不带 `tools` 的请求（会话标题生成等）：返回一段短文本
 */
import { createServer } from 'node:http'

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
}

/**
 * @param {{ toolName?: string, toolArguments?: string, finalText?: string }} [options]
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
    const sawToolResult = (body.messages ?? []).some((m) => m.role === 'tool')
    const wantsToolCall = hasTools && !sawToolResult

    const emit = (delta, finishReason) =>
      res.write(
        `data: ${JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion.chunk',
          created: 0,
          model: body.model ?? 'fake',
          choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
        })}\n\n`,
      )

    // 非流式请求也支持，方便单独用 curl 验证
    if (body.stream !== true) {
      const message = wantsToolCall
        ? {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'call_1', type: 'function', function: { name: toolName, arguments: toolArguments } },
            ],
          }
        : { role: 'assistant', content: hasTools ? finalText : titleText }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-fake',
          object: 'chat.completion',
          created: 0,
          model: body.model ?? 'fake',
          choices: [
            { index: 0, message, finish_reason: wantsToolCall ? 'tool_calls' : 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      )
      return
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    if (wantsToolCall) {
      emit({
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: toolName, arguments: toolArguments },
          },
        ],
      })
      emit({}, 'tool_calls')
    } else {
      emit({ role: 'assistant', content: hasTools ? finalText : titleText })
      emit({}, 'stop')
    }
    res.write('data: [DONE]\n\n')
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
