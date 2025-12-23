// /api/tarot-love.js
// Vercel Node Function (CommonJS)

const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers: JSON read
// --------------------
function readJsonIfExists(p) {
  if (!p || !fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    const msg = `[JSON_PARSE_ERROR] file=${p} :: ${e.message}`;
    console.error(msg);
    throw new Error(msg);
  }
}

// --------------------
// helpers: card_id pick
// --------------------
// pasted から card_id を拾う。
// ※“最後”採用だと混入時にズレるので、基本は「最初に見つかった1つ」を採用して安定寄りに。
// ただし、行単位が複数ある場合は「最後が正しい」運用もあるので、必要なら切替OK。
function pickCardId(pasted) {
  const s = String(pasted || "");

  // 行単位の card_id を最優先（最初の1つ）
  const m = s.match(/^\s*card_id\s*[:=]\s*([A-Za-z0-9_]+)\s*$/mi);
  if (m && m[1]) return m[1];

  // どこでも拾う（最初の1つ）
  const m2 = s.match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/i);
  if (m2 && m2[1]) return m2[1];

  return "";
}

function detectSuit(cardId) {
  if (cardId.startsWith("cups_")) return "cups";
  if (cardId.startsWith("swords_")) return "swords";
  if (cardId.startsWith("wands_")) return "wands";
  if (cardId.startsWith("pentacles_")) return "pentacles";
  return "";
}

// --------------------
// helpers: theme normalize
// --------------------
function normalizeTheme(v) {
  const s = String(v || "").trim();
  if (!s) return "";

  // 正規値ならそのまま
  if (["love", "work", "money", "health"].includes(s)) return s;

  // 絵文字/装飾を除去して判定しやすく
  const t = s
    .replace(/[💗💖💘💕❤️💼💰💴🌿🩺]/g, "")
    .replace(/[()（）【】\[\]「」『』]/g, "")
    .replace(/\s+/g, "")
    .trim();

  // 日本語キーワード
  if (t.includes("恋愛")) return "love";
  if (t.includes("仕事")) return "work";
  if (t.includes("金運") || t.includes("お金") || t.includes("金銭")) return "money";
  if (t.includes("健康") || t.includes("体調")) return "health";

  // 英字っぽいのも拾う
  if (/love/i.test(t)) return "love";
  if (/work/i.test(t)) return "work";
  if (/money|finance|cash/i.test(t)) return "money";
  if (/health/i.test(t)) return "health";

  return "";
}

// body/pasted から theme を拾う（できるだけ広く）
function detectTheme(body, pasted) {
  const b = body || {};

  const candidates = [
    // よくある
    b["theme"],
    b["sel[theme]"],
    // ProLine form_data 形式
    b["form_data[theme]"],
    b["form_data[sel[theme]]"],
    // 「恋愛or仕事」みたいな選択をform11-2で持ってる場合
    b["form11-2"],
    b["form_data[form11-2]"],
    // 念のため
    b["form12-2"],
    b["form_data[form12-2]"],
    // 埋め込みtextarea等（キーが違う場合の保険）
    b["txt[zeRq0T9Qo1]"],
    b["txt[ZXK8jMNQJ0]"],
  ];

  for (const c of candidates) {
    const n = normalizeTheme(c);
    if (n) return n;
  }

  // pasted 内に theme:money などがある場合
  const m = String(pasted || "").match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  if (m && m[1]) return m[1];

  // 迷ったら love（必要なら money などに変更OK）
  return "love";
}

// --------------------
// card loader
// --------------------
function loadCommonCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
    // 新構成（推奨）
    path.join(cwd, "cards", "common", "major", `${cardId}.json`),
    path.join(cwd, "cards", "common", "minor", `${cardId}.json`),
    suit ? path.join(cwd, "cards", "common", "minor", `${cardId}.json`) : null,

    // 旧構成フォールバック
    path.join(cwd, "cards", "major", `${cardId}.json`),
    path.join(cwd, "cards", "minor", `${cardId}.json`),
    path.join(cwd, "cards", `${cardId}.json`),
    suit ? path.join(cwd, "cards", suit, `${cardId}.json`) : null,
  ].filter(Boolean);

  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { card: j, from: p };
  }
  return { card: null, from: candidates };
}

function loadThemeAddon(theme, cardId) {
  const cwd = process.cwd();
  const p = path.join(cwd, "cards", "theme", `${theme}.json`);
  const j = readJsonIfExists(p);
  if (!j) return { addon: null, from: p };

  // 1) { append: { cups_02: "..." } }
  if (j.append && j.append[cardId]) {
    return { addon: { message: j.append[cardId] }, from: p };
  }

  // 2) { cards: { cups_02: { message: "..." } } }
  if (j.cards && j.cards[cardId]) {
    return { addon: j.cards[cardId], from: p };
  }

  // 3) { cups_02: "..." } or { cups_02: { message: "..." } }
  if (j[cardId]) {
    const v = j[cardId];
    if (typeof v === "string") return { addon: { message: v }, from: p };
    return { addon: v, from: p };
  }

  return { addon: null, from: p };
}

function mergeCard(commonCard, addon) {
  if (!commonCard) return null;
  if (!addon) return commonCard;

  const merged = { ...commonCard };

  // message 追記（自然）
  if (addon.message) {
    const base = merged.message ? String(merged.message) : "";
    merged.message = base ? `${base}\n\n${addon.message}` : String(addon.message);
  }

  // 上書き（任意）
  if (addon.focus) merged.focus = addon.focus;
  if (addon.action) merged.action = addon.action;

  // short/long
  if (addon.line?.short) merged.line = { ...(merged.line || {}), short: addon.line.short };
  if (addon.line?.long) merged.line = { ...(merged.line || {}), long: addon.line.long };

  return merged;
}

// --------------------
// CTA（テーマ別）
// --------------------
const THEME_CTA = {
  love: {
    preline: "今日のカードを現実に変える一歩が欲しいなら👇",
    label: "💗 恋を動かす整えガイド（通話30分）",
    url: "https://l8x1uh5r.autosns.app/cp/gZKP8WdkE6?uid=[[uid]]",
  },
  work: {
    preline: "このまま終わらせず、次の一手を決めるなら👇",
    label: "💼 仕事の次の一手ガイド（通話30分）",
    url: "https://l8x1uh5r.autosns.app/cp/ScBMeGwPDE?uid=[[uid]]",
  },
  money: {
    preline: "迷いを減らして、お金の選択を整えるなら👇",
    label: "💰 お金の整えガイド（通話30分）",
    url: "https://l8x1uh5r.autosns.app/cp/mKNWGHprcf?uid=[[uid]]",
  },
  health: {
    preline: "不調を長引かせず、整える方向を掴むなら👇",
    label: "🌿 体調の整えガイド（通話30分）",
    url: "https://l8x1uh5r.autosns.app/cp/cL4HNsVwGt?uid=[[uid]]",
  },
};

function getCtaByTheme(theme, uid) {
  const cta = THEME_CTA[theme];
  if (!cta) return null;
  return { ...cta, url: cta.url.replace("[[uid]]", uid) };
}

// --------------------
// build texts
// --------------------
function buildTextShort(cardId, card) {
  const short = card?.line?.short;
  if (short) return String(short);

  const title = card?.title || cardId;
  const focus = card?.focus ? `意識：${String(card.focus)}` : "";
  const action = card?.action ? `一手：${String(card.action)}` : "";

  return [`【${title}】`, focus, action].filter(Boolean).join("\n");
}

function buildTextLong(cardId, card, cta) {
  const long = card?.line?.long;
  let base;

  if (long) {
    base = String(long);
  } else {
    const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
    const msg = card?.message ? String(card.message) : "";
    const focus = card?.focus ? `【意識すること】\n${String(card.focus)}` : "";
    const action = card?.action ? `【今日の一手】\n${String(card.action)}` : "";

    base = [
      "🌿 今日の整えワンポイント",
      "",
      title,
      msg,
      "",
      focus,
      "",
      action,
      "",
      "今日はここまででOKです🌙",
    ].join("\n");
  }

  const ctaBlock = cta?.url
    ? `\n\n———\n${cta.preline}\n${cta.label}\n${cta.url}`
    : "";

  return base + ctaBlock;
}

// --------------------
// request body read
// --------------------
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// --------------------
// ProLineへ書き戻し
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID;
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  const params = new URLSearchParams({ uid });

  for (const [k, v] of Object.entries(payloadObj)) {
    if (v == null) continue;
    params.set(k, String(v));
  }

  console.log("[tarot-love] writeBack POST:", url);
  console.log("[tarot-love] writeBack keys:", Object.keys(payloadObj));
  console.log("[tarot-love] writeBack body head:", params.toString().slice(0, 220));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { status: r.status, url, rawSnippet: text.slice(0, 220) };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // --------------------
    // GET: debug
    // --------------------
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const body = { theme: String(req.query?.theme || "") };
      const theme = detectTheme(body, pasted);

      const cardId = pickCardId(pasted);
      const { card: common, from: commonFrom } = loadCommonCard(cardId);
      const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
      const card = mergeCard(common, addon);

      return res.status(200).json({
        ok: true,
        uid,
        theme,
        cardId,
        found: !!card,
        commonFrom,
        themeFrom,
        shortPreview: card ? buildTextShort(cardId, card) : "",
        longPreview: card ? buildTextLong(cardId, card, getCtaByTheme(theme, uid)).slice(0, 220) : "",
      });
    }

    // --------------------
    // POST: ProLine
    // --------------------
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");

    // pasted をできるだけ広く拾う
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["txt[zeRq0T9Qo1]"] || "") ||
      String(body?.["txt[ZXK8jMNQJ0]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const theme = detectTheme(body, pasted);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", String(pasted || "").slice(0, 80));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });
    }

    // cardIdが取れない場合
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        // 本命（form12）
        "form12-2": short,
        "form12-1": long,
        // 保険（form_data）
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        // 保険（free）
        "free2": short,
        "free1": long,
        // デバッグ
        "free3": "",
        "free4": theme,
      });

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    // カードロード
    const { card: common, from: commonFrom } = loadCommonCard(cardId);
    const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
    const card = mergeCard(common, addon);

    console.log("[tarot-love] commonFrom:", commonFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);
    console.log("[tarot-love] addon:", addon ? "yes" : "no");

    if (!card) {
      const short =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行が入った";

      const writeBack = await writeBackToProLine(uid, {
        "form12-2": short,
        "form12-1": long,
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        "free2": short,
        "free1": long,
        "free3": cardId,
        "free4": theme,
      });

      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅結果生成
    const cta = getCtaByTheme(theme, uid);
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, cta);

    // ✅保存：form12が本命、freeは保険（ズレ防止）
    const writeBack = await writeBackToProLine(uid, {
      // 本命（form12）
      "form12-2": shortText,
      "form12-1": longText,

      // 保険（form_data）
      "form_data[form12-2]": shortText,
      "form_data[form12-1]": longText,

      // 保険（free）
      "free2": shortText,
      "free1": longText,

      // デバッグ（選んだカード・テーマ）
      "free3": cardId,
      "free4": theme,
    });

    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      found: true,
      commonFrom,
      themeFrom,
      shortPreview: shortText,
      longPreview: longText,
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
