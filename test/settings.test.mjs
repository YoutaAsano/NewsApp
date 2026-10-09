import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSettings, SETTINGS_PATH } from '../scripts/settings.mjs';

test('リポジトリの settings.yml は正しく読み込める', async () => {
  const s = parseSettings(await readFile(SETTINGS_PATH, 'utf8'));
  assert.ok(s.genres.includes('games'));
  assert.equal(s.digest.label, '投資の視点');
  assert.ok(s.digest.prompt.length > 50);
});

test('label 省略時は「ポイント」を使う', () => {
  const s = parseSettings('genres: [games]\ndigest:\n  prompt: ゲーム業界の重要ニュースを選んで\n');
  assert.deepEqual(s, { genres: ['games'], digest: { label: 'ポイント', prompt: 'ゲーム業界の重要ニュースを選んで' } });
});

test('誤りはまとめて日本語で報告する', () => {
  assert.throws(
    () => parseSettings('genres: [games, sports]\ndigest:\n  label: x\n'),
    (e) => /「sports」は存在しない/.test(e.message) && /prompt を書いてください/.test(e.message),
  );
  assert.throws(() => parseSettings('genres: [games\n'), /書式に誤り/);
  assert.throws(() => parseSettings('digest:\n  prompt: x\n'), /ジャンルを1つ以上/);
});
