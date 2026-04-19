/**
 * AP SafeCache marketing LP — Express + EJS + gettext (.po)
 *
 * 環境変数の読み方:
 * 1) CSCART_AP_SAFECACHE_ENV、2) ../common/cscart-ap-safecache_lp.env、3) ../common/cscart-ap-safecache.env
 *    のうち最初に存在するファイルを1つ読む（clone 単体では common が無いことがある）。
 * 4) このディレクトリの .env があれば必ず読み、さらに上書き（override）。
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
 * AP_SAFECACHE_OG_IMAGE … og:image。完全 URL、または basePath 付きのパス（例: /img/safecache-og.png）。未設定時は img/safecache-og.png。
 *
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_FREE … LP の Free プラン CTA 先（既定: plan 46092）
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_SINGLE … Pro スタンダード（既定: plan 46093 + trial=paid）
 * AP_SAFECACHE_FREEMIUS_CHECKOUT_PRO_MV … Pro モール版（既定: plan 46134 + trial=paid）
 *
 * JSON-LD の Organization はコーポレートサイト https://www.andplus.co.jp/ を正本（@id / url）として参照する。
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

/** 株式会社アンドプラス公式サイト（JSON-LD Organization の正本 URL） */
const ANDPLUS_CORPORATE_ORIGIN = "https://www.andplus.co.jp";

(function loadEnvFile() {
  const chain = [];
  const explicit = process.env.CSCART_AP_SAFECACHE_ENV;
  if (explicit && String(explicit).trim()) {
    chain.push(path.resolve(String(explicit).trim()));
  }
  chain.push(path.join(__dirname, "..", "common", "cscart-ap-safecache_lp.env"));
  chain.push(path.join(__dirname, "..", "common", "cscart-ap-safecache.env"));

  let loaded = false;
  for (const p of chain) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p, override: true });
      loaded = true;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[env] loaded ${p}`);
      }
      break;
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

/** env の BASE_PATH（モジュール読み込み時点） */
const PUBLIC_BASE_PATH = normalizePathPrefix(process.env.BASE_PATH || "");

/** AP_SAFECACHE_OG_IMAGE 未設定時（`cscart/img` を /img で配信） */
const DEFAULT_OG_IMAGE_REL_PATH = "/img/safecache-og.png";

/**
 * リクエストごとの公開パスプレフィックス。
 * 1) nginx の X-Forwarded-Prefix（推奨・共通 env に BASE_PATH が無くても動く）
 * 2) BASE_PATH 環境変数
 */
function resolvePublicBasePath(req) {
  const rawHeader =
    req.get("X-Forwarded-Prefix") || req.headers["x-forwarded-prefix"] || "";
  if (String(rawHeader).trim() !== "") {
    return normalizePathPrefix(rawHeader);
  }
  return PUBLIC_BASE_PATH;
}

/** OGP・canonical 用。未設定時は trust proxy 前提で req から。 */
function getPublicOrigin(req) {
  const fromEnv = process.env.AP_SAFECACHE_PUBLIC_ORIGIN;
  if (fromEnv && String(fromEnv).trim()) {
    return String(fromEnv).trim().replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
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

function resolveOgImageUrl(req, basePath) {
  const envRaw = process.env.AP_SAFECACHE_OG_IMAGE;
  const s =
    envRaw && String(envRaw).trim()
      ? String(envRaw).trim()
      : DEFAULT_OG_IMAGE_REL_PATH;
  if (/^https?:\/\//i.test(s)) return s;
  const origin = getPublicOrigin(req);
  const prefix = basePath || "";
  const p = s.startsWith("/") ? s : `/${s}`;
  return `${origin}${prefix}${p}`;
}

/**
 * EJS の <script type="application/ld+json"> 等用。JSON を 2 スペースでネストし、行頭にパディングする。
 */
function formatJsonForHtml(obj, linePadSpaces) {
  const pad = " ".repeat(linePadSpaces);
  return JSON.stringify(obj, null, 2).replace(/^/gm, pad);
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
  const ogImg = resolveOgImageUrl(req, basePath);

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
/** LP 用画像（例: img/safecache300.png）→ /img/... で配信 */
app.use("/img", express.static(path.join(__dirname, "img")));
app.use(express.static(path.join(__dirname, "public")));

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
  res.locals.ogImageUrl = resolveOgImageUrl(req, basePath);
  res.locals.jsonLd = buildJsonLdGraph(req, basePath, lang, catalogs, canonicalUrl);
  res.locals.prettyJson = (obj, linePadSpaces = 6) =>
    formatJsonForHtml(obj, linePadSpaces);
  res.locals.freemiusCheckoutUrls = getFreemiusCheckoutUrls();

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
    const pathPart =
      req.path === "/"
        ? `${basePath}/`
        : `${basePath}${req.path.startsWith("/") ? req.path : `/${req.path}`}`;
    return q ? `${pathPart}?${q}` : `${pathPart}?lang=${targetLang}`;
  };

  next();
});

app.get("/", async (req, res, next) => {
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
    res.render("index");
  } catch (err) {
    next(err);
  }
});

const server = app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
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
