/**
 * AP SafeCache marketing LP — Express + EJS + gettext (.po)
 *
 * 環境変数の読み方（先に存在したファイルだけを1つ読む）:
 * 1. CSCART_AP_SAFECACHE_ENV … 本番などで絶対パスを指定する場合
 * 2. ../common/cscart-ap-safecache.env … andplus-apps 配下の共通置き場（推奨）
 * 3. このディレクトリの .env … フォールバック
 * いずれも無ければ OS / ホスト注入の環境変数のみ。
 *
 * BASE_PATH … nginx でサブパス公開するとき（例: /cscart/safecache）。先頭の / あり、末尾 / なし。
 * HTML 内の CSS/JS の URL と言語切替リンクに使う。未設定はルート配信想定。
 */
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");

(function loadEnvFile() {
  const candidates = [];
  const explicit = process.env.CSCART_AP_SAFECACHE_ENV;
  if (explicit && String(explicit).trim()) {
    candidates.push(path.resolve(String(explicit).trim()));
  }
  candidates.push(path.join(__dirname, "..", "common", "cscart-ap-safecache.env"));
  candidates.push(path.join(__dirname, ".env"));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      if (process.env.NODE_ENV !== "production") {
        console.log(`[env] loaded ${p}`);
      }
      return;
    }
  }
})();
const express = require("express");
const cookieParser = require("cookie-parser");
const gettextParser = require("gettext-parser");
const { getEarlyAccessState } = require("./lib/freemiusEaCoupon");

const PORT = process.env.PORT || 3000;

/** ブラウザが見る URL プレフィックス（サブパス配信用）。例: /cscart/safecache */
function normalizePublicBasePath() {
  const b = (process.env.BASE_PATH || "").trim();
  if (!b) return "";
  return b.replace(/\/+$/, "");
}
const PUBLIC_BASE_PATH = normalizePublicBasePath();
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

  if (q !== undefined && q !== "" && (q === "en" || q === "ja")) {
    const cookiePath = PUBLIC_BASE_PATH ? `${PUBLIC_BASE_PATH}/` : "/";
    res.cookie(LANG_COOKIE, lang, {
      maxAge: LANG_COOKIE_MAX_AGE_MS,
      sameSite: "lax",
      path: cookiePath,
    });
  }

  res.locals.lang = lang;
  res.locals.__ = (key) => translate(lang, key, catalogs);
  res.locals.basePath = PUBLIC_BASE_PATH;

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
        ? `${PUBLIC_BASE_PATH}/`
        : `${PUBLIC_BASE_PATH}${req.path.startsWith("/") ? req.path : `/${req.path}`}`;
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
