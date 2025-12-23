// /api/tarot-love.js
// 目的：
// - pasted から card_id を拾う
// - theme を拾う（hidden theme / localStorage / 日本語入力の揺れも吸収）
// - cards/common と cards/theme/<theme>.json をマージ
// - ProLine に結果を書き戻す（free1/free2/free3/free4 を主。form12-1/2 も保険で書く）

const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  const s = String(pasted || "");

  // 1) 「行としての card_id:xxxx」だけ拾う（複数あれば最後）
  const matches = [...s.matchAll(/^\s*card_id\s*[:=]\s*([A-Za-z0-9_]+)\s*$/gmi)];
  if (matches.length) return matches[matches.length - 1][1];

  // 2) 保険：どこでもいいから card_id を拾う（最後）
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

// theme を正規化（love/work/money/health）
function normalizeTheme(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";

  // 英語
  if (["love", "work", "money", "health"].includes(s)) return s;

  // 日本語ゆらぎ（あなたのフォーム想定）
  if (s.includes("金")) return "money";
  if (s.includes("仕事") || s.includes("ワーク")) return "work";
  if (s.includes("健康") || s.includes("体調") || s.includes("からだ") || s.includes("身体")) return "health";
  if (s.includes("恋") || s.includes("愛")) return "love";

  return "";
}

// body / pasted から theme を拾う
function detectTheme(body, pasted) {
  const b = body || {};

  const candidates = [
    // hidden input name="theme" を想定
    b["theme"],
    b["form_data[theme]"],
    b["form_data[sel[theme]]"],
    b["sel[theme]"],

    // free4 を theme 保管にしたケース
    b["free4"],
    b["form_data[free4]"],

    // 以前のフィールドっぽい候補（念のため）
    b["form11-2"],
    b["form_data[form11-2]"],
    b["txt[ZXK8jMNQJ0]"], // 「恋愛or仕事」欄
  ];

  for (const c of candidates) {
    const t = normalizeTheme(c);
    if (t) return t;
  }

  // pasted に "theme:money" みたいに入っている場合
  const m = String(pasted || "").match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  if (m?.[1]) return m[1];

  // pasted に日本語が混ざる場合
  const jp = normalizeTheme(pasted);
  if (jp) return jp;

  return "love"; // 迷ったら love
}

// ✅ cards/common 配下のカードを読む（新構成を優先）
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

// ✅ cards/theme/<theme>.json から「追記」を読む（1ファイル方式）
function loadThemeAddon(theme, cardId) {
  const cwd = process.cwd();
  const p = path.join(cwd, "cards", "theme", `${theme}.json`);
  const j = readJsonIfExists(p);
  if (!j) return { addon: null, from: p };

  // 1) { "append": { "cups_02": "..." } }
  if (j.append && j.append[cardId]) {
    return { addon: { message: j.append[cardId] }, from: p };
  }

  // 2) { "cards": { "cups_02": { message: "..." } } }
  if (j.cards && j.cards[cardId]) {
    return { addon: j.cards[cardId], from: p };
  }

  // 3) { "cups_02": { message: "..." } } or { "cups_02": "..." }
  if (j[cardId]) {
    const v = j[cardId];
    if (typeof v === "string") return { addon: { message: v }, from: p };
    return { addon: v, from: p };
  }

  return { addon: null, from: p };
}

// ✅ 共通カードにテーマ追記をマージ
// ★重要：common に line.long がある場合でも addon.message が「見える」ようにする
function mergeCard(commonCard, addon, theme) {
  if (!commonCard) return null;
  if (!addon) return commonCard;

  const merged = JSON.parse(JSON.stringify(commonCard)); // 深いコピー

  const addonMsg = addon.message ? String(addon.message) : "";
  const themeLabel =
    theme === "love" ? "恋愛" :
    theme === "work" ? "仕事" :
    theme === "money" ? "金運" :
    theme === "health" ? "健康" : theme;

  const themedLine = addonMsg ? `【${themeLabel}】\n${addonMsg}` : "";

  // 1) message に追記
  if (themedLine) {
    const base = merged.message ? String(merged.message) : "";
    merged.message = base ? `${base}\n\n${themedLine}` : themedLine;
  }

  // 2) line.long があるなら、そこにも必ず追記（←ここが今回のキモ）
  if (themedLine) {
    if (merged.line && merged.line.long) {
      merged.line.long = `${String(merged.line.long)}\n\n———\n${themedLine}`;
    }
  }

  // 3) 上書きしたい場合（任意）
  if (addon.focus) merged.focus = addon.focus;
  if (addon.action) merged.action = addon.action;

  // 4) line.short/long をテーマで置き換えたい場合（任意）
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

async function readBody(req) {
  // Vercel / Express っぽい環境両対応
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// --------------------
// ProLineへ書き戻し
// - 基本：free1=長文, free2=短文, free3=cardId, free4=theme
// - ついでに form12-1 / form12-2 も保険で書く
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID; // xBi34LzVvN を env に入れている想定
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
    // GETはデバッグ用
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const body = { theme: String(req.query?.theme || "") };
      const theme = detectTheme(body, pasted);

      const cardId = pickCardId(pasted);
      const { card: common, from: commonFrom } = loadCommonCard(cardId);
      const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
      const card = mergeCard(common, addon, theme);

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

    // POST（ProLine Webhook）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["txt[zeRq0T9Qo1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const theme = detectTheme(body, pasted);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", String(pasted || "").slice(0, 120));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_id が取れない時のフォールバック
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        // 表示は free を主にする
        free2: short,
        free1: long,
        free3: "",
        free4: theme,

        // form12 も保険で
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        "form12-2": short,
        "form12-1": long,
      });

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    const { card: common, from: commonFrom } = loadCommonCard(cardId);
    const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
    const card = mergeCard(common, addon, theme);

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
        free2: short,
        free1: long,
        free3: cardId,
        free4: theme,

        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        "form12-2": short,
        "form12-1": long,
      });

      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅ 生成
    const cta = getCtaByTheme(theme, uid);
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, cta);

    // ✅ 書き戻し（free を主）
    const writeBack = await writeBackToProLine(uid, {
      free2: shortText,
      free1: longText,
      free3: cardId,
      free4: theme,

      // form12 も保険で
      "form_data[form12-2]": shortText,
      "form_data[form12-1]": longText,
      "form12-2": shortText,
      "form12-1": longText,
    });

    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      found: true,
      commonFrom,
      themeFrom,
      addon: addon ? true : false,
      shortPreview: shortText,
      longPreview: longText.slice(0, 240),
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
