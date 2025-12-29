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
  return safeStr(s)
    .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    .replace(/\\n/g, "\n"); // "\n" が文字として入ってるケース対策
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

// ✅上書き用（空でも必ず上書きする）
const ZWSP = "\u200b";
const safe = (v) => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : ZWSP;
};

// ✅form12 writeBack 先（固定）
const WRITEBACK_URL = "https://l8x1uh5r.autosns.app/fm/xBi34LzVvN";

async function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

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
 * cardId の揺れ（cups_06 / cups_6 など）を吸収する
 */
function altCardIds(cardId) {
  const id = safeStr(cardId).toLowerCase().trim();
  const m = id.match(/^(major|cups|wands|swords|pentacles)_(\d{1,2})$/);
  if (!m) return [id];

  const prefix = m[1];
  const n = parseInt(m[2], 10);
  const two = String(n).padStart(2, "0"); // 06
  const one = String(n);                  // 6

  // 重複を除いた順序付き
  return Array.from(new Set([`${prefix}_${two}`, `${prefix}_${one}`, id]));
}

/**
 * themeJson の構造違いも吸収して addon を拾う
 * あなたの json は主にこれ：
 * { id, label, append: { major_00:"...", ... } }
 */
function getThemeAddon(themeJson, cardId) {
  if (!themeJson || themeJson.__error) return "";

  const ids = altCardIds(cardId);

  // ✅ 1) append が “カード別辞書” のパターン（あなたの形式）
  if (themeJson.append && typeof themeJson.append === "object") {
    const hit = ids.map(k => safeStr(themeJson.append[k]).trim()).find(Boolean);
    if (hit) return hit;
  }

  // ✅ 2) cards: { cups_06:"...", ... } パターン
  if (themeJson.cards && typeof themeJson.cards === "object") {
    const hit = ids.map(k => safeStr(themeJson.cards[k]).trim()).find(Boolean);
    if (hit) return hit;
  }

  // ✅ 3) 直下辞書：{ cups_06:"...", ... }
  const hit = ids.map(k => safeStr(themeJson[k]).trim()).find(Boolean);
  if (hit) return hit;

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

/**
 * free枠が短めで切れがちなので分割（安全側に 150）
 * free5 -> free3 -> free4 に流す（free1はテーマ用に空ける）
 */
function splitFreeByBytes(text, limitBytes = 420) {
  const s = normalizeSpaces(text).trim();
  if (!s) return ["", "", ""];

  const parts = [];
  let cur = s;

  const take = (str) => {
    let out = "";
    for (const ch of str) {
      const next = out + ch;
      if (Buffer.byteLength(next, "utf8") > limitBytes) break;
      out = next;
    }
    return out;
  };

  while (Buffer.byteLength(cur, "utf8") > limitBytes && parts.length < 2) {
    const head = take(cur);
    parts.push(head.trim());
    cur = cur.slice(head.length).trim();
  }
  parts.push(cur.trim());

  return [parts[0] || "", parts[1] || "", parts[2] || ""];
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

    const uid =
      pickFirst(body, ["uid", "user_id", "userid"]) ||
      findAnyKeyValue(body, /^form_data\[uid\]$/i);

    const pasted =
      pickFirst(body, ["form11-1", "form_data[form11-1]"]) ||
      findAnyKeyValue(body, /form11-1/i) ||
      pickFirst(body, ["pasted", "text", "message"]);

    const cardId = extractCardId(pasted);

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

    const commonPath = cardPathFor(cardId);
    const themePath = themePathFor(theme);

    const commonJson = readJson(commonPath);
    const themeJson = readJson(themePath);

    log(`[tarot-love] commonFrom: ${commonPath}`);
    log(`[tarot-love] themeFrom: ${themePath}`);
    log(`[tarot-love] addon: ${themeJson && !themeJson.__error ? "yes" : "no"}`);

    const commonLine = (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    // --- longBase（カード本文）
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

    // ✅テーマ addon（カード別コメントを拾う）
    const idsTried = altCardIds(cardId);
    const themeAddon = getThemeAddon(themeJson, cardId);

    log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
    log(`[tarot-love] themeAddon len: ${themeAddon.length}`);

    // ✅原因切り分けログ（空なら構造を見る）
    if (!themeAddon && themeJson && !themeJson.__error && typeof themeJson === "object") {
      log(`[tarot-love] themeJson keys sample: ${Object.keys(themeJson).slice(0, 40).join(",")}`);
      if (themeJson.append && typeof themeJson.append === "object") {
        log(`[tarot-love] themeJson.append keys sample: ${Object.keys(themeJson.append).slice(0, 40).join(",")}`);
      }
    }

    // ✅表示設計：
    // free5/free3/free4 = カード本文（長ければ分割）
    // free1 = テーマ追記 + 最後の1行（ここに必ず分離して入れる）
    const cta = `🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`;

    const [a, b, c] = splitFreeByBytes(longBase, 420);

    let free1 = "";
    if (themeAddon) {
      free1 = `【${themeLabel(theme)}の視点】\n${themeAddon}\n\n${cta}`.trim();
    } else {
      // テーマが取れない時は、最後の1行だけ free1 に入れてもOK（見切れ防止）
      free1 = cta;
    }

    log(`[tarot-love] len free6(short): ${shortText.length}`);
    log(`[tarot-love] len free5(long1): ${a.length}`);
    log(`[tarot-love] len free3(long3): ${b.length}`);
    log(`[tarot-love] len free4(long4): ${c.length}`);
    log(`[tarot-love] len free1(theme+cta): ${free1.length}`);

log(`[tarot-love] bytes free5: ${Buffer.byteLength(a, "utf8")}`);
log(`[tarot-love] bytes free3: ${Buffer.byteLength(b, "utf8")}`);
log(`[tarot-love] bytes free4: ${Buffer.byteLength(c, "utf8")}`);
log(`[tarot-love] bytes free1: ${Buffer.byteLength(free1, "utf8")}`);

    const payload = {
      uid,
      free6: safe(shortText),
      free5: safe(a),
      free3: safe(b),
      free4: safe(c),
      free1: safe(free1),

      // 使ってなくても毎回上書き（混入防止）
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
    res.statusCode = 200;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }));
  }
};
