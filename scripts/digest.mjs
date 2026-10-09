// AI まとめ（ダイジェスト）を管理する。要約の仕方（プロンプト）は settings.yml の digest で設定する。
//   node scripts/digest.mjs             … 過去のまとめを引き継ぐだけ
//   node scripts/digest.mjs --generate  … さらに Claude Code で今日のまとめを生成・更新
//
// 公開中のサイトから過去30日分の digests.json を取得して引き継ぐ（環境変数 SITE_URL）。
// 生成には Claude のサブスクリプション（CLAUDE_CODE_OAUTH_TOKEN）または API キーを使う。
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIGEST_SCHEMA, buildPrompt, extractStructured, finalizeDigest, mergeDigests, selectCandidates } from './digest-lib.mjs';
import { loadSettings } from './settings.mjs';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const OUT = join(DATA, 'digests.json');
const MODEL = process.env.DIGEST_MODEL || 'opus';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

async function loadPrevious() {
  const site = process.env.SITE_URL;
  if (!site) return (await readJson(OUT, { digests: [] })).digests ?? [];
  const url = `${site.replace(/\/$/, '')}/data/digests.json?t=${Date.now()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) {
    console.log('過去のまとめはまだありません（初回）');
    return [];
  }
  // 一時的な失敗で履歴を消さないよう、404 以外のエラーではデプロイを中止する
  if (!res.ok) throw new Error(`過去のまとめの取得に失敗しました: HTTP ${res.status}`);
  return (await res.json()).digests ?? [];
}

function runClaude(prompt, cwd) {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(DIGEST_SCHEMA),
    '--model', MODEL,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 15 * 60 * 1000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !out) return reject(new Error(`claude exited with ${code}: ${err.slice(0, 500)}`));
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`claude の出力を解析できません: ${out.slice(0, 300)} ${err.slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

async function generate({ genres, digest: config }) {
  // ローカルでは `claude` のログイン情報を使うので、未設定チェックは CI のみ
  if (process.env.CI && !process.env.CLAUDE_CODE_OAUTH_TOKEN && !process.env.ANTHROPIC_API_KEY) {
    console.log('::warning::CLAUDE_CODE_OAUTH_TOKEN が未設定のため、まとめの生成をスキップしました');
    return null;
  }
  const news = await readJson(join(DATA, 'news.json'), null);
  if (!news?.items?.length) throw new Error('news.json がありません。先に npm run fetch を実行してください');
  const markets = await readJson(join(DATA, 'markets.json'), { quotes: [] });

  const candidates = selectCandidates(news.items);
  if (candidates.length < 5) throw new Error(`直近の記事が少なすぎます（${candidates.length} 件）`);
  console.log(`候補記事 ${candidates.length} 件から重要ニュースを選定中（モデル: ${MODEL}）…`);

  // マーケット指標は経済・暗号資産を収集しているときだけ渡す
  const withMarket = genres.some((g) => g === 'markets' || g === 'crypto');
  const prompt = buildPrompt(config.prompt, candidates, { label: config.label, quotes: withMarket ? markets.quotes : [] });

  // リポジトリの設定やファイルを読み込ませないよう、空の作業ディレクトリで実行する
  const cwd = await mkdtemp(join(tmpdir(), 'digest-'));
  try {
    const result = await runClaude(prompt, cwd);
    const digest = finalizeDigest(extractStructured(result), news.items, { model: MODEL });
    console.log(`${digest.date} のまとめを生成しました（${digest.picks.length} 件）`);
    return digest;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const settings = await loadSettings();
const previous = await loadPrevious();
let digest = null;
if (process.argv.includes('--generate')) {
  try {
    digest = await generate(settings);
  } catch (e) {
    // 生成に失敗してもニュース本体の更新は止めない
    console.log(`::warning::まとめの生成に失敗しました: ${e.message}`);
  }
}
const digests = mergeDigests(previous, digest);
await writeFile(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), label: settings.digest.label, digests }));
console.log(`まとめ ${digests.length} 日分を保存しました`);
