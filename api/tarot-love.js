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
  // ✅ ここが消えると normalizeSpaces not defined になるので残す
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
  const two = String(n).padStart(2, "0"); // 06
  const one = String(n);                  // 6
  return Array.from(new Set([`${prefix}_${two}`, `${prefix}_${one}`, id]));
}

/**
 * themeJson の構造違いも吸収して addon を拾う
 * { id, label, append: { cups_06:"...", ... } } など
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

/* ============================
 * ✅【完成版】“bytes基準 + 消費文字数追跡”で安全に分割
 * - trim で長さがズレて欠ける/重複する問題を根絶
 * - free5/free3/free4/free2 に本文を流す（最大4枠）
 * ============================ */
function byteLen(s) {
  return new TextEncoder().encode(s || "").length;
}

/**
 * 先頭から limitBytes 以内で切る
 * - できれば「最後の改行」位置で切る（読みやすい）
 * - 戻り値：{ chunk, consumed }
 *   chunk: 表示用文字列（末尾の余分な改行だけ軽く整理）
 *   consumed: 元文字列から何文字消費したか（これが超重要）
 */
function takeChunkByBytes(src, limitBytes) {
  const s = normalizeSpaces(src || "");
  if (!s) return { chunk: "", consumed: 0 };
  if (byteLen(s) <= limitBytes) return { chunk: s.trim(), consumed: s.length };

  let bytes = 0;
  let i = 0;
  let lastNl = -1;

  for (; i < s.length; i++) {
    const ch = s[i];
    const b = byteLen(ch);
    if (bytes + b > limitBytes) break;
    bytes += b;
    if (ch === "\n") lastNl = i;
  }

  // 改行で気持ちよく切れるなら、そこまでを採用
  let cut = i;
  if (lastNl >= 0 && lastNl >= Math.floor(i * 0.6)) {
    cut = lastNl + 1; // 改行含めて消費
  }

  const rawChunk = s.slice(0, cut);
  const chunk = rawChunk.replace(/\n{3,}/g, "\n\n").trim(); // 改行多すぎだけ整える

  return { chunk, consumed: cut };
}

function splitInto4ByBytes(text, limitBytes = 340) {
  const s = normalizeSpaces(text).trim();
  if (!s) return ["", "", "", ""];

  let rest = s;
  const out = [];

  for (let k = 0; k < 4; k++) {
    const { chunk, consumed } = takeChunkByBytes(rest, limitBytes);
    out.push(chunk);
    rest = rest.slice(consumed).trimStart();
    if (!rest) break;
  }

  while (out.length < 4) out.push("");
  return out; // [p1,p2,p3,p4]
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

    const commonLine =
      (commonJson && !commonJson.__error && commonJson.line) ? commonJson.line : {};

    const shortText =
      safeStr(commonLine.short).trim() ||
      (commonJson && !commonJson.__error ? `今日は「${safeStr(commonJson.title)}」の整え。小さくでOKです🌿` : "");

    // ✅【変更点B】longBaseを“必ず組み立て式”で作る
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
    } else {
      longBase = safeStr(commonLine.long).trim() || safeStr(commonLine.full).trim();
    }

    // ✅テーマ addon
    const idsTried = altCardIds(cardId);
    const themeAddon = getThemeAddon(themeJson, cardId);

    log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
    log(`[tarot-love] themeAddon len: ${themeAddon.length}`);

    const cta = `🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`;

    // ✅【変更点C】本文は free5/free3/free4/free2 に最大4分割
    // まずは 340 bytes 推奨（日本語でも安全寄り）
    const [p5, p3, p4, p2] = splitInto4ByBytes(longBase, 340);

    // ✅free1 は「テーマ視点 + CTA」に固定
    const free1 = themeAddon
      ? `【${themeLabel(theme)}の視点】\n${themeAddon}\n\n${cta}`.trim()
      : cta;

    // ✅ログ（length + bytes）
    log(`[tarot-love] len free6(short): ${shortText.length}`);
    log(`[tarot-love] len free5: ${p5.length} / bytes ${byteLen(p5)}`);
    log(`[tarot-love] len free3: ${p3.length} / bytes ${byteLen(p3)}`);
    log(`[tarot-love] len free4: ${p4.length} / bytes ${byteLen(p4)}`);
    log(`[tarot-love] len free2: ${p2.length} / bytes ${byteLen(p2)}`);
    log(`[tarot-love] len free1(theme+cta): ${free1.length} / bytes ${byteLen(free1)}`);

    const payload = {
      uid,
      free6: safe(shortText),
      free5: safe(p5),
      free3: safe(p3),
      free4: safe(p4),
      free2: safe(p2),     // ★使う：第4枠
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
