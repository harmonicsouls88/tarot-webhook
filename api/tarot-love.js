// /api/tarot-love.js
const fs = require("fs");
const path = require("path");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  const s = String(pasted || "");

  // 1) 「行としての card_id:xxxx」だけ拾う（複数あれば最後）
  const matches = [...s.matchAll(/^\s*card_id\s*[:=]\s*([A-Za-z0-9_]+)\s*$/gmi)];
  if (matches.length) return matches[matches.length - 1][1];

  // 2) 保険：どこでもいいから拾う（最後）
  const matches2 = [...s.matchAll(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/gmi)];
  if (matches2.length) return matches2[matches2.length - 1][1];

  return "";
}

function detectSuit(cardId) {
  if (cardId.startsWith("cups_")) return "cups";
  if (cardId.startsWith("swords_")) return "swords";
  if (cardId.startsWith("wands_")) return "wands";
  if (cardId.startsWith("pentacles_")) return "pentacles";
  return "";
}

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
// theme detect (強化版)
// --------------------
function normalizeTheme(v) {
  const s = String(v || "").trim().toLowerCase();

  // 英語
  if (["love", "work", "money", "health"].includes(s)) return s;

  // 日本語（フォームに打ち込んだパターン）
  if (s.includes("恋")) return "love";
  if (s.includes("仕事") || s.includes("ワーク")) return "work";
  if (s.includes("金")) return "money";
  if (s.includes("健康") || s.includes("体調") || s.includes("からだ")) return "health";

  return "";
}

function detectTheme(body, pasted) {
  const b = body || {};

  // ProLine が取り得る候補を広めに拾う
  const candidates = [
    b["sel[theme]"],
    b["theme"],
    b["form_data[sel[theme]]"],
    b["form_data[theme]"],

    // ✅ あなたのフォーム（form11-2 = 恋愛or仕事）からも拾う
    b["form_data[form11-2]"],
    b["form11-2"],
    b["txt[ZXK8jMNQJ0]"], // 埋め込みHTMLの「恋愛or仕事」欄の例
  ];

  for (const c of candidates) {
    const t = normalizeTheme(c);
    if (t) return t;
  }

  // pasted に theme:money が入ってる場合も拾う（保険）
  const m = String(pasted || "").match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  if (m?.[1]) return m[1];

  return "love"; // 最終フォールバック
}

// --------------------
// cards load
// --------------------
function loadCommonCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
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

  // 1) { append: { cups_05: "..." } }
  if (j.append && j.append[cardId]) return { addon: { message: j.append[cardId] }, from: p };

  // 2) { cards: { cups_05: { message:"..." } } }
  if (j.cards && j.cards[cardId]) return { addon: j.cards[cardId], from: p };

  // 3) { cups_05: "..." } or { cups_05: { message:"..." } }
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

  if (addon.message) {
    const base = merged.message ? String(merged.message) : "";
    merged.message = base ? `${base}\n\n${addon.message}` : String(addon.message);
  }
  if (addon.focus) merged.focus = addon.focus;
  if (addon.action) merged.action = addon.action;

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
    ]
      .filter(Boolean)
      .join("\n");
  }

  const ctaBlock = cta?.url
    ? `\n\n———\n${cta.preline}\n${cta.label}\n${cta.url}`
    : "";

  return base + ctaBlock;
}

// --------------------
// body reader（依存少なめ）
// --------------------
async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  // x-www-form-urlencoded をURLSearchParamsで読む
  const params = new URLSearchParams(raw);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

// --------------------
// ProLineへ書き戻し（本命=form12 / 保険=free）
// --------------------
async function writeBackToProLine(uid, shortText, longText) {
  const formId = process.env.PROLINE_FORM12_ID;
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  // ✅ 互換のため「全部」投げる（ProLine側の解釈差を吸収）
  const payload = {
    // 直
    "form12-2": shortText,
    "form12-1": longText,

    // form_data 版
    "form_data[form12-2]": shortText,
    "form_data[form12-1]": longText,

    // ✅ 保険（ユーザー情報 free）
    free2: shortText,
    free1: longText,
  };

  const params = new URLSearchParams({ uid });
  for (const [k, v] of Object.entries(payload)) {
    if (v == null) continue;
    params.set(k, String(v));
  }

  console.log("[tarot-love] writeBack POST:", url);
  console.log("[tarot-love] writeBack keys:", Object.keys(payload));

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await r.text().catch(() => "");
  return { status: r.status, url, rawSnippet: text.slice(0, 240) };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
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
        longPreview: card ? buildTextLong(cardId, card, getCtaByTheme(theme, uid)).slice(0, 200) : "",
      });
    }

    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.["txt[zeRq0T9Qo1]"] || "") ||
      String(body?.pasted || "");

    const theme = detectTheme(body, pasted);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", String(pasted || "").slice(0, 80));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_id が取れない
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, short, long);
      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    const { card: common, from: commonFrom } = loadCommonCard(cardId);
    const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
    const card = mergeCard(common, addon);

    console.log("[tarot-love] commonFrom:", commonFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);
    console.log("[tarot-love] addon:", addon ? "yes" : "no");

    // カードが見つからない
    if (!card) {
      const short =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行が入った";

      const writeBack = await writeBackToProLine(uid, short, long);
      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅ 保存
    const cta = getCtaByTheme(theme, uid);
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, cta);

    const writeBack = await writeBackToProLine(uid, shortText, longText);

    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      found: true,
      commonFrom,
      themeFrom,
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
