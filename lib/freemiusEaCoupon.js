/**
 * Freemius REST API — Early Access クーポン（ID 取得 or 一覧から自動選択 + メモリキャッシュ）
 * クーポンコード文字列は API レスポンスの `code` を使い、.env に書かなくてよい。
 * @see https://docs.freemius.com/api/coupons
 */
"use strict";

const https = require("https");

const API_BASE = "https://api.freemius.com/v1";

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<object>}
 */
function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "GET",
      headers: { Accept: "application/json", ...headers },
    };
    const req = https.request(opts, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        buf += c;
      });
      res.on("end", () => {
        let parsed;
        try {
          parsed = buf ? JSON.parse(buf) : {};
        } catch {
          reject(new Error("Freemius: response is not JSON"));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const msg =
            (parsed && (parsed.error || parsed.message)) || buf.slice(0, 240);
          reject(
            new Error(`Freemius HTTP ${res.statusCode}: ${String(msg)}`)
          );
          return;
        }
        resolve(parsed);
      });
    });
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Freemius: request timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

/** @param {string|undefined} s */
function parseFsDate(s) {
  if (!s || typeof s !== "string") return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * is_active と Effective date range（start_date / end_date）のみ。
 * バナー表示の可否に使う。
 * @param {object} c — Freemius coupon object
 * @param {Date} [now]
 */
function isCouponActiveInEffectiveRange(c, now = new Date()) {
  if (!c) return false;
  const active = c.is_active;
  if (active === false || active === 0) return false;

  const start = parseFsDate(c.start_date);
  if (start && now < start) return false;

  const end = parseFsDate(c.end_date);
  if (end && now > end) return false;

  return true;
}

/**
 * チェックアウト相当の緩い可否（期間に加え利用上限）。
 * @param {object} c — Freemius coupon object
 * @param {Date} [now]
 */
function isCouponLooselyUsable(c, now = new Date()) {
  if (!isCouponActiveInEffectiveRange(c, now)) return false;

  const limit = c.redemptions_limit;
  const used = Number(c.redemptions) || 0;
  if (typeof limit === "number" && limit > 0 && used >= limit) {
    return false;
  }

  return true;
}

/** 単体 GET の生 JSON をクーポンオブジェクトに正規化 */
function unwrapCouponPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.coupon && typeof raw.coupon === "object") {
    return raw.coupon;
  }
  return raw;
}

/** 一覧・単体どちらでも API のクーポンコードを取り出す */
function couponCodeFromObject(c) {
  if (!c || typeof c !== "object") return "";
  const inner = c.coupon && typeof c.coupon === "object" ? c.coupon : c;
  const raw = inner.code ?? inner.coupon_code;
  return String(raw ?? "").trim();
}

/**
 * @param {object[]} list
 * @returns {object|undefined}
 */
function pickFirstEligibleFromList(list) {
  if (!Array.isArray(list)) return undefined;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || !couponCodeFromObject(c)) continue;
    if (isCouponActiveInEffectiveRange(c)) {
      return c;
    }
  }
  return undefined;
}

/**
 * 一覧に code が載らない（非 enriched）とき、先頭の候補を ID で GET して code を得る
 * @param {Record<string, string>} auth
 * @param {string} productId
 * @param {object[]} list
 */
async function pickFirstViaSingleFetchIfNoCode(auth, productId, list) {
  if (!Array.isArray(list)) return undefined;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || !isCouponActiveInEffectiveRange(c)) continue;
    if (couponCodeFromObject(c)) {
      return c;
    }
    const id = c.id != null ? String(c.id) : "";
    if (!id) continue;
    try {
      const oneUrl = `${API_BASE}/products/${encodeURIComponent(
        productId
      )}/coupons/${encodeURIComponent(id)}.json`;
      const rawOne = await fetchJson(oneUrl, auth);
      const one = unwrapCouponPayload(rawOne) || rawOne;
      if (
        one &&
        couponCodeFromObject(one) &&
        isCouponActiveInEffectiveRange(one)
      ) {
        return one;
      }
    } catch {
      /* 次の行へ */
    }
  }
  return undefined;
}

/** API 一覧の配列をいろいろな形から取り出す */
function couponsArrayFromListPayload(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.coupons)) return data.coupons;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * 一覧は code クエリを付けない（Freemius 側で 0 件になることがあるため）。
 */
async function fetchCouponListPayload(auth, productId) {
  const build = (withEnriched) => {
    const u = new URL(
      `${API_BASE}/products/${encodeURIComponent(productId)}/coupons.json`
    );
    u.searchParams.set("count", "100");
    if (withEnriched) {
      u.searchParams.set("is_enriched", "true");
    }
    return u.toString();
  };

  try {
    return await fetchJson(build(true), auth);
  } catch (firstErr) {
    const msg = String(firstErr.message || firstErr);
    if (msg.includes(" 400 ") || msg.includes("HTTP 400")) {
      return await fetchJson(build(false), auth);
    }
    throw firstErr;
  }
}

let cache = {
  /** @type {number} */
  expiresAt: 0,
  /** @type {{ showBanner: boolean, code: string, source: string } | null} */
  value: null,
};

let warnedMissingApiCredentials = false;

/**
 * @param {object} opts
 * @param {string} [opts.token] — FREEMIUS_API_TOKEN
 * @param {string} [opts.productId] — FREEMIUS_PRODUCT_ID
 * @param {string} [opts.couponId] — FREEMIUS_EA_COUPON_ID（最優先で 1 件 GET）
 * @param {string} [opts.fallbackCode] — AP_SAFECACHE_EA_COUPON: API 未使用時・API 失敗時のみ
 * @param {number} [opts.cacheSec]
 */
async function getEarlyAccessState(opts) {
  const fallbackCode = (opts.fallbackCode || "").trim();
  const couponId = (opts.couponId || "").trim();
  const token = (opts.token || "").trim();
  const productId = (opts.productId || "").trim();
  const cacheSec = Math.max(
    10,
    Math.min(Number(opts.cacheSec) || 90, 3600)
  );
  const ttlMsFor = (showBanner) => {
    if (showBanner) {
      return Math.min(cacheSec, 40) * 1000;
    }
    return Math.min(cacheSec, 300) * 1000;
  };

  if (!token || !productId) {
    if (!warnedMissingApiCredentials) {
      warnedMissingApiCredentials = true;
      console.warn(
        "[freemius-ea] FREEMIUS_API_TOKEN / FREEMIUS_PRODUCT_ID 未設定。バナーは AP_SAFECACHE_EA_COUPON があるときのみ表示します（本番は API 推奨）。"
      );
    }
    return {
      showBanner: !!fallbackCode,
      code: fallbackCode,
      source: "env",
    };
  }

  const now = Date.now();
  if (cache.value && now < cache.expiresAt) {
    return cache.value;
  }

  const auth = { Authorization: `Bearer ${token}` };

  try {
    let match;
    /** @type {number|null} */
    let listCount = null;

    if (couponId) {
      const oneUrl = `${API_BASE}/products/${encodeURIComponent(
        productId
      )}/coupons/${encodeURIComponent(couponId)}.json`;
      const rawOne = await fetchJson(oneUrl, auth);
      match = unwrapCouponPayload(rawOne) || rawOne;
    } else {
      const data = await fetchCouponListPayload(auth, productId);
      const list = couponsArrayFromListPayload(data);
      listCount = list.length;

      match = pickFirstEligibleFromList(list);
      if (!match) {
        match = await pickFirstViaSingleFetchIfNoCode(
          auth,
          productId,
          list
        );
      }
    }

    if (!match) {
      console.warn(
        "[freemius-ea] クーポン未決定 productId=%s couponId=%s listCount=%s",
        productId,
        couponId || "(なし)",
        listCount != null ? String(listCount) : "n/a"
      );
      const out = {
        showBanner: false,
        code: "",
        source: "api-missing",
      };
      cache = { expiresAt: now + ttlMsFor(false), value: out };
      return out;
    }

    const codeStr = couponCodeFromObject(match);
    const inRange = isCouponActiveInEffectiveRange(match);
    const okBanner = !!codeStr && inRange;
    const okStrict = isCouponLooselyUsable(match) && !!codeStr;
    const out = {
      showBanner: okBanner,
      code: codeStr,
      source: okBanner
        ? okStrict
          ? "api"
          : "api-limited"
        : inRange
          ? "api-inactive"
          : "api-out-of-range",
    };
    cache = { expiresAt: now + ttlMsFor(out.showBanner), value: out };
    return out;
  } catch (err) {
    console.warn("[freemius-ea]", err.message || err);
    const out = {
      showBanner: !!fallbackCode,
      code: fallbackCode,
      source: "fallback",
    };
    cache = { expiresAt: now + Math.min(60, cacheSec) * 1000, value: out };
    return out;
  }
}

module.exports = {
  getEarlyAccessState,
  isCouponLooselyUsable,
  isCouponActiveInEffectiveRange,
};
