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
  // ✅ここを消すと normalizeSpaces not defined になるので残す
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
const safeOut = (v) => {
  const s = (v == null ? "" : String(v));
  // NOTE: trimしすぎると “消費ズレ” の原因になるので、出力側は控えめ
  const t = s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return t.length ? t : ZWSP;
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

/* ============================
 * ✅bytes計測（日本語安全）
 * ============================ */
function byteLen(s) {
  return new TextEncoder().encode(s || "").length;
}

/**
 * ✅【重要】bytes上限まで取りつつ「何文字消費したか」も返す
 * - 文字境界で止める（日本語途中切れなし）
 * - 末尾の改行/空白は “表示調整” で削るが、consumed は削る前の位置を保持
 */
function takeByBytesWithConsumed(source, limitBytes) {
  const text = normalizeSpaces(source || "");
  if (!text) return { chunk: "", consumed: 0 };

  let acc = "";
  let consumed = 0;

  for (const ch of text) {
    const next = acc + ch;
    if (byteLen(next) > limitBytes) break;
    acc = next;
    consumed += ch.length; // JSは基本1
  }

  // 改行の途中で止まると見た目が悪いので、最後に “行単位で後退” を試す
  // ただし consumed は “実消費” を優先しつつ、後退した分は消費も戻す
  let trimmed = acc;
  if (trimmed.includes("\n")) {
    const lastNl = trimmed.lastIndexOf("\n");
    // 末尾が1行途中なら、その行を丸ごと次へ回す
    if (lastNl > 0 && lastNl >= trimmed.length - 40) {
      const back = trimmed.slice(lastNl + 1);
      // backが短い時だけ後退（安全）
      if (back.trim().length > 0) {
        trimmed = trimmed.slice(0, lastNl + 1);
        consumed = trimmed.length;
      }
    }
  }

  // 表示用：末尾の余計な空白を軽く整形
  const chunk = trimmed.replace(/[ \t]+\n/g, "\n").replace(/[ \t]+$/g, "").trimEnd();

  return { chunk, consumed };
}

/**
 * ✅4分割（free5/free3/free4/free2）
 */
function splitInto4ByBytes(text, limitBytes = 360) {
  let rest = normalizeSpaces(text || "");
  const out = [];

  for (let i = 0; i < 4; i++) {
    rest = rest.replace(/^\n+/, ""); // 先頭の改行だけ落とす
    if (!rest.trim()) { out.push(""); continue; }

    const { chunk, consumed } = takeByBytesWithConsumed(rest, limitBytes);
    out.push(chunk);

    // consumed ぶんを確実に剥がす（trimでズレない）
    rest = rest.slice(consumed);
  }

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

    const cardTitle = (commonJson && !commonJson.__error) ? safeStr(commonJson.title) : "";

    const shortText =
      safeStr(commonLine.short).trim() ||
      (cardTitle ? `今日は「${cardTitle}」の整え。小さくでOKです🌿` : "");

    // ✅longBaseは “本文だけ” を作る（CTAはここに入れない）
    let longBase = "";
    if (commonJson && !commonJson.__error) {
      const lines = [];
      lines.push(`🌿 今日の整えワンポイント（詳細）`);
      lines.push(``);
      lines.push(`【カード】 ${cardTitle}`);

      const mainMsg =
        safeStr(commonJson.message).trim() ||
        safeStr(commonLine.long).trim() ||
        safeStr(commonLine.full).trim();

      if (mainMsg) {
        lines.push(mainMsg);
      }

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

      longBase = lines.join("\n").trim();
    } else {
      longBase = safeStr(commonLine.long).trim() || safeStr(commonLine.full).trim();
    }

    // ✅テーマ addon（free1にだけ入れる）
    const idsTried = altCardIds(cardId);
    const addonText = getThemeAddon(themeJson, cardId);

    log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
    log(`[tarot-love] themeAddon len: ${addonText.length}`);

    const cta = `🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`;

    const free1 =
      addonText
        ? `【${themeLabel(theme)}の視点】\n${addonText}\n\n${cta}`
        : cta;

    // ✅4分割：free5/free3/free4/free2
    const [p1, p2, p3, p4] = splitInto4ByBytes(longBase, 360);

    const payload = {
      uid,
      free6: safeOut(shortText),
      free5: safeOut(p1),
      free3: safeOut(p2),
      free4: safeOut(p3),
      free2: safeOut(p4),
      free1: safeOut(free1),
    };

    // ✅ログ：chars/bytes（ZWSPも見える）
    const logOne = (k, v) => log(`[tarot-love] ${k} chars/bytes: ${String(v).length}/${byteLen(String(v))}`);
    logOne("free6", payload.free6);
    logOne("free5", payload.free5);
    logOne("free3", payload.free3);
    logOne("free4", payload.free4);
    logOne("free2", payload.free2);
    logOne("free1", payload.free1);

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
