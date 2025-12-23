// api/tarot-love.js
// ProLine -> Vercel webhook -> ProLine writeBack
// - theme を form11-5 から取得（恋愛/仕事/金運/健康）
// - cards/** を vercel.json includeFiles で同梱して fs で読む
// - 本文は free5/free1/free3/free4 に分割して保存（文字数制限回避）
// - cp21 は free6(short) と free5+free1+free3+free4 を結合表示する想定

const fs = require("fs");
const path = require("path");

// =========================
// utilities
// =========================
function log(...args) {
  console.log("[tarot-love]", ...args);
}

// ProLine は application/x-www-form-urlencoded で来ることが多い
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const ct = (req.headers["content-type"] || "").toLowerCase();
      // urlencoded
      if (ct.includes("application/x-www-form-urlencoded")) {
        const params = new URLSearchParams(data);
        const obj = {};
        for (const [k, v] of params.entries()) obj[k] = v;
        return resolve(obj);
      }
      // json
      if (ct.includes("application/json")) {
        try {
          return resolve(JSON.parse(data || "{}"));
        } catch (e) {
          return reject(e);
        }
      }
      // fallback: try urlencoded anyway
      const params = new URLSearchParams(data);
      const obj = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      resolve(obj);
    });
    req.on("error", reject);
  });
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim() !== "") return String(obj[k]);
  }
  return "";
}

function normalizeTheme(raw) {
  const s = String(raw || "").trim().toLowerCase();

  // already normalized
  if (["love", "work", "money", "health"].includes(s)) return s;

  // Japanese -> key
  if (s.includes("恋愛")) return "love";
  if (s.includes("仕事")) return "work";
  if (s.includes("金運") || s.includes("お金") || s.includes("財運")) return "money";
  if (s.includes("健康")) return "health";

  // also handle "money（金運）" みたいな形
  if (s.startsWith("money")) return "money";
  if (s.startsWith("love")) return "love";
  if (s.startsWith("work")) return "work";
  if (s.startsWith("health")) return "health";

  // fallback
  return "love";
}

function parseCardId(pasted) {
  const text = String(pasted || "");
  // card_id:xxxx / card_id=xxxx / "card_id: xxxx"
  const m = text.match(/card_id\s*[:=]\s*([a-z_0-9]+)\s*/i);
  if (m && m[1]) return m[1].trim();
  return "";
}

function cardPath(cardId) {
  // major_00..major_21
  if (/^major_\d{2}$/i.test(cardId)) {
    return path.join("cards", "common", "major", `${cardId.toLowerCase()}.json`);
  }
  // minor: cups_01..14 / wands_01..14 / swords_01..14 / pentacles_01..14
  if (/^(cups|wands|swords|pentacles)_\d{2}$/i.test(cardId)) {
    return path.join("cards", "common", "minor", `${cardId.toLowerCase()}.json`);
  }
  return "";
}

function readJson(relPath) {
  // Vercel の実行パス基準で読む（includeFiles で同梱される前提）
  const abs = path.join(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

// free フィールド分割（安全側で 240 に）
function splitToChunks(text, maxLen = 240, maxParts = 4) {
  const t = String(text || "").replace(/\r\n/g, "\n");
  const parts = [];
  let rest = t;

  while (rest.length > 0 && parts.length < maxParts) {
    if (rest.length <= maxLen) {
      parts.push(rest);
      rest = "";
      break;
    }
    // なるべく改行で切る（見栄え）
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = maxLen;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }

  // 余りは最後に押し込む（超過は諦める）
  if (rest.length > 0) {
    parts[parts.length - 1] = (parts[parts.length - 1] + "\n" + rest).slice(0, maxLen);
  }

  // 常に maxParts 個返す
  while (parts.length < maxParts) parts.push("");
  return parts;
}

async function postForm(url, bodyObj) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(bodyObj)) {
    form.append(k, v == null ? "" : String(v));
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: form.toString(),
  });

  const txt = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text: txt };
}

// =========================
// main
// =========================
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end("Method Not Allowed");
    }

    const body = await parseBody(req);

    // uid
    const uid = pick(body, ["uid", "basic_id", "user_id", "userId"]);
    // form11 pasted
    const pasted = pick(body, [
      "form11-1",
      "form_data[form11-1]",
      "form_data[form11_1]",
      "form_data[form11-1][]",
      "form_data[form11_1][]",
    ]);

    // theme (radio form11-5)
    const themeRaw = pick(body, [
      "form11-5",
      "form_data[form11-5]",
      "form_data[form11_5]",
      "theme",
      "form_data[theme]",
    ]);
    const theme = normalizeTheme(themeRaw);

    log("uid:", uid);
    log("themeRaw:", themeRaw);
    log("theme:", theme);

    // pasted head (for debug)
    log("pasted head:", String(pasted || "").slice(0, 120).replace(/\n/g, "\\n"));

    const cardId = parseCardId(pasted);
    if (!cardId) {
      res.statusCode = 400;
      return res.end("Bad Request: card_id not found");
    }
    log("cardId:", cardId);

    // read common card json
    const rel = cardPath(cardId);
    if (!rel) {
      res.statusCode = 400;
      return res.end("Bad Request: unknown card_id format");
    }

    let common;
    try {
      common = readJson(rel);
    } catch (e) {
      // ここが ENOENT の本丸。includeFiles が効いてないと起きる。
      log("ERROR reading common json:", e?.message || e);
      res.statusCode = 500;
      return res.end("Server Error: card json not found in deployment. Check vercel.json includeFiles.");
    }

    // theme addon json
    let addon = {};
    try {
      addon = readJson(path.join("cards", "theme", `${theme}.json`));
    } catch (e) {
      // addon は無くても致命傷にしない
      log("addon read skipped:", e?.message || e);
      addon = {};
    }

    const themeText = addon[cardId] || ""; // テーマ別の一文
    const line = common?.line || {};
    const shortText = String(line.short || common.message || "").trim();

    // long base: まず「カード詳細」
    const longBase =
      String(line.long || line.full || "").trim() ||
      [
        "🌿 今日の整えワンポイント（詳細）",
        "",
        `【カード】 ${common.title || cardId}`,
        common.message ? `\n${common.message}` : "",
        common.focus ? `\n\n【意識すること】\n${common.focus}` : "",
        common.action ? `\n\n【今日の1アクション】\n${common.action}` : "",
      ].join("");

    // upsell/誘導（必要ならここに固定文で）
    const cta =
      "\n\n―――\n" +
      "🌿 もっと深く整えたい方へ\n" +
      "LINEから「個別整え（有料）」もご案内できます。\n" +
      "気になる方は「個別」と送ってください。";

    // theme addon を本文に差し込み
    const themed =
      (themeText ? `\n\n【テーマ別メッセージ】\n${themeText}` : "") + cta;

    const longText = (longBase + themed).trim();

    // 文字数ログ
    log("len short:", shortText.length);
    log("len long:", longText.length);

    // ProLine writeBack URL（あなたのログに出てた form12 のURLを body から拾う）
    // ※固定で持ってるならここを固定してもOK
    const writeBackUrl = pick(body, [
      "writeBack",
      "write_back",
      "writeback",
      "callback",
      "callback_url",
    ]);

    // もし query に writeBack が付く運用ならそれも拾う
    const reqUrl = new URL(req.url, "https://dummy.local");
    const writeBackFromQuery = reqUrl.searchParams.get("writeBack") || "";
    const wb = writeBackUrl || writeBackFromQuery;

    if (!wb) {
      res.statusCode = 400;
      return res.end("Bad Request: writeBack url not provided");
    }
    log("writeBack POST:", wb);

    // 保存先：
    // short -> free6
    // long  -> free5/free1/free3/free4（4分割）
    const [p1, p2, p3, p4] = splitToChunks(longText, 240, 4);

    const payload = {
      uid: uid,

      // 表示用
      free6: shortText,
      free5: p1,
      free1: p2,
      free3: p3,
      free4: p4,

      // デバッグ保険（必要なら）
      // free2: `theme=${theme} card=${cardId}`,

      // 旧互換（もし cp21 が free2/free1 を見てる場合の保険）
      free2: shortText,
    };

    const result = await postForm(wb, payload);
    log("writeBack status:", result.status);

    if (!result.ok) {
      res.statusCode = 502;
      return res.end(`Bad Gateway: writeBack failed (${result.status})`);
    }

    res.statusCode = 200;
    return res.end("OK");
  } catch (e) {
    console.log("[tarot-love] FATAL:", e);
    res.statusCode = 500;
    return res.end("Server Error");
  }
};
