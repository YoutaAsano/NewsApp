// ニュースの取得元・分類・フィルタ設定。
// フィードを追加/削除したい場合はこのファイルだけを編集すればよい。

export const CATEGORIES = [
  { id: 'markets', label: '経済・マーケット' },
  { id: 'world', label: '世界情勢' },
  { id: 'tech', label: 'テクノロジー' },
  { id: 'crypto', label: '暗号資産' },
];

const gnews = (topic) =>
  `https://news.google.com/rss/headlines/section/topic/${topic}?hl=ja&gl=JP&ceid=JP:ja`;

export const FEEDS = [
  // 経済・マーケット
  { name: 'NHK 経済', url: 'https://www3.nhk.or.jp/rss/news/cat5.xml', category: 'markets', lang: 'ja' },
  { name: 'Google ニュース ビジネス', url: gnews('BUSINESS'), category: 'markets', lang: 'ja', aggregator: true },
  { name: '東洋経済オンライン', url: 'https://toyokeizai.net/list/feed/rss', category: 'markets', lang: 'ja' },
  { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', category: 'markets', lang: 'en' },
  { name: 'CNBC Economy', url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', category: 'markets', lang: 'en' },
  { name: 'BBC Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', category: 'markets', lang: 'en' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', category: 'markets', lang: 'en' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex', category: 'markets', lang: 'en' },

  // 世界情勢
  { name: 'NHK 国際', url: 'https://www3.nhk.or.jp/rss/news/cat6.xml', category: 'world', lang: 'ja' },
  { name: 'Google ニュース 国際', url: gnews('WORLD'), category: 'world', lang: 'ja', aggregator: true },
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', category: 'world', lang: 'en' },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: 'world', lang: 'en' },

  // テクノロジー
  { name: 'Google ニュース テクノロジー', url: gnews('TECHNOLOGY'), category: 'tech', lang: 'ja', aggregator: true },
  { name: 'ITmedia NEWS', url: 'https://rss.itmedia.co.jp/rss/2.0/news_bursts.xml', category: 'tech', lang: 'ja' },
  { name: 'Publickey', url: 'https://www.publickey1.jp/atom.xml', category: 'tech', lang: 'ja' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', category: 'tech', lang: 'en' },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', category: 'tech', lang: 'en' },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', category: 'tech', lang: 'en' },

  // 暗号資産
  { name: 'CoinPost', url: 'https://coinpost.jp/?feed=rss2', category: 'crypto', lang: 'ja' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', category: 'crypto', lang: 'en' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', category: 'crypto', lang: 'en' },
];

// 資産形成に関係の薄い記事を除外するキーワード（タイトルに含まれていたら除外）。
export const EXCLUDE_KEYWORDS = [
  // スポーツ
  'スポーツ', '野球', 'サッカー', 'ゴルフ', '相撲', '五輪', 'オリンピック', 'W杯', 'ワールドカップ', '大谷',
  'Jリーグ', 'プロ野球', '甲子園', '箱根駅伝', 'テニス', 'ラグビー', 'フィギュア',
  'NFL', 'NBA', 'MLB', 'NHL', 'Premier League', 'World Cup', 'Olympic', 'football', 'soccer', 'cricket',
  // 芸能・エンタメ
  '芸能', 'アイドル', '俳優', '女優', 'ドラマ', '映画祭', 'グラミー', 'アカデミー賞', '熱愛', '結婚発表',
  'celebrity', 'Grammy', 'Oscars', 'Kardashian',
  // 事件・ゴシップ・生活
  '殺人', '不倫', '占い', '星座', 'レシピ', '天気予報', 'horoscope', 'recipe',
  // 製品レビュー・セール情報（テック系フィードに多い）
  'セール', 'クーポン', 'deal of the day', 'Best deals', 'deals on', 'discount code', 'gift guide',
];

// 記事に付与するトピックタグ。タイトル・要約にキーワードが含まれていたら付与する。
export const TOPICS = [
  { id: 'rates', label: '金利・中銀', keywords: ['金利', '利上げ', '利下げ', '日銀', '日本銀行', 'FRB', 'FOMC', 'ECB', '中央銀行', '国債', '利回り', 'Fed', 'Federal Reserve', 'interest rate', 'rate cut', 'rate hike', 'Treasury yield', 'Powell', '植田'] },
  { id: 'fx', label: '為替', keywords: ['為替', '円安', '円高', 'ドル円', '介入', 'ユーロ', 'yen', 'dollar', 'currency', 'forex'] },
  { id: 'stocks', label: '株式', keywords: ['株価', '株式', '日経平均', 'TOPIX', 'ダウ', 'ナスダック', 'S&P', '上場', 'IPO', '新NISA', 'NISA', 'stock', 'shares', 'Nasdaq', 'Dow', 'S&P 500', 'Wall Street', 'equities'] },
  { id: 'earnings', label: '決算・企業', keywords: ['決算', '業績', '増益', '減益', '最高益', '上方修正', '下方修正', '買収', '合併', 'M&A', 'TOB', '配当', '自社株買い', 'earnings', 'revenue', 'profit', 'quarterly', 'acquisition', 'merger', 'dividend', 'buyback'] },
  { id: 'macro', label: '景気・物価', keywords: ['GDP', 'CPI', '物価', 'インフレ', 'デフレ', '景気', '雇用統計', '失業率', '賃金', '賃上げ', '消費', 'inflation', 'recession', 'jobs report', 'unemployment', 'payrolls', 'wages', 'economy'] },
  { id: 'policy', label: '政策・税制', keywords: ['関税', '税制', '増税', '減税', '予算', '財政', '規制', '補助金', '経済対策', 'tariff', 'tax', 'budget', 'regulation', 'stimulus', 'sanction', '制裁'] },
  { id: 'geo', label: '地政学', keywords: ['戦争', '紛争', '停戦', '攻撃', 'ミサイル', '軍事', '選挙', '首脳会談', '外交', 'ウクライナ', 'ロシア', '中東', 'イスラエル', 'イラン', '台湾', '北朝鮮', 'war', 'ceasefire', 'missile', 'military', 'election', 'summit', 'Ukraine', 'Russia', 'Israel', 'Iran', 'Taiwan', 'NATO'] },
  { id: 'energy', label: 'エネルギー・資源', keywords: ['原油', '石油', 'OPEC', '天然ガス', 'LNG', '電力', '金価格', '金相場', '銅', 'レアアース', 'oil', 'crude', 'Brent', 'natural gas', 'gold price', 'copper', 'commodity', 'commodities'] },
  { id: 'ai', label: 'AI', keywords: ['AI', '人工知能', '生成AI', 'ChatGPT', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'LLM', 'machine learning'] },
  { id: 'semi', label: '半導体', keywords: ['半導体', 'TSMC', 'NVIDIA', 'エヌビディア', 'ラピダス', 'Rapidus', 'インテル', 'Intel', 'AMD', 'ASML', 'chip', 'chips', 'chipmaker', 'semiconductor'] },
  { id: 'realestate', label: '不動産', keywords: ['不動産', '地価', '住宅', 'マンション', 'REIT', 'real estate', 'housing', 'mortgage'] },
  { id: 'crypto', label: '暗号資産', keywords: ['暗号資産', '仮想通貨', 'ビットコイン', 'イーサリアム', 'ステーブルコイン', 'Bitcoin', 'BTC', 'Ethereum', 'ETH', 'crypto', 'stablecoin', 'blockchain', 'ブロックチェーン'] },
];

// マーケット指標（Yahoo Finance のチャート API から取得）。
export const MARKETS = [
  { symbol: '^N225', label: '日経平均' },
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^IXIC', label: 'NASDAQ' },
  { symbol: '^DJI', label: 'NYダウ' },
  { symbol: 'JPY=X', label: 'ドル円' },
  { symbol: '^TNX', label: '米10年債利回り' },
  { symbol: 'GC=F', label: '金先物' },
  { symbol: 'CL=F', label: 'WTI原油' },
  { symbol: 'BTC-USD', label: 'ビットコイン' },
];

export const LIMITS = {
  perFeed: 40, // 1フィードから取り込む最大件数
  maxAgeHours: 72, // これより古い記事は捨てる
  maxItems: 800, // news.json に保存する最大件数
  summaryLength: 180, // 要約の最大文字数
  fetchTimeoutMs: 15000,
};
