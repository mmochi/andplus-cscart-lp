/**
 * AP SafeCache marketing LP — Express + EJS + gettext (.po)
 *
 * 環境変数の読み方:
 * 1) CSCART_AP_SAFECACHE_ENV（単体）
 * 2) それ以外は ../common/cscart-ap-safecache.env → cscart-ap-safecache_lp.env の順に存在するものだけ読み、
 *    後から読んだキーが上書き（LP 用で PORT/BASE_PATH だけ共通 env に置く構成でもよい）
 * 4) このディレクトリの .env があれば必ず読み、さらに上書き（override: true）。
 * dotenv は既定で process.env を上書きしない。systemd が空の BASE_PATH 等を先に渡すと
 * ファイルの値が効かないため、共通 env / local .env はどちらも override: true で読む。
 *
 * BASE_PATH … nginx でサブパス公開するとき（例: /cscart/safecache）。先頭の / あり、末尾 / なし。
 * HTML 内の CSS/JS の URL と言語切替リンクに使う。未設定はルート配信想定。
 *
 * 本番では nginx に proxy_set_header X-Forwarded-Prefix /cscart/safecache; を付けると、
 * 共通 env に BASE_PATH が無くてもサブパスが効く（ヘッダ優先）。
 *
 * AP_SAFECACHE_PUBLIC_ORIGIN … OGP・canonical 用のオリジン（例: https://apps.andplus.tech）。未設定時はリクエストから。
 * AP_SAFECACHE_OG_IMAGE_JA / AP_SAFECACHE_OG_IMAGE_EN … 言語別 og:image（完全 URL または /img/... のパス）。
 * AP_SAFECACHE_OG_IMAGE … 任意。JA/EN どちらも未個別指定のときの共通フォールバック（1 枚だけ運用する場合）。
 *   解決順: 当該言語の AP_SAFECACHE_OG_IMAGE_JA|EN → なければ AP_SAFECACHE_OG_IMAGE → 既定 /img/safecache-og-ja.png | /img/safecache-og-en.png
 * AP_SAFECACHE_OG_IMAGE_WIDTH / HEIGHT … og:image のピクセル（任意。未設定時は既定 1200×630）
 * AP_SAFECACHE_FB_APP_ID（または FB_APP_ID）… 任意。meta fb:app_id（ページと Meta アプリを紐づけたい／シェアデバッダーが警告を出す場合など）。OGP 自体の表示には通常不要。
 *
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_FREE … LP の Free プラン CTA 先（既定: plan 46092）
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_SINGLE … Pro スタンダード（既定: plan 46093 + trial=paid）
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_MV … Pro モール版（既定: plan 46134 + trial=paid）
 *
 * JSON-LD の Organization はコーポレートサイト https://www.andplus.co.jp/ を正本（@id / url）として参照する。
 *
 * /sitemap.xml … LP トップの en / ja（buildLpAbsoluteUrl と同一）。AP_SAFECACHE_PUBLIC_ORIGIN / BASE_PATH / X-Forwarded-*。
 * /robots.txt … Allow: / と Sitemap: 同上。
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

/** 株式会社アンドプラス公式サイト（JSON-LD Organization の正本 URL） */
const ANDPLUS_CORPORATE_ORIGIN = "https://www.andplus.co.jp";

(function loadEnvFile() {
  const explicit = process.env.CSCART_AP_SAFECACHE_ENV;
  if (explicit && String(explicit).trim()) {
    const p = path.resolve(String(explicit).trim());
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: true });
      if (process.env.NODE_ENV !== "production") {
        console.log(`[env] loaded ${p} (CSCART_AP_SAFECACHE_ENV)`);
      }
    }
  } else {
    const chain = [
      path.join(__dirname, "..", "common", "cscart-ap-safecache.env"),
      path.join(__dirname, "..", "common", "cscart-ap-safecache_lp.env"),
    ];
    for (const p of chain) {
      if (fs.existsSync(p)) {
        dotenv.config({ path: p, override: true });
        if (process.env.NODE_ENV !== "production") {
          console.log(`[env] loaded ${p}`);
        }
      }
    }
  }

  const localEnv = path.join(__dirname, ".env");
  if (fs.existsSync(localEnv)) {
    dotenv.config({ path: localEnv, override: true });
    if (process.env.NODE_ENV !== "production") {
      console.log(`[env] loaded ${localEnv} (overrides)`);
    }
  }
})();
const express = require("express");
const cookieParser = require("cookie-parser");
const gettextParser = require("gettext-parser");
const { getEarlyAccessState } = require("./lib/freemiusEaCoupon");

const PORT = process.env.PORT || 3000;

/** Freemius プランのチェックアウト URL（LP の CTA から使用。AP_SAFECACHE_FREEMIUS_CHECKOUT_* で上書き可） */
function getFreemiusCheckoutUrls() {
  return {
    free:
      process.env.AP_SAFECACHE_FREEMIUS_CHECKOUT_FREE ||
      "https://checkout.freemius.com/app/27895/plan/46092/",
    proSingle:
      process.env.AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_SINGLE ||
      "https://checkout.freemius.com/app/27895/plan/46093/?trial=paid",
    proMv:
      process.env.AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_MV ||
      "https://checkout.freemius.com/app/27895/plan/46134/?trial=paid",
  };
}

/** 先頭 / を付け、末尾 / を除く。ルートのみ（"/"）はプレフィックス無しの ""（テンプレで /style.css と連結するため） */
function normalizePathPrefix(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  if (!s.startsWith("/")) s = `/${s}`;
  if (s === "/") return "";
  return s;
}

/**
 * env の BASE_PATH（起動時）。追加のプレフィックス配信用（本番 URL と異なるパスだけ置く用途）。
 * apps.andplus.tech の実パスは下の LP_URL_PREFIX で env 無しでも必ずマウントする。
 */
const ENV_BASE_PATH = normalizePathPrefix(process.env.BASE_PATH || "");

/** 公開 LP の既定 URL パス（静的・LP 別名は常にマウント。BASE_PATH 未設定でも有効） */
const LP_URL_PREFIX = normalizePathPrefix(
  process.env.AP_SAFECACHE_LP_URL_PREFIX || "/cscart/safecache"
);

/** static / 付随ルートを掛けるプレフィックス（重複除く） */
const STATIC_ROUTE_PREFIXES = Array.from(
  new Set(
    [LP_URL_PREFIX, ENV_BASE_PATH].filter(
      (p) => typeof p === "string" && p.length > 0
    )
  )
);

/** AP_SAFECACHE_OG_IMAGE_* 未設定時（`cscart/img` を /img で配信） */
const DEFAULT_OG_IMAGE_REL_PATH_JA = "/img/safecache-og-ja.png";
const DEFAULT_OG_IMAGE_REL_PATH_EN = "/img/safecache-og-en.png";

/** 既定 OG 画像の実寸（meta og:image:width / height 用） */
const DEFAULT_OG_IMAGE_WIDTH = 1200;
const DEFAULT_OG_IMAGE_HEIGHT = 630;

/**
 * ブラウザが Node に直結しているローカル（リバプロ無し）。
 * このとき env の BASE_PATH をリンクに使わない（/style.css のまま）。
 */
function isLocalDirectNodeAccess(req) {
  const h = String(req.hostname || "").toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h.endsWith(".localhost")
  );
}

/**
 * リクエストごとの公開パスプレフィックス（HTML の basePath・canonical 等）。
 * 1) nginx の X-Forwarded-Prefix（本番推奨）
 * 2) 上記が無く、かつ localhost 直結でない → 環境変数 BASE_PATH
 * 3) localhost 直結 → 常に ""（ルート）
 */
function resolvePublicBasePath(req) {
  const rawHeader =
    req.get("X-Forwarded-Prefix") || req.headers["x-forwarded-prefix"] || "";
  if (String(rawHeader).trim() !== "") {
    return normalizePathPrefix(rawHeader);
  }
  if (isLocalDirectNodeAccess(req)) {
    return "";
  }
  return ENV_BASE_PATH;
}

/**
 * リバースプロキシ経由でも公開 URL の scheme / host を取り違えないようにする。
 * nginx 例: proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Forwarded-Host $host;
 */
function getForwardedProto(req) {
  const h = req.get("x-forwarded-proto");
  if (h && String(h).trim()) {
    return String(h).split(",")[0].trim().toLowerCase();
  }
  return null;
}

function getForwardedHost(req) {
  const h = req.get("x-forwarded-host");
  if (h && String(h).trim()) {
    return String(h).split(",")[0].trim();
  }
  return null;
}

/** OGP・canonical 用。AP_SAFECACHE_PUBLIC_ORIGIN 推奨。未設定時は X-Forwarded-* または req から。 */
function getPublicOrigin(req) {
  const fromEnv = process.env.AP_SAFECACHE_PUBLIC_ORIGIN;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/+$/, "");
  }
  const proto = getForwardedProto(req) || req.protocol || "https";
  const host = getForwardedHost(req) || req.get("host") || "";
  return `${proto}://${host}`;
}

/**
 * LP トップの絶対 URL。en は ?lang なし、ja は ?lang=ja。
 */
function buildLpAbsoluteUrl(req, basePath, lang) {
  const origin = getPublicOrigin(req);
  const prefix = basePath || "";
  const pathPart = prefix ? `${prefix}/` : "/";
  const qs = new URLSearchParams();
  if (lang === "ja") qs.set("lang", "ja");
  const q = qs.toString();
  return `${origin}${pathPart}${q ? `?${q}` : ""}`;
}

function resolveOgImageUrl(req, basePath, lang) {
  const perLang =
    lang === "ja"
      ? process.env.AP_SAFECACHE_OG_IMAGE_JA
      : process.env.AP_SAFECACHE_OG_IMAGE_EN;
  const common = process.env.AP_SAFECACHE_OG_IMAGE;
  const fallbackPath =
    lang === "ja" ? DEFAULT_OG_IMAGE_REL_PATH_JA : DEFAULT_OG_IMAGE_REL_PATH_EN;

  let raw;
  if (perLang && String(perLang).trim()) {
    raw = String(perLang).trim();
  } else if (common && String(common).trim()) {
    raw = String(common).trim();
  } else {
    raw = fallbackPath;
  }

  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = getPublicOrigin(req);
  const prefix = basePath || "";
  const p = raw.startsWith("/") ? raw : `/${raw}`;
  return `${origin}${prefix}${p}`;
}

function resolveOgImageDimensions() {
  const w = process.env.AP_SAFECACHE_OG_IMAGE_WIDTH;
  const h = process.env.AP_SAFECACHE_OG_IMAGE_HEIGHT;
  return {
    width:
      w && String(w).trim() ? String(w).trim() : String(DEFAULT_OG_IMAGE_WIDTH),
    height:
      h && String(h).trim()
        ? String(h).trim()
        : String(DEFAULT_OG_IMAGE_HEIGHT),
  };
}

/**
 * EJS の <script type="application/ld+json"> 等用。JSON を 2 スペースでネストし、行頭にパディングする。
 */
function formatJsonForHtml(obj, linePadSpaces) {
  const pad = " ".repeat(linePadSpaces);
  return JSON.stringify(obj, null, 2).replace(/^/gm, pad);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 公開サイトの sitemap.xml 絶対 URL（robots / link rel 用） */
function buildSitemapFileUrl(req) {
  const origin = getPublicOrigin(req);
  const basePath = resolvePublicBasePath(req);
  return basePath === ""
    ? `${origin}/sitemap.xml`
    : `${origin}${basePath}/sitemap.xml`;
}

/** 構造化データ（JSON-LD）— Organization / WebSite / WebPage / SoftwareApplication */
function buildJsonLdGraph(req, basePath, lang, catalogs, canonicalUrl) {
  const t = (key) => translate(lang, key, catalogs);
  const origin = getPublicOrigin(req);
  const prefix = basePath || "";
  const siteUrl = prefix ? `${origin}${prefix}/` : `${origin}/`;
  const orgId = `${ANDPLUS_CORPORATE_ORIGIN}/#organization`;
  const websiteId = `${siteUrl}#website`;
  const pageId = `${canonicalUrl}#webpage`;
  const softwareId = `${canonicalUrl}#software`;
  const ogImg = resolveOgImageUrl(req, basePath, lang);

  const webPage = {
    "@type": "WebPage",
    "@id": pageId,
    url: canonicalUrl,
    name: t("page_title"),
    description: t("meta_description"),
    inLanguage: lang === "ja" ? "ja-JP" : "en-US",
    isPartOf: { "@id": websiteId },
    publisher: { "@id": orgId },
    about: { "@id": softwareId },
  };
  if (ogImg) {
    webPage.primaryImageOfPage = { "@type": "ImageObject", url: ogImg };
  }

  const software = {
    "@type": "SoftwareApplication",
    "@id": softwareId,
    name: t("brand_name"),
    description: t("meta_description"),
    applicationCategory: "BusinessApplication",
    operatingSystem: "CS-Cart",
    url: canonicalUrl,
    publisher: { "@id": orgId },
  };
  if (ogImg) software.image = ogImg;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": orgId,
        name: t("og_site_name"),
        url: `${ANDPLUS_CORPORATE_ORIGIN}/`,
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: t("og_site_name"),
        url: siteUrl,
        publisher: { "@id": orgId },
        inLanguage: ["en-US", "ja-JP"],
      },
      webPage,
      software,
    ],
  };
}
/**
 * Early Access: API 未使用・API 失敗時のみ使うフォールバック文字列（任意）。
 * 本番は FREEMIUS_API_TOKEN + FREEMIUS_PRODUCT_ID +（任意）FREEMIUS_EA_COUPON_ID で
 * クーポンコードは API の `code` から取得（lib/freemiusEaCoupon.js）。
 */
const EA_COUPON_CODE = process.env.AP_SAFECACHE_EA_COUPON || "";

/** GA4 Measurement ID。`AP_SAFECACHE_GA_MEASUREMENT_ID=""` で無効化、未設定時は既定 ID */
function resolveGaMeasurementId() {
  const raw = process.env.AP_SAFECACHE_GA_MEASUREMENT_ID;
  if (raw !== undefined) {
    return String(raw).trim();
  }
  return "G-SECDETP3W8";
}
const GA_MEASUREMENT_ID = resolveGaMeasurementId();

const LOCALES_DIR = path.join(__dirname, "locales");
/** Cookie name for persisted UI language (query ?lang= overrides). */
const LANG_COOKIE = "ap_safecache_lp_lang";
const LANG_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** Load a .po file into a flat msgid → msgstr map */
function loadPoFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const parsed = gettextParser.po.parse(buf);
  const map = Object.create(null);
  const trans = parsed.translations[""] || {};
  for (const msgid of Object.keys(trans)) {
    if (msgid === "") continue;
    const entry = trans[msgid];
    const str = entry.msgstr;
    map[msgid] = Array.isArray(str) ? str[0] : msgid;
  }
  return map;
}

/** Reload on each request so edits to `locales/*.po` apply without restarting Node. */
function loadCatalogs() {
  return {
    en: loadPoFile(path.join(LOCALES_DIR, "en.po")),
    ja: loadPoFile(path.join(LOCALES_DIR, "ja.po")),
  };
}

function translate(lang, key, catalogs) {
  const c = catalogs[lang] || catalogs.en;
  const fallback = catalogs.en[key];
  if (Object.prototype.hasOwnProperty.call(c, key)) {
    return c[key];
  }
  if (fallback !== undefined) {
    return fallback;
  }
  return key;
}

const app = express();

/** Behind nginx reverse proxy */
app.set("trust proxy", 1);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("view options", { rmWhitespace: false });

app.use(cookieParser());
const IMG_DIR = path.join(__dirname, "img");
const PUBLIC_DIR = path.join(__dirname, "public");

/**
 * 静的アセット:
 * - `/img` … `IMG_DIR`（リポジトリ直下の `img/`）のみ。`public/img` は使わない（先にマウントされるため取り違えやすい）。
 * - `STATIC_ROUTE_PREFIXES` の `/img` … プレフィックス配下の画像
 * - ルート直下の `express.static(public)` は後段に置く（先に置くと
 *   GET /cscart/safecache/style.css が public 内の不存在パスとして 404 終了し、プレフィックス static に届かない）
 */
app.use("/img", express.static(IMG_DIR));
for (const prefix of STATIC_ROUTE_PREFIXES) {
  app.use(`${prefix}/img`, express.static(IMG_DIR));
}

app.use((req, res, next) => {
  const catalogs = loadCatalogs();
  const q = req.query.lang;
  const fromCookie = req.cookies && req.cookies[LANG_COOKIE];

  let lang;
  if (q !== undefined && q !== "") {
    lang = q;
  } else if (fromCookie === "en" || fromCookie === "ja") {
    lang = fromCookie;
  } else {
    lang = "en";
  }

  if (lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  const basePath = resolvePublicBasePath(req);

  if (q !== undefined && q !== "" && (q === "en" || q === "ja")) {
    const cookiePath = basePath ? `${basePath}/` : "/";
    res.cookie(LANG_COOKIE, lang, {
      maxAge: LANG_COOKIE_MAX_AGE_MS,
      sameSite: "lax",
      path: cookiePath,
    });
  }

  res.locals.lang = lang;
  res.locals.__ = (key) => translate(lang, key, catalogs);
  res.locals.basePath = basePath;
  const canonicalUrl = buildLpAbsoluteUrl(req, basePath, lang);
  res.locals.canonicalUrl = canonicalUrl;
  res.locals.alternateUrlEn = buildLpAbsoluteUrl(req, basePath, "en");
  res.locals.alternateUrlJa = buildLpAbsoluteUrl(req, basePath, "ja");
  res.locals.ogImageUrl = resolveOgImageUrl(req, basePath, lang);
  const ogDim = resolveOgImageDimensions();
  res.locals.ogImageWidth = ogDim.width;
  res.locals.ogImageHeight = ogDim.height;
  res.locals.jsonLd = buildJsonLdGraph(req, basePath, lang, catalogs, canonicalUrl);
  res.locals.prettyJson = (obj, linePadSpaces = 6) =>
    formatJsonForHtml(obj, linePadSpaces);
  res.locals.freemiusCheckoutUrls = getFreemiusCheckoutUrls();
  res.locals.fbAppId = String(
    process.env.AP_SAFECACHE_FB_APP_ID || process.env.FB_APP_ID || ""
  ).trim();
  res.locals.gaMeasurementId = GA_MEASUREMENT_ID;
  res.locals.sitemapFileUrl = buildSitemapFileUrl(req);

  const params = new URLSearchParams();
  Object.entries(req.query).forEach(([k, v]) => {
    if (k === "lang") return;
    if (Array.isArray(v)) {
      v.forEach((x) => params.append(k, x));
    } else if (v !== undefined) {
      params.set(k, v);
    }
  });

  res.locals.langUrl = (targetLang) => {
    const p = new URLSearchParams(params.toString());
    p.set("lang", targetLang);
    const q = p.toString();
    /* LP はトップのみ。req.path に BASE_PATH が含まれると二重になるため常にトップ URL に揃える */
    const pathPart = basePath ? `${basePath}/` : "/";
    return q ? `${pathPart}?${q}` : `${pathPart}?lang=${targetLang}`;
  };

  next();
});

function sendSitemapXml(req, res) {
  const basePath = resolvePublicBasePath(req);
  const locs = [
    buildLpAbsoluteUrl(req, basePath, "en"),
    buildLpAbsoluteUrl(req, basePath, "ja"),
  ];
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs
  .map(
    (loc) => `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>`
  )
  .join("\n")}
</urlset>
`;
  res.status(200).type("application/xml; charset=utf-8").send(body);
}

function sendRobotsTxt(req, res) {
  const sm = buildSitemapFileUrl(req);
  res
    .status(200)
    .type("text/plain; charset=utf-8")
    .send(`User-agent: *
Allow: /

Sitemap: ${sm}
`);
}

async function renderIndexPage(req, res, next) {
  try {
    const cacheSec = parseInt(process.env.FREEMIUS_EA_CACHE_SEC || "90", 10);
    const state = await getEarlyAccessState({
      token: process.env.FREEMIUS_API_TOKEN,
      productId: process.env.FREEMIUS_PRODUCT_ID,
      couponId: process.env.FREEMIUS_EA_COUPON_ID,
      fallbackCode: EA_COUPON_CODE,
      cacheSec,
    });
    res.locals.showEarlyAccessBanner = state.showBanner;
    res.locals.eaCouponCode = state.code;
    /* EJS strict / ミドルウェア順の差でも落ちないよう、描画直前に必ず渡す */
    res.locals.sitemapFileUrl = buildSitemapFileUrl(req);
    res.render("index");
  } catch (err) {
    next(err);
  }
}

app.get("/sitemap.xml", sendSitemapXml);
app.get("/robots.txt", sendRobotsTxt);
app.get("/", renderIndexPage);

for (const prefix of STATIC_ROUTE_PREFIXES) {
  app.get(`${prefix}/sitemap.xml`, sendSitemapXml);
  app.get(`${prefix}/robots.txt`, sendRobotsTxt);
  app.get(`${prefix}/`, renderIndexPage);
  app.get(prefix, (req, res) => {
    res.redirect(301, `${prefix}/`);
  });
}

/**
 * BASE_PATH 直下の静的ファイルはルートより後に置く。
 * 先に置くと GET …/ が index 無しで 404 終了し、LP の app.get に届かない。
 */
for (const prefix of STATIC_ROUTE_PREFIXES) {
  app.use(prefix, express.static(PUBLIC_DIR));
}

app.use(express.static(PUBLIC_DIR));

const server = app.listen(PORT, () => {
  const host = process.env.HOST || "localhost";
  const base = `http://${host}:${PORT}`;
  console.log(`Listening on ${base}/`);
  if (STATIC_ROUTE_PREFIXES.length) {
    console.log(
      `Static/LP aliases: ${STATIC_ROUTE_PREFIXES.map((p) => `${base}${p}/`).join(" ")}`
    );
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[EADDRINUSE] Port ${PORT} is already in use.\n` +
        `  • Use another port: PORT=3001 node app.js\n` +
        `  • Or stop the process using this port (macOS): lsof -i :${PORT}`
    );
    process.exit(1);
  }
  throw err;
});
