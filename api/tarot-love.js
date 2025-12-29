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
  const two = String(n).padStart(2, "0");
  const one = String(n);

  return Array.from(new Set([`${prefix}_${two}`, `${prefix}_${one}`, id]));
}

/**
 * themeJson の構造違いも吸収して addon を拾う
 */
function getThemeAddon(themeJson, cardId) {
  if (!themeJson || themeJson.__error) return "";

  const ids = altCardIds(cardId);

  if (themeJson.append && typeof themeJson.append === "object") {
    const hit = ids.map(k => safeStr(themeJson.append[k]).trim()).find(Boolean);
    if (hit) return hit;
  }

  if (themeJson.cards && typeof themeJson.cards === "object") {
    const hit = ids.map(k => safeStr(themeJson.cards[k]).trim()).find(Boolean);
    if (hit) return hit;
  }

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

function byteLen(s) {
  return new TextEncoder().encode(s || "").length;
}

/**
 * ✅「・」だけの行や空行の連続を整える（見た目の “抜け” 対策）
 */
function tidyLines(s) {
  const text = normalizeSpaces(s || "");
  const lines = text.split("\n")
    .map(l => l.replace(/\s+$/g, ""))         // 右trim
    .filter(l => !/^\s*・\s*$/.test(l));      // "・"単体行を除去

  // 連続する空行を1つまでに圧縮
  const out = [];
  let blank = 0;
  for (const l of lines) {
    if (l.trim() === "") {
      blank++;
      if (blank <= 1) out.push("");
    } else {
      blank = 0;
      out.push(l);
    }
  }
  return out.join("\n").trim();
}

/**
 * ✅ バイト上限で “欠けずに” 先頭から切り出す（消費した index も返す）
 * - surrogate pair も壊さない
 */
function takeByBytes(text, limitBytes) {
  const s = normalizeSpaces(text || "");
  if (!s) return { part: "", consumed: 0 };

  let bytes = 0;
  let i = 0;

  while (i < s.length) {
    const code = s.codePointAt(i);
    const ch = String.fromCodePoint(code);
    const b = byteLen(ch);

    if (bytes + b > limitBytes) break;
    bytes += b;

    i += (code > 0xffff ? 2 : 1);
  }

  return { part: s.slice(0, i), consumed: i };
}

/**
 * ✅ free5/free3/free4 に “欠けずに” 分割する
 */
function splitFreeByBytes(text, limitBytes = 360) {
  const s = tidyLines(text);
  if (!s) return ["", "", ""];

  let rest = s;

  const t1 = takeByBytes(rest, limitBytes);
  const a = tidyLines(t1.part);
  rest = rest.slice(t1.consumed).trim();

  const t2 = takeByBytes(rest, limitBytes);
  const b = tidyLines(t2.part);
  rest = rest.slice(t2.consumed).trim();

  const t3 = takeByBytes(rest, limitBytes);
  const c = tidyLines(t3.part);

  return [a, b, c];
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
    log(`[tarot-love] theme: ${theme}`);
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

    const commonLine =
      (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    // ✅ longBase は “必ず組み立て”
    let longBase = "";
    if (commonJson && !commonJson.__error) {
      const lines = [];
      lines.push(`🌿 今日の整えワンポイント（詳細）`);
      lines.push(``);
      lines.push(`【カード】 ${safeStr(commonJson.title)}`);

      const mainMsg =
        safeStr(commonJson.message).trim() ||
        safeStr(commonLine.long).trim() ||
        safeStr(commonLine.full).trim();

      if (mainMsg) lines.push(mainMsg);

      if (safeStr(commonJson.focus).trim()) {
        lines.push(``);
        lines.push(`【意識すること】`);
        lines.push(safeStr(commonJson.focus).trim());
      }

      if (safeStr(commonJson.action).trim()) {
        lines.push(``);
        lines.push(`【今日の一手】`);
        lines.push(safeStr(commonJson.action).trim());
      }

      longBase = tidyLines(lines.join("\n"));
    } else {
      longBase = tidyLines(safeStr(commonLine.long).trim() || safeStr(commonLine.full).trim());
    }

    const idsTried = altCardIds(cardId);
    const addonText = getThemeAddon(themeJson, cardId);

    log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
    log(`[tarot-love] themeAddon len: ${addonText.length}`);

    const cta = `🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`;
    const tail = `焦らなくて大丈夫。整えた分だけ、現実がついてきます。`;

    // ✅ 末尾の励ましは “必ずどこかに入れる”
    const longForSplit = tidyLines(`${longBase}\n\n${tail}`);

    const [a, b, c] = splitFreeByBytes(longForSplit, 360);

    // free2 は “予備” として、空でも上書き（混入防止）
    const free2 = ""; // ←将来使いたくなったらここに入れる

    const free1 = addonText
      ? tidyLines(`【${themeLabel(theme)}の視点】\n${addonText}\n\n${cta}`)
      : cta;

    // ✅ログ（chars + bytes）
    log(`[tarot-love] free6 chars/bytes: ${shortText.length}/${byteLen(shortText)}`);
    log(`[tarot-love] free5 chars/bytes: ${a.length}/${byteLen(a)}`);
    log(`[tarot-love] free3 chars/bytes: ${b.length}/${byteLen(b)}`);
    log(`[tarot-love] free4 chars/bytes: ${c.length}/${byteLen(c)}`);
    log(`[tarot-love] free2 chars/bytes: ${free2.length}/${byteLen(free2)}`);
    log(`[tarot-love] free1 chars/bytes: ${free1.length}/${byteLen(free1)}`);

    const payload = {
      uid,
      free6: safe(shortText),
      free5: safe(a),
      free3: safe(b),
      free4: safe(c),
      free2: safe(free2),
      free1: safe(free1),
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
