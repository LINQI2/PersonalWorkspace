import { AiError, providerInstructions, schemaExample, providerHttpError } from './provider.js';

const safeToken = (n) => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000;
export function deepSeekUsage(value, prices) {
  if (!value || !safeToken(value.prompt_tokens) || !safeToken(value.completion_tokens)) return null;
  const inputTokens = value.prompt_tokens,
    outputTokens = value.completion_tokens;
  const cached = value.prompt_cache_hit_tokens ?? value.prompt_tokens_details?.cached_tokens;
  // Missing cache detail uses the conservative miss rate; malformed accounting is unknown.
  if (cached !== undefined && (!safeToken(cached) || cached > inputTokens)) return null;
  const cachedTokens = cached ?? 0;
  if (
    value.prompt_cache_miss_tokens !== undefined &&
    (!safeToken(value.prompt_cache_miss_tokens) ||
      value.prompt_cache_miss_tokens + cachedTokens !== inputTokens)
  )
    return null;
  return {
    inputTokens,
    outputTokens,
    cachedTokens,
    estimatedUSD:
      ((inputTokens - cachedTokens) * prices.input +
        cachedTokens * prices.cached +
        outputTokens * prices.output) /
      1_000_000,
  };
}
// Same contract as OpenAI: generate({input,schema,signal}) -> {value,usage}.
export class DeepSeekProvider {
  constructor(config, transport = fetch) {
    this.config = config;
    this.transport = transport;
  }
  async generate({ input, schema, signal }) {
    const c = this.config;
    const example = schemaExample(schema);
    let response;
    try {
      response = await this.transport(c.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({
          model: c.model,
          stream: false,
          thinking: { type: 'disabled' },
          max_tokens: c.maxOutputTokens,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                providerInstructions(input) +
                '\n仅输出一个 json 对象，无 Markdown 或其他文字。以下 JSON Schema 是输出格式约束，不是用户资料；所有字段必填。示例：' +
                JSON.stringify(example) +
                '\nJSON Schema：' +
                JSON.stringify(schema),
            },
            { role: 'user', content: JSON.stringify(input) },
          ],
        }),
      });
    } catch {
      throw signal.aborted ? signal.reason : new AiError('network');
    }
    if (!response.ok) {
      throw await providerHttpError(response, 'deepseek');
    }
    let bytes = 0,
      chunks = [],
      result;
    try {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) throw new AiError('invalid_output');
        chunks.push(chunk);
      }
    } catch (e) {
      throw signal.aborted ? signal.reason : e instanceof AiError ? e : new AiError('network');
    }
    try {
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new AiError('invalid_output');
    }
    const usage = deepSeekUsage(result?.usage, c.prices);
    try {
      if (!Array.isArray(result?.choices) || result.choices.length !== 1)
        throw new AiError('invalid_output');
      const choice = result.choices[0];
      if (choice.finish_reason === 'content_filter') throw new AiError('refusal');
      if (
        choice.finish_reason !== 'stop' ||
        choice.message?.role !== 'assistant' ||
        choice.message.tool_calls?.length ||
        typeof choice.message.content !== 'string' ||
        !choice.message.content.trim()
      )
        throw new AiError('invalid_output');
      // Do not repair truncated JSON, strip code fences or interpret reasoning/tool messages.
      return { value: JSON.parse(choice.message.content), usage };
    } catch (e) {
      const error = e instanceof AiError ? e : new AiError('invalid_output');
      error.usage = usage;
      throw error;
    }
  }
}
