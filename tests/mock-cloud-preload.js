// Test-process only. Never imported by production code or exposed as an API option.
import {
  fixtureResponse,
  deepSeekFixtureResponse,
  fixtureSuggestion,
  fixtureKey,
  deepSeekFixtureKey,
} from './ai-fixture.js';
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = new URL(url);
  if (['127.0.0.1', 'localhost'].includes(target.hostname)) return original(url, options);
  if (
    !['https://api.openai.com/v1/responses', 'https://api.deepseek.com/chat/completions'].includes(
      String(url),
    )
  )
    throw Error('Tests prohibit external network access.');
  const deep = target.hostname === 'api.deepseek.com';
  if (options.headers.Authorization !== 'Bearer ' + (deep ? deepSeekFixtureKey : fixtureKey))
    throw Error('Tests only accept synthetic credentials.');
  const body = JSON.parse(options.body),
    input = JSON.parse(deep ? body.messages[1].content : body.input[0].content[0].text);
  return deep
    ? deepSeekFixtureResponse(
        input.mode === 'connection' ? { answer: 'ok' } : fixtureSuggestion(input),
      )
    : fixtureResponse(input.mode === 'connection' ? { answer: 'ok' } : fixtureSuggestion(input));
};
