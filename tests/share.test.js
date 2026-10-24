import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShareText } from '../app/client/shareText.ts';
export const shareExample =
  '9.23 bnD:/ A@t.rR :0pm 11/24 现在这样玩还来得及吗 # 玩手机的正确打开方式 # 正确看手机姿势 https://v.douyin.com/6JyrttVf6y8/ 复制此链接，打开Dou音搜索，直接观看视频！';
test('share parser extracts local Douyin title/topics without content claims', () => {
  const r = parseShareText(shareExample);
  assert.deepEqual(r.urls, ['https://v.douyin.com/6JyrttVf6y8/']);
  assert.equal(r.title, '现在这样玩还来得及吗');
  assert.deepEqual(r.tags, ['玩手机的正确打开方式', '正确看手机姿势']);
});
test('share parser handles pure URL, multiple platforms, punctuation and deduplication', () => {
  assert.deepEqual(parseShareText('https://example.com/a?q=1'), {
    urls: ['https://example.com/a?q=1'],
    title: '',
    tags: [],
  });
  const r = parseShareText(
    'CSS grid tips #CSS #WebDev https://example.com/guide。 https://EXAMPLE.com/guide#section https://xhslink.com/demo！',
  );
  assert.deepEqual(r.urls, ['https://example.com/guide', 'https://xhslink.com/demo']);
  assert.equal(r.title, 'CSS grid tips');
  assert.deepEqual(r.tags, ['CSS', 'WebDev']);
  assert.deepEqual(
    parseShareText('参考 https://example.com/wiki/foo(bar) 和（https://example.com/b）。').urls,
    ['https://example.com/wiki/foo(bar)', 'https://example.com/b'],
  );
  assert.equal(
    parseShareText('https://example.com/a?x=1 https://example.com/a?x=2').urls.length,
    2,
  );
});
test('share parser rejects unsafe/no URL and bounds input without fetching', () => {
  assert.deepEqual(parseShareText('我的想法 #阅读').urls, []);
  assert.equal(parseShareText('我的想法').title, '我的想法');
  assert.deepEqual(
    parseShareText('javascript:alert(1) ftp://example.com http://user:secret@example.com').urls,
    [],
  );
  assert.throws(() => parseShareText('x'.repeat(20001)), /超过/);
  const r = parseShareText('阅读 #阅读 #阅读 https://example.com/');
  assert.deepEqual(r.tags, ['阅读']);
});
