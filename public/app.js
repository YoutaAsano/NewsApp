// Money Signal フロントエンド
const PAGE_SIZE = 30;
const STALE_MS = 10 * 60 * 1000; // タブ復帰時にこれより古ければ再取得
const MAX_READ = 3000;
const CAT_COLORS = {
  markets: 'var(--cat-markets)',
  world: 'var(--cat-world)',
  tech: 'var(--cat-tech)',
  crypto: 'var(--cat-crypto)',
  games: 'var(--cat-games)',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------- 永続化（localStorage は使えない環境もあるので try/catch） ----------

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`ms:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`ms:${key}`, JSON.stringify(value));
    } catch {}
  },
};

const prefs = Object.assign(
  { theme: 'system', hideRead: false, showImages: true, lang: 'all', mutedWords: [], mutedSources: [], hiddenGenres: [] },
  store.get('prefs', {}),
);
const savePrefs = () => store.set('prefs', prefs);

const readIds = new Set(store.get('read', []));
const saved = new Map(store.get('saved', []).map((it) => [it.id, it])); // 記事が消えても残るよう本体ごと保存

const state = {
  data: null,
  markets: null,
  category: 'all',
  topic: null,
  query: '',
  shown: PAGE_SIZE,
  lastFetch: 0,
  digests: [], // 日付ごとのまとめ（新しい順）
  digestLabel: '投資の視点', // 各ニュースの解説の見出し（settings.yml の digest.label）
  digestIndex: 0, // 表示中のまとめ（0 = 最新）
};

// ---------- ユーティリティ ----------

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : '#');

function timeAgo(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'たった今';
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (el.hidden = true), 2200);
}

const ICONS = {
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Zm1 2v12.6l5-2.9 5 2.9V5Z"/></svg>',
  bookmarkFilled: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>',
  translate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.9 15.1 10.4 12.6l.03-.03A17.4 17.4 0 0 0 14.1 6H17V4h-7V2H8v2H1v2h11.2A15.7 15.7 0 0 1 9 11.4 15.6 15.6 0 0 1 6.7 8H4.7a17.6 17.6 0 0 0 3 4.6l-5.1 5L4 19l5-5 3.1 3.1.8-2ZM18.5 10h-2L12 22h2l1.1-3h4.8l1.1 3h2l-4.5-12Zm-2.6 7 1.6-4.3 1.6 4.3Z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7l-6.7 3.4a3 3 0 1 0 0 3.2L15 17a3 3 0 1 0 3-1Z"/></svg>',
};

// ---------- データ取得 ----------

async function getJson(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function load({ manual = false } = {}) {
  const btn = $('#refresh');
  btn.classList.add('spinning');
  try {
    const [news, markets, digests] = await Promise.allSettled([
      getJson('data/news.json'),
      getJson('data/markets.json'),
      getJson('data/digests.json'),
    ]);
    if (news.status === 'fulfilled') {
      const changed = state.data?.generatedAt !== news.value.generatedAt;
      state.data = news.value;
      if (manual) toast(changed ? 'ニュースを更新しました' : '最新の状態です');
    } else if (!state.data) {
      throw news.reason;
    } else if (manual) {
      toast('更新に失敗しました。オフラインの可能性があります');
    }
    if (markets.status === 'fulfilled') state.markets = markets.value;
    if (digests.status === 'fulfilled') {
      const latest = state.digests[0]?.generatedAt;
      state.digests = digests.value.digests ?? [];
      state.digestLabel = digests.value.label || '投資の視点';
      if (latest !== state.digests[0]?.generatedAt) state.digestIndex = 0;
    }
    state.lastFetch = Date.now();
    renderAll();
  } catch (err) {
    console.error(err);
    $('#list').innerHTML = '';
    showEmpty('ニュースを読み込めませんでした。時間をおいて再度お試しください。');
  } finally {
    btn.classList.remove('spinning');
  }
}

// ---------- フィルタリング ----------

function mutedMatcher() {
  const words = prefs.mutedWords.map((w) => w.trim().toLowerCase()).filter(Boolean);
  return (title) => {
    const t = title.toLowerCase();
    return words.some((w) => t.includes(w));
  };
}

function baseItems() {
  if (!state.data) return [];
  const isMuted = mutedMatcher();
  const mutedSources = new Set(prefs.mutedSources);
  const hiddenGenres = new Set(prefs.hiddenGenres);
  return state.data.items.filter(
    (it) =>
      !hiddenGenres.has(it.category) &&
      !mutedSources.has(it.feed) &&
      !isMuted(it.title) &&
      (prefs.lang === 'all' || it.lang === prefs.lang),
  );
}

function visibleItems() {
  let items = state.category === 'saved' ? [...saved.values()].sort((a, b) => b.published.localeCompare(a.published)) : baseItems();
  if (state.category !== 'all' && state.category !== 'saved') items = items.filter((it) => it.category === state.category);
  if (state.topic) items = items.filter((it) => it.tags.includes(state.topic));
  if (state.query) {
    const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    items = items.filter((it) => {
      const hay = `${it.title} ${it.summary} ${it.source}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  if (prefs.hideRead && state.category !== 'saved') items = items.filter((it) => !readIds.has(it.id));
  return items;
}

// ---------- 描画 ----------

function renderAll() {
  renderCategories();
  renderTopics();
  renderLang();
  renderMarkets();
  renderList();
  renderUpdated();
}

function renderCategories() {
  const items = baseItems();
  const counts = items.reduce((m, it) => ((m[it.category] = (m[it.category] ?? 0) + 1), m), {});
  const cats = [
    ...(state.digests.length ? [{ id: 'digest', label: '重要ニュース', n: state.digests[0].picks.length, star: true }] : []),
    { id: 'all', label: 'すべて', n: items.length },
    ...(state.data?.categories ?? [])
      .filter((c) => !prefs.hiddenGenres.includes(c.id))
      .map((c) => ({ ...c, n: counts[c.id] ?? 0, color: CAT_COLORS[c.id] })),
    { id: 'saved', label: '保存済み', n: saved.size },
  ];
  $('#categories').innerHTML = cats
    .map(
      (c) => `<li role="presentation"><button class="tab" role="tab" type="button" data-cat="${esc(c.id)}" aria-selected="${state.category === c.id}">
        ${c.star ? '<span class="star" aria-hidden="true">★</span>' : c.color ? `<span class="dot" style="--c:${c.color}"></span>` : ''}${esc(c.label)}<span class="n">${c.n}</span></button></li>`,
    )
    .join('');
}

function renderTopics() {
  const topics = state.data?.topics ?? [];
  const html = [
    `<button class="chip" type="button" data-topic="" aria-pressed="${!state.topic}">すべてのトピック</button>`,
    ...topics.map((t) => `<button class="chip" type="button" data-topic="${t.id}" aria-pressed="${state.topic === t.id}">${esc(t.label)}</button>`),
  ].join('');
  $('#topics').innerHTML = html;
  $('#topics-mobile').innerHTML = html;
}

function renderLang() {
  $$('.lang-seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === prefs.lang)));
}

function fmtPrice(q) {
  const digits = q.price >= 1000 ? 0 : q.price >= 10 ? 2 : 3;
  return q.price.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function renderMarkets() {
  const quotes = state.markets?.quotes ?? [];
  const el = $('#markets');
  el.hidden = quotes.length === 0;
  el.innerHTML = quotes
    .map((q) => {
      const pct = q.changePercent;
      const cls = pct == null ? '' : pct >= 0 ? 'up' : 'down';
      const chg = pct == null ? '—' : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(2)}%`;
      const title = q.time ? `${q.label}（${fmtDate(q.time)} 時点）` : q.label;
      return `<div class="quote" title="${esc(title)}"><div class="label">${esc(q.label)}</div>
        <div class="price">${fmtPrice(q)}</div><div class="chg ${cls}">${chg}</div></div>`;
    })
    .join('');
}

function renderUpdated() {
  if (!state.data) return;
  $('#updated').textContent = `${fmtDate(state.data.generatedAt)} 更新`;
  $('#updated').title = '配信元のニュースは約30分ごとに自動で収集されます';
}

function cardHtml(it, topicLabels) {
  const isSaved = saved.has(it.id);
  const tags = it.tags
    .slice(0, 3)
    .map((t) => (topicLabels[t] ? `<button class="tag" type="button" data-topic="${t}">${esc(topicLabels[t])}</button>` : ''))
    .join('');
  const translate =
    it.lang === 'en'
      ? `<a class="icon-btn" href="https://translate.google.com/translate?sl=auto&tl=ja&u=${encodeURIComponent(it.link)}" target="_blank" rel="noopener noreferrer" title="日本語に翻訳して開く" aria-label="日本語に翻訳して開く" data-read="${it.id}">${ICONS.translate}</a>`
      : '';
  const img =
    prefs.showImages && it.image
      ? `<img class="thumb" src="${esc(safeUrl(it.image))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : '';
  return `<article class="card${readIds.has(it.id) ? ' read' : ''}" data-id="${it.id}">
    <div class="meta"><span class="dot" style="--c:${CAT_COLORS[it.category] ?? 'var(--text-3)'}"></span>
      <span class="src">${esc(it.source)}</span><time datetime="${esc(it.published)}" title="${esc(fmtDate(it.published))}">${timeAgo(it.published)}</time>
      ${it.lang === 'en' ? '<span class="badge">EN</span>' : ''}</div>
    <h2 class="title"><a href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer" data-read="${it.id}">${esc(it.title)}</a></h2>
    ${it.summary ? `<p class="summary">${esc(it.summary)}</p>` : ''}
    ${img}
    <div class="foot"><div class="tags">${tags}</div><div class="tools">
      ${translate}
      ${navigator.share ? `<button class="icon-btn" type="button" data-share="${it.id}" title="共有" aria-label="共有">${ICONS.share}</button>` : ''}
      <button class="icon-btn" type="button" data-save="${it.id}" aria-pressed="${isSaved}" title="${isSaved ? '保存を解除' : '後で読む'}" aria-label="${isSaved ? '保存を解除' : '後で読む'}">${isSaved ? ICONS.bookmarkFilled : ICONS.bookmark}</button>
    </div></div>
  </article>`;
}

function showEmpty(msg) {
  const el = $('#empty');
  el.textContent = msg;
  el.hidden = !msg;
}

// ---------- 重要ニュース（AI ダイジェスト） ----------

const KIND_LABELS = { opportunity: 'チャンス', risk: 'リスク', watch: '注目' };

function digestDateLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 15 * 3600 * 1000).toISOString().slice(0, 10);
  const rel = date === today ? '今日 ' : date === yesterday ? '昨日 ' : '';
  return `${rel}${m}月${d}日(${wd})`;
}

function renderDigest() {
  const el = $('#digest-view');
  const list = state.digests;
  const d = list[state.digestIndex];
  if (!d) {
    el.innerHTML = '';
    showEmpty('重要ニュースのまとめはまだありません。毎日朝と夕方に自動で作成されます。');
    return;
  }
  const options = list
    .map((x, i) => `<option value="${i}" ${i === state.digestIndex ? 'selected' : ''}>${esc(digestDateLabel(x.date))}</option>`)
    .join('');
  const picks = d.picks
    .map(
      (p, i) => `<li class="pick kind-${esc(p.kind)}">
        <div class="pick-head"><span class="rank">${i + 1}</span>
          <span class="kind">${KIND_LABELS[p.kind] ?? '注目'}</span>
          ${p.impact === 'high' ? '<span class="impact">影響大</span>' : ''}</div>
        <h3>${esc(p.headline)}</h3>
        <p>${esc(p.summary)}</p>
        ${p.why ? `<div class="why"><strong>${esc(state.digestLabel)}</strong>${esc(p.why)}</div>` : ''}
        ${p.assets?.length ? `<div class="assets">${p.assets.map((a) => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
        <ul class="refs">${p.articles
          .map(
            (a) => `<li><a href="${esc(safeUrl(a.link))}" target="_blank" rel="noopener noreferrer" data-read="${esc(a.id)}">
              <span class="src">${esc(a.source)}</span>${esc(a.title)}</a></li>`,
          )
          .join('')}</ul>
      </li>`,
    )
    .join('');
  el.innerHTML = `<div class="digest-nav">
      <button class="icon-btn" type="button" data-dnav="1" aria-label="前の日" ${state.digestIndex >= list.length - 1 ? 'disabled' : ''}>‹</button>
      <select id="digest-date" aria-label="日付を選択">${options}</select>
      <button class="icon-btn" type="button" data-dnav="-1" aria-label="次の日" ${state.digestIndex === 0 ? 'disabled' : ''}>›</button>
    </div>
    <p class="digest-meta">${esc(fmtDate(d.generatedAt))} 更新 ・ AI（Claude）が選定・要約しています。詳細は元記事でご確認ください。</p>
    <section class="overview"><h2>概況</h2><p>${esc(d.overview)}</p></section>
    <ol class="picks">${picks}</ol>`;
  showEmpty('');
}

function renderDigestBanner() {
  const el = $('#digest-banner');
  const d = state.digests[0];
  const show = d && state.category === 'all' && !state.query && !state.topic;
  el.hidden = !show;
  if (!show) return;
  const top = d.picks.slice(0, 3).map((p) => `<li>${esc(p.headline)}</li>`).join('');
  el.innerHTML = `<button type="button" data-cat="digest" class="banner-btn">
    <span class="banner-title">★ ${esc(digestDateLabel(d.date))}の重要ニュース <span class="n">${d.picks.length}件</span></span>
    <ol>${top}</ol><span class="banner-more">まとめを読む ›</span></button>`;
}

function renderList() {
  const isDigest = state.category === 'digest';
  $('#digest-view').hidden = !isDigest;
  $('#list').hidden = isDigest;
  $('.status-line').hidden = isDigest;
  $('.mobile-filters').hidden = isDigest;
  renderDigestBanner();
  if (isDigest) {
    $('#more').hidden = true;
    renderDigest();
    return;
  }
  const items = visibleItems();
  const topicLabels = Object.fromEntries((state.data?.topics ?? []).map((t) => [t.id, t.label]));
  const page = items.slice(0, state.shown);
  $('#list').innerHTML = page.map((it) => cardHtml(it, topicLabels)).join('');
  $('#list').querySelectorAll('img.thumb').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
  $('#more').hidden = items.length <= state.shown;
  $('#count').textContent = `${items.length} 件`;
  showEmpty(
    items.length
      ? ''
      : state.category === 'saved'
        ? '保存した記事はまだありません。記事のしおりボタンで後から読めるように保存できます。'
        : '条件に合う記事がありません。',
  );
}

// ---------- 操作 ----------

function findItem(id) {
  return state.data?.items.find((it) => it.id === id) ?? saved.get(id);
}

function markRead(id) {
  if (readIds.has(id)) return;
  readIds.add(id);
  const arr = [...readIds];
  store.set('read', arr.slice(-MAX_READ));
  document.querySelector(`.card[data-id="${CSS.escape(id)}"]`)?.classList.add('read');
}

function toggleSave(id) {
  if (saved.has(id)) {
    saved.delete(id);
    toast('保存を解除しました');
  } else {
    const it = findItem(id);
    if (!it) return;
    saved.set(id, it);
    toast('後で読むに保存しました');
  }
  store.set('saved', [...saved.values()]);
  renderCategories();
  renderList();
}

function resetPaging() {
  state.shown = PAGE_SIZE;
  window.scrollTo({ top: 0 });
}

function setTopic(id) {
  state.topic = id || null;
  resetPaging();
  renderTopics();
  renderList();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('button, a');
  if (!t) return;

  if (t.dataset.dnav) {
    state.digestIndex = Math.min(Math.max(state.digestIndex + Number(t.dataset.dnav), 0), state.digests.length - 1);
    renderList();
  } else if (t.dataset.cat) {
    state.category = t.dataset.cat;
    resetPaging();
    renderCategories();
    renderList();
    t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } else if ('topic' in t.dataset) {
    setTopic(state.topic === t.dataset.topic ? null : t.dataset.topic);
  } else if (t.dataset.lang) {
    prefs.lang = t.dataset.lang;
    savePrefs();
    resetPaging();
    renderAll();
  } else if (t.dataset.save) {
    toggleSave(t.dataset.save);
  } else if (t.dataset.share) {
    const it = findItem(t.dataset.share);
    if (it) navigator.share({ title: it.title, url: it.link }).catch(() => {});
  } else if (t.dataset.read) {
    markRead(t.dataset.read);
  }
});

// 中クリック等で開いた場合も既読にする
document.addEventListener('auxclick', (e) => {
  const a = e.target.closest('a[data-read]');
  if (a) markRead(a.dataset.read);
});

$('#more').addEventListener('click', () => {
  state.shown += PAGE_SIZE;
  renderList();
});

// 一番下までスクロールしたら自動で続きを表示
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    if (entries.some((en) => en.isIntersecting) && !$('#more').hidden) {
      state.shown += PAGE_SIZE;
      renderList();
    }
  }, { rootMargin: '400px' }).observe($('#more'));
}

let searchTimer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    state.shown = PAGE_SIZE;
    renderList();
  }, 150);
});

$('#refresh').addEventListener('click', () => load({ manual: true }));

document.addEventListener('change', (e) => {
  if (e.target.id === 'digest-date') {
    state.digestIndex = Number(e.target.value);
    renderList();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastFetch > STALE_MS) load();
});

// キーボード: "/" で検索
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    $('#q').focus();
  }
});

// ---------- 設定 ----------

function applyTheme() {
  if (prefs.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = prefs.theme;
}

function renderSources() {
  const sources = state.data?.sources ?? [];
  const muted = new Set(prefs.mutedSources);
  const groups = (state.data?.categories ?? [])
    .filter((c) => !prefs.hiddenGenres.includes(c.id))
    .map((c) => ({ ...c, list: sources.filter((s) => s.category === c.id) }));
  $('#sources').innerHTML = groups
    .map(
      (g) => `<h4>${esc(g.label)}</h4>${g.list
        .map(
          (s) => `<label><input type="checkbox" data-source="${esc(s.name)}" ${muted.has(s.name) ? '' : 'checked'}>
            ${esc(s.name)}${s.lang === 'en' ? ' <span class="badge">EN</span>' : ''}
            ${s.ok ? `<span class="cnt">${s.count}件</span>` : '<span class="cnt err">取得失敗</span>'}</label>`,
        )
        .join('')}`,
    )
    .join('');
}

function genreLabel(id) {
  return state.data?.settings?.available?.find((g) => g.id === id)?.label ?? id;
}

function renderGenreToggles() {
  const cats = state.data?.categories ?? [];
  const hidden = new Set(prefs.hiddenGenres);
  $('#genre-toggles').innerHTML = cats.length
    ? cats
        .map(
          (c) => `<label><input type="checkbox" data-genre="${esc(c.id)}" ${hidden.has(c.id) ? '' : 'checked'}>
            <span class="dot" style="--c:${CAT_COLORS[c.id] ?? 'var(--text-3)'}"></span>${esc(c.label)}</label>`,
        )
        .join('')
    : '<p class="hint">読み込み中です。</p>';
}

function renderServerSettings() {
  const st = state.data?.settings;
  const el = $('#server-settings');
  if (!st) {
    el.innerHTML = '<p class="hint">設定情報はまだありません。次回のニュース収集後に表示されます。</p>';
    return;
  }
  const digest = st.digest
    ? `<details class="digest-config"><summary><strong>★ 重要ニュースのプロンプト</strong>
        <span class="hint">解説の見出し: ${esc(st.digest.label)}</span></summary>
        <pre>${esc(st.digest.prompt)}</pre></details>`
    : '';
  const urls = st.urls;
  el.innerHTML = `<p class="row-text"><span class="hint">収集中のジャンル</span>${st.genres.map((g) => `<span class="pill">${esc(genreLabel(g))}</span>`).join('')}</p>
    <p class="hint">AI まとめ（タップでプロンプトを表示。収集中のジャンルから1日2回作成）</p>
    ${digest}
    ${
      urls
        ? `<div class="btn-row">
            <a class="btn primary" href="${esc(safeUrl(urls.edit))}" target="_blank" rel="noopener noreferrer">設定を編集する（GitHub）</a>
            <a class="btn" href="${esc(safeUrl(urls.actions))}" target="_blank" rel="noopener noreferrer">更新の状況を見る</a>
          </div>
          <p class="hint">GitHub で settings.yml を編集して保存すると、数分後にニュースの収集が新しいジャンルでやり直されます。プロンプトの変更は次の定時（7時・18時ごろ）のまとめから反映されます。</p>`
        : ''
    }`;
}

$('#open-settings').addEventListener('click', () => {
  $('#hide-read').checked = prefs.hideRead;
  $('#show-images').checked = prefs.showImages;
  $('#theme').value = prefs.theme;
  $('#muted-words').value = prefs.mutedWords.join(', ');
  renderGenreToggles();
  renderServerSettings();
  renderSources();
  $('#settings').showModal();
});

$('#settings').addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'hide-read') prefs.hideRead = t.checked;
  else if (t.id === 'show-images') prefs.showImages = t.checked;
  else if (t.id === 'theme') {
    prefs.theme = t.value;
    applyTheme();
  } else if (t.id === 'muted-words') {
    prefs.mutedWords = t.value.split(/[,、\n]/).map((w) => w.trim()).filter(Boolean);
  } else if (t.dataset.genre) {
    const set = new Set(prefs.hiddenGenres);
    t.checked ? set.delete(t.dataset.genre) : set.add(t.dataset.genre);
    prefs.hiddenGenres = [...set];
    if (prefs.hiddenGenres.includes(state.category)) state.category = 'all';
  } else if (t.dataset.source) {
    const set = new Set(prefs.mutedSources);
    t.checked ? set.delete(t.dataset.source) : set.add(t.dataset.source);
    prefs.mutedSources = [...set];
  }
  savePrefs();
  renderAll();
});

$('#clear-read').addEventListener('click', () => {
  readIds.clear();
  store.set('read', []);
  renderList();
  toast('既読履歴をリセットしました');
});

// ダイアログの外側をタップで閉じる
$('#settings').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

// ---------- 起動 ----------

applyTheme();
$('#list').innerHTML = '<div class="skeleton"></div>'.repeat(6);
load();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
