// /api/tarot-love.js
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

function themeNormalize(raw) {
  const t = String(raw || "").trim().toLowerCase();

  // 英語
  if (["love", "work", "money", "health"].includes(t)) return t;

  // 日本語
  if (t.includes("恋愛")) return "love";
  if (t.includes("仕事")) return "work";
  if (t.includes("金運") || t.includes("お金")) return "money";
  if (t.includes("健康") || t.includes("体調")) return "health";

  return "";
}

// body/pasted からテーマ判定（日本語も拾う）
function detectTheme(body, pasted) {
  const b = body || {};

  // よくある入力元を広めに拾う
  const candidates = [
    b["sel[theme]"],
    b["theme"],
    b["form_data[sel[theme]]"],
    b["form_data[theme]"],

    // 「恋愛or仕事or金運or健康」みたいなフォーム入力がここに入ってくるケース対策
    b["form_data[form11-2]"],
    b["form11-2"],

    // もし free4 に保存する運用なら（任意）
    b["free4"],
  ].filter(Boolean);

  for (const v of candidates) {
    const n = themeNormalize(v);
    if (n) return n;
  }

  // pasted に「theme:money」などがあれば拾う（英語）
  const m = String(pasted || "").match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  if (m?.[1]) return m[1];

  // pasted に日本語があれば拾う
  const jp = themeNormalize(pasted);
  if (jp) return jp;

  // 最後は love に倒す（必要なら "money" に変更OK）
  return "love";
}

// --------------------
// cards loader
// --------------------
function loadCommonCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
    // 新構成（推奨）
    path.join(cwd, "cards", "common", "major", `${cardId}.json`),
    path.join(cwd, "cards", "common", "minor", `${cardId}.json`),

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

/**
 * theme json から「テーマ別追記」を文字列で返す
 * 対応:
 * 1) { "append": { "cups_02": "..." } }
 * 2) { "cards": { "cups_02": { message:"..." } } }
 * 3) { "cups_02": "..." } or { "cups_02": { message:"..." } }
 */
function loadThemeAddonText(theme, cardId) {
  const cwd = process.cwd();
  const p = path.join(cwd, "cards", "theme", `${theme}.json`);
  const j = readJsonIfExists(p);
  if (!j) return { text: "", from: p };

  // 1) append
  if (j.append && j.append[cardId]) {
    const v = j.append[cardId];
    return { text: typeof v === "string" ? v : (v?.message || ""), from: p };
  }

  // 2) cards
  if (j.cards && j.cards[cardId]) {
    const v = j.cards[cardId];
    return { text: typeof v === "string" ? v : (v?.message || ""), from: p };
  }

  // 3) 直置き
  if (j[cardId]) {
    const v = j[cardId];
    return { text: typeof v === "string" ? v : (v?.message || ""), from: p };
  }

  return { text: "", from: p };
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

function themeLabel(theme) {
  return { love: "恋愛", work: "仕事", money: "金運", health: "健康" }[theme] || theme;
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

function buildTextLong(cardId, card, theme, themeAddonText, cta) {
  const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】\n${String(card.focus)}` : "";
  const action = card?.action ? `【今日の一手】\n${String(card.action)}` : "";

  const themeBlock = themeAddonText
    ? `【${themeLabel(theme)}の整えポイント】\n${String(themeAddonText)}`
    : "";

  const base = [
    "🌿 今日の整えワンポイント",
    "",
    title,
    msg,
    "",
    themeBlock,
    "",
    focus,
    "",
    action,
    "",
    "今日はここまででOKです🌙",
  ]
    .filter(Boolean)
    .join("\n");

  const ctaBlock = cta?.url
    ? `\n\n———\n${cta.preline}\n${cta.label}\n${cta.url}`
    : "";

  return base + ctaBlock;
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// --------------------
// ProLineへ書き戻し（free1/free2 を主、互換で form12-1/2 も）
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID; // あなたの fm/xBi34LzVvN の ID を env に入れてる前提
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
    // GET = デバッグ用
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const body = { theme: String(req.query?.theme || "") };

      const theme = detectTheme(body, pasted);
      const cardId = pickCardId(pasted);

      const { card: common, from: commonFrom } = loadCommonCard(cardId);
      const { text: addonText, from: themeFrom } = loadThemeAddonText(theme, cardId);
      const cta = getCtaByTheme(theme, uid);

      return res.status(200).json({
        ok: true,
        uid,
        theme,
        cardId,
        found: !!common,
        commonFrom,
        themeFrom,
        addonTextPreview: addonText.slice(0, 120),
        shortPreview: common ? buildTextShort(cardId, common) : "",
        longPreview: common ? buildTextLong(cardId, common, theme, addonText, cta).slice(0, 220) : "",
      });
    }

    // POST（ProLine Webhook）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // pasted は「コピー欄」由来を優先的に拾う（あなたの運用に合わせて広め）
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["txt[zeRq0T9Qo1]"] || "") ||
      String(body?.pasted || "");

    const theme = detectTheme(body, pasted);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", String(pasted || "").slice(0, 80));
    console.log("[tarot-love] cardId:", cardId);

    // card_id が取れない時のフォールバック
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\n表示された文章をそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        // ✅ cp21表示用（freeに統一）
        free2: short,
        free1: long,
        // 互換（古い表示が残ってても大丈夫に）
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        // 追跡用（任意）
        free3: "",
        free4: theme,
      });

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    const { card: common, from: commonFrom } = loadCommonCard(cardId);
    const { text: addonText, from: themeFrom } = loadThemeAddonText(theme, cardId);

    console.log("[tarot-love] commonFrom:", commonFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);
    console.log("[tarot-love] addon:", addonText ? "yes" : "no");

    if (!common) {
      const short =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行で card_id が崩れた";

      const writeBack = await writeBackToProLine(uid, {
        free2: short,
        free1: long,
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        free3: cardId,
        free4: theme,
      });

      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅ 生成（テーマ追記 + CTA）
    const cta = getCtaByTheme(theme, uid);
    const shortText = buildTextShort(cardId, common);
    const longText = buildTextLong(cardId, common, theme, addonText, cta);

    // ✅ 保存先：free2/free1（cp21が表示）＋互換でform12も同時に保存
    const writeBack = await writeBackToProLine(uid, {
      // cp21表示
      free2: shortText,
      free1: longText,

      // 互換
      "form_data[form12-2]": shortText,
      "form_data[form12-1]": longText,

      // 追跡用（任意：あなたが作った free3/free4 を使うなら）
      free3: cardId,
      free4: theme,
    });

    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      found: true,
      commonFrom,
      themeFrom,
      addonTextPreview: addonText.slice(0, 120),
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
