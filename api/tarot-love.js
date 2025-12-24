// /api/tarot-love.js
// CommonJS (Vercel Node)
// 役割：form11(入力) → カード＆テーマ抽出 → cards json 読込 → form12へ writeBack（freeで出力）

const fs = require("fs");
const path = require("path");
const querystring = require("querystring");

function log(...args) { console.log(...args); }

function safeStr(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try { return String(v); } catch { return ""; }
}

function normalizeSpaces(s) {
  return safeStr(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = safeStr(obj[k]).trim();
      if (v) return v;
    }
  }
  return "";
}

function findAnyKeyValue(obj, pattern) {
  if (!obj) return "";
  for (const k of Object.keys(obj)) {
    if (pattern.test(k)) {
      const v = safeStr(obj[k]).trim();
      if (v) return v;
    }
  }
  return "";
}

function normalizeTheme(raw) {
  const s = safeStr(raw).trim().toLowerCase();
  if (["love", "work", "money", "health"].includes(s)) return s;
  if (s.includes("love") || s.includes("恋愛")) return "love";
  if (s.includes("work") || s.includes("仕事")) return "work";
  if (s.includes("money") || s.includes("金運") || s.includes("金")) return "money";
  if (s.includes("health") || s.includes("健康")) return "health";
  return "";
}

function extractCardId(pasted) {
  const text = normalizeSpaces(pasted);

  const m =
    text.match(/card_id\s*[:=]\s*([a-z0-9_]+)\b/i) ||
    text.match(/cardId\s*[:=]\s*([a-z0-9_]+)\b/i);
  if (m && m[1]) return m[1].trim();

  const m2 = text.match(/\b(major_\d{1,2}|cups_\d{1,2}|wands_\d{1,2}|swords_\d{1,2}|pentacles_\d{1,2})\b/i);
  if (m2 && m2[1]) return m2[1].trim();

  return "";
}

function cardPathFor(cardId) {
  // major は common/major, それ以外は common/minor
  const isMajor = /^major_\d{1,2}$/i.test(cardId);
  const base = path.join(process.cwd(), "cards", "common", isMajor ? "major" : "minor");
  return path.join(base, `${cardId}.json`);
}

function themePathFor(theme) {
  const base = path.join(process.cwd(), "cards", "theme");
  return path.join(base, `${theme}.json`);
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { __error: true, __errorMessage: e && e.message ? e.message : String(e), __path: filePath };
  }
}

/**
 * ProLine free系が短めで切れがちなので分割
 * 今の実測だと 160 くらいが安全
 */
function splitForFreeFields(longText) {
  const LIMIT = 160;
  const s = normalizeSpaces(longText);
  if (!s) return { p1: "", p2: "", p3: "", p4: "" };

  const parts = [];
  let cur = s;

  while (cur.length > LIMIT && parts.length < 3) {
    const cutAt = cur.lastIndexOf("\n", LIMIT);
    const idx = cutAt > 80 ? cutAt : LIMIT;
    parts.push(cur.slice(0, idx).trim());
    cur = cur.slice(idx).trim();
  }
  parts.push(cur.trim());

  return {
    p1: parts[0] || "",
    p2: parts[1] || "",
    p3: parts[2] || "",
    p4: parts[3] || "",
  };
}

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

// ✅上書き用（空でも必ず上書きする）
const ZWSP = "\u200b";
const safe = (v) => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : ZWSP;
};

// ✅form12 writeBack 先（固定）
const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

/**
 * ProLine POST（x-www-form-urlencoded）
 */
async function postForm(url, data) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data || {})) {
    params.set(k, v == null ? "" : String(v));
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text };
}

/**
 * money.json 側のキー揺れ吸収：
 * - wands_02 / wands_2
 * - major_05 / major_5
 * - 大文字/小文字
 */
function altCardIds(cardId) {
  const id = safeStr(cardId).toLowerCase().trim();
  const m = id.match(/^(major|cups|wands|swords|pentacles)_(\d{1,2})$/);
  if (!m) return [id];

  const prefix = m[1];
  const n = m[2];
  const two = String(parseInt(n, 10)).padStart(2, "0"); // 02
  const one = String(parseInt(n, 10));                  // 2

  // 可能性順に並べる
  return [`${prefix}_${two}`, `${prefix}_${one}`, id];
}

function altCardIds(cardId) {
  const id = (cardId || "").toLowerCase().trim();
  const m = id.match(/^(major|cups|wands|swords|pentacles)_(\d{1,2})$/);
  if (!m) return [id];

  const prefix = m[1];
  const n = parseInt(m[2], 10);
  const two = String(n).padStart(2, "0");
  const one = String(n);

  // 重複を除いた順序付き配列
  return Array.from(new Set([`${prefix}_${two}`, `${prefix}_${one}`, id]));
}

// ✅ money.json の「構造違い」を全部吸収する
function getThemeAddon(themeJson, cardId) {
  if (!themeJson || themeJson.__error) return "";

  // ① append型（今あなたの money.json はこれ）
  if (typeof themeJson.append === "string" && themeJson.append.trim()) {
    return themeJson.append.trim();
  }

  const ids = altCardIds(cardId);

  // ② cards: { cups_06: "...", ... } 型
  if (themeJson.cards && typeof themeJson.cards === "object") {
    for (const k of ids) {
      const v = themeJson.cards[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }

  // ③ 直下が { cups_06: "...", ... } 型
  if (typeof themeJson === "object") {
    for (const k of ids) {
      const v = themeJson[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }

  return "";
}

/**
 * themeJson の構造違いも吸収して addon を拾う
 * - 直下に { "cups_06": "..." }
 * - ネストに { "cards": { "cups_06": "..." } }
 * - ネストに { "minor": {...}, "major": {...} } 等
 */
function getThemeAddon(themeJson, cardId) {
  if (!themeJson || themeJson.__error) return "";

  const ids = altCardIds(cardId);

  // 1) 直下
  for (const k of ids) {
    const v = safeStr(themeJson[k]).trim();
    if (v) return v;
  }

  // 2) cards ネスト
  if (themeJson.cards && typeof themeJson.cards === "object") {
    for (const k of ids) {
      const v = safeStr(themeJson.cards[k]).trim();
      if (v) return v;
    }
  }

  // 3) major/minor ネスト（念のため）
  for (const bucket of ["major", "minor", "data", "list"]) {
    if (themeJson[bucket] && typeof themeJson[bucket] === "object") {
      for (const k of ids) {
        const v = safeStr(themeJson[bucket][k]).trim();
        if (v) return v;
      }
    }
  }

  return "";
}

function themeLabel(theme) {
  switch (theme) {
    case "love": return "恋愛";
    case "work": return "仕事";
    case "money": return "金運";
    case "health": return "健康";
    default: return theme;
  }
}

module.exports = async (req, res) => {
  const started = Date.now();

  try {
    if (req.method !== "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, message: "POST only" }));
      return;
    }

    const rawBody = await readBody(req);
    const body = querystring.parse(rawBody);

    // uid
    const uid =
      pickFirst(body, ["uid", "user_id", "userid"]) ||
      findAnyKeyValue(body, /^form_data\[uid\]$/i);

    // form11-1（カード貼り付け）
    const pasted =
      pickFirst(body, ["form11-1", "form_data[form11-1]"]) ||
      findAnyKeyValue(body, /form11-1/i) ||
      pickFirst(body, ["pasted", "text", "message"]);

    const cardId = extractCardId(pasted);

    // form11-5（テーマ）
    const themeRaw =
      pickFirst(body, ["theme", "form11-5", "form_data[form11-5]"]) ||
      findAnyKeyValue(body, /form11-5/i) ||
      findAnyKeyValue(body, /theme/i);

    const theme = normalizeTheme(themeRaw) || "love";

    log(`[tarot-love] uid: ${uid || ""}`);
    log(`[tarot-love] themeRaw: ${safeStr(themeRaw)}`);
    log(`[tarot-love] theme: ${theme}`);
    log(`[tarot-love] pasted head: ${normalizeSpaces(pasted).slice(0, 120).replace(/\n/g, "\\n")}`);
    log(`[tarot-love] cardId: ${cardId}`);

    if (!uid || !cardId) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({
        ok: false,
        message: "missing uid or card_id",
        uid: uid || "",
        theme,
        cardId: cardId || ""
      }));
      return;
    }

    // JSON 読込
    const commonPath = cardPathFor(cardId);
    const themePath = themePathFor(theme);

    const commonJson = readJson(commonPath);
    const themeJson = readJson(themePath);

    log(`[tarot-love] commonFrom: ${commonPath}`);
    log(`[tarot-love] themeFrom: ${themePath}`);
    log(`[tarot-love] addon: ${themeJson && !themeJson.__error ? "yes" : "no"}`);

    // 短文/長文生成
    const commonLine = (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    let longBase = "";
    if (safeStr(commonLine.long).trim()) longBase = safeStr(commonLine.long).trim();
    else if (safeStr(commonLine.full).trim()) longBase = safeStr(commonLine.full).trim();
    else if (commonJson && !commonJson.__error) {
      const lines = [];
      lines.push(`🌿 今日の整えワンポイント（詳細）`);
      lines.push(``);
      lines.push(`【カード】 ${safeStr(commonJson.title)}`);
      if (safeStr(commonJson.message).trim()) lines.push(safeStr(commonJson.message).trim());
      lines.push(``);
      if (safeStr(commonJson.focus).trim()) {
        lines.push(`【意識すること】`);
        lines.push(safeStr(commonJson.focus).trim());
        lines.push(``);
      }
      if (safeStr(commonJson.action).trim()) {
        lines.push(`【今日の一手】`);
        lines.push(safeStr(commonJson.action).trim());
      }
      longBase = lines.join("\n").trim();
    }

   // ✅ テーマ addon（構造違いを吸収）
const idsTried = altCardIds(cardId);
const themeAddon = getThemeAddon(themeJson, cardId);

// --- デバッグログ（必要十分） ---
log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
log(`[tarot-love] themeAddon len: ${themeAddon.length}`);

// addon が空のときだけ、中身の構造を確認
if (!themeAddon && themeJson && !themeJson.__error && typeof themeJson === "object") {
  const keys = Object.keys(themeJson);
  log(`[tarot-love] themeJson keys sample: ${keys.slice(0, 20).join(",")}`);

  if (themeJson.cards && typeof themeJson.cards === "object") {
    const cardKeys = Object.keys(themeJson.cards);
    log(`[tarot-love] themeJson.cards keys sample: ${cardKeys.slice(0, 20).join(",")}`);
  }
}

// --- 本文合成 ---
let longText = longBase;
if (themeAddon) {
  longText = `${longBase}\n\n【${themeLabel(theme)}の視点】\n${themeAddon}`.trim();
}
    

    // ✅最後の1行（売り込み感なし）
    longText = `${longText}\n\n🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`.trim();

    const { p1, p2, p3, p4 } = splitForFreeFields(longText);

    log(`[tarot-love] len free6(short): ${shortText.length}`);
    log(`[tarot-love] len free5(long1): ${p1.length}`);
    log(`[tarot-love] len free1(long2): ${p2.length}`);
    log(`[tarot-love] len free3(long3): ${p3.length}`);
    log(`[tarot-love] len free4(long4): ${p4.length}`);

    // ✅writeBack（混入防止：free2 は毎回上書き）
    const payload = {
      uid,
      free6: safe(shortText),
      free5: safe(p1),
      free1: safe(p2),
      free3: safe(p3),
      free4: safe(p4),
      free2: ZWSP,
    };

    const wb = await postForm(WRITEBACK_URL, payload);
    log(`[tarot-love] writeBack POST: ${WRITEBACK_URL}`);
    log(`[tarot-love] writeBack status: ${wb.status}`);

    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      uid,
      theme,
      cardId,
      writeBack: { ok: wb.ok, status: wb.status },
      ms: Date.now() - started,
    }));
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    // ProLine 保護で 200
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  }
};
