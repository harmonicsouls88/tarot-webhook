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
  // ✅ここが消えると normalizeSpaces not defined になるので残す
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
  const s = (v == null ? "" : String(v));
  // 空はZWSP（上書き＆過去混入防止）
  return s.trim() ? s : ZWSP;
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
 * ✅ bytes計測
 * ============================ */
function byteLen(s) {
  return new TextEncoder().encode(s || "").length;
}

/* ============================
 * ✅【最重要】ズレない分割（trimしない/ slice位置が狂わない）
 * - UTF-16のインデックスで nextPos を返す
 * - なるべく改行で切る（見た目が綺麗）
 * ============================ */
function takeByBytes(text, startPos, limitBytes) {
  const s = normalizeSpaces(text || "");
  const encoder = new TextEncoder();

  let pos = startPos;      // UTF-16 index
  let bytes = 0;
  let lastBreak = -1;      // UTF-16 index（\nの位置）

  while (pos < s.length) {
    const code = s.codePointAt(pos);
    const step = code > 0xffff ? 2 : 1;     // surrogate pair対応
    const ch = s.slice(pos, pos + step);
    const b = encoder.encode(ch).length;

    if (bytes + b > limitBytes) break;
    bytes += b;
    pos += step;

    // 「段落」っぽいところで切りたいので、改行を覚える
    if (ch === "\n") lastBreak = pos;
  }

  // できれば改行で切る（ただし短すぎる切り方は避ける）
  let cutPos = pos;
  const minKeep = Math.min(startPos + 40, pos); // 40文字くらいは保持したい
  if (lastBreak !== -1 && lastBreak > minKeep) cutPos = lastBreak;

  const chunk = s.slice(startPos, cutPos).replace(/\s+$/g, ""); // ←末尾だけ整える（位置ズレなし）
  let nextPos = cutPos;

  // 次のパートの先頭が改行や空白だらけにならないよう軽くスキップ
  while (nextPos < s.length && (s[nextPos] === "\n" || s[nextPos] === " " || s[nextPos] === "\t")) {
    nextPos++;
  }

  return { chunk, nextPos };
}

function splitByBytesStable(text, limitBytes = 330) {
  const s = normalizeSpaces(text || "");
  const parts = [];
  let pos = 0;

  for (let i = 0; i < 3; i++) {
    if (pos >= s.length) {
      parts.push("");
      continue;
    }
    const { chunk, nextPos } = takeByBytes(s, pos, limitBytes);
    parts.push(chunk);
    pos = nextPos;
  }
  return parts;
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

    // ✅ longBase：組み立て式（ここに「焦らなくて…」も入れる）
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

      // 見出しと中身は「必ずセット」で入れる（抜け防止）
      const focus = safeStr(commonJson.focus).trim();
      const action = safeStr(commonJson.action).trim();

      if (focus) {
        lines.push(``);
        lines.push(`【意識すること】`);
        lines.push(focus);
      }

      if (action) {
        lines.push(``);
        lines.push(`【今日の一手】`);
        lines.push(action);
      }

      // ✅ここに固定アウトロ（free1側に入れない＝重複防止）
      lines.push(``);
      lines.push(`焦らなくて大丈夫。整えた分だけ、現実がついてきます。`);

      longBase = lines.join("\n");
    } else {
      longBase =
        safeStr(commonLine.long).trim() ||
        safeStr(commonLine.full).trim();
    }

    const idsTried = altCardIds(cardId);
    const themeAddon = getThemeAddon(themeJson, cardId);

    log(`[tarot-love] theme keys tried: ${idsTried.join(",")}`);
    log(`[tarot-love] themeAddon len: ${themeAddon.length}`);

    // ✅ テーマ文（free1にだけ置く）
    const cta = `🌿 もっと整えたい時は、LINEに戻って「整え直し」を選べます`;
    const free1 = themeAddon
      ? `【${themeLabel(theme)}の視点】\n${themeAddon}\n\n${cta}`
      : cta;

    // ✅ 分割（ズレない版）
    const [p1, p2, p3] = splitByBytesStable(longBase, 330);

    // free2は「毎回上書き＆混入防止用のダミー」
    // ※cp21で結合するなら、free2は “空(=ZWSP)” のままでOK
    const payload = {
      uid,
      free6: safe(shortText),

      free5: safe(p1),
      free3: safe(p2),
      free4: safe(p3),

      free2: ZWSP,       // ←いつでも上書きするため
      free1: safe(free1)
    };

    // ✅ログ（chars/bytes）
    log(`[tarot-love] free6 chars/bytes: ${shortText.length}/${byteLen(shortText)}`);
    log(`[tarot-love] free5 chars/bytes: ${p1.length}/${byteLen(p1)}`);
    log(`[tarot-love] free3 chars/bytes: ${p2.length}/${byteLen(p2)}`);
    log(`[tarot-love] free4 chars/bytes: ${p3.length}/${byteLen(p3)}`);
    log(`[tarot-love] free2 chars/bytes: ${ZWSP.length}/${byteLen(ZWSP)}`);
    log(`[tarot-love] free1 chars/bytes: ${free1.length}/${byteLen(free1)}`);

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
