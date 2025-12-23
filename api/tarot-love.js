// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  const s = String(pasted || "");

  // 1) 行としての card_id:xxxx だけ拾う（複数あれば最後）
  const matches = [...s.matchAll(/^\s*card_id\s*[:=]\s*([A-Za-z0-9_]+)\s*$/gmi)];
  if (matches.length) return matches[matches.length - 1][1];

  // 2) どこでもいいから拾う（複数あれば最後）
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

// theme: love / work / money / health
function detectTheme(body, pasted) {
  const b = body || {};

  const fromForm =
    b["sel[theme]"] ||
    b["theme"] ||
    b["form_data[sel[theme]]"] ||
    b["form_data[theme]"] ||
    b["sel_theme"] ||
    "";

  const tf = String(fromForm || "").trim();
  if (tf && ["love", "work", "money", "health"].includes(tf)) return tf;

  // pasted内に theme:money などがあれば拾う
  const m = String(pasted || "").match(/^\s*theme\s*[:=]\s*(love|work|money|health)\s*$/mi);
  return m?.[1] ?? "love";
}

// ✅ cards/common 配下のカードを読む
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

// ✅ 文字追記ユーティリティ
function appendText(base, more) {
  const b = String(base || "").trim();
  const m = String(more || "").trim();
  if (!m) return base || "";
  if (!b) return m;
  return `${b}\n\n${m}`;
}

// ✅ 共通カードにテーマ追記をマージ
// ★重要：共通カードが line.long 形式でも、テーマ追記が必ず表示に乗るようにする
function mergeCard(commonCard, addon) {
  if (!commonCard) return null;
  if (!addon) return commonCard;

  const merged = { ...commonCard };

  // message追記（標準）
  if (addon.message) {
    // 1) line.long があるなら、そこに追記する（←ここが今回の肝）
    if (merged.line && typeof merged.line.long === "string" && merged.line.long.trim()) {
      merged.line = { ...(merged.line || {}) };
      merged.line.long = appendText(merged.line.long, addon.message);
    } else {
      // 2) なければ message に追記
      merged.message = appendText(merged.message, addon.message);
    }

    // 3) short もあるなら、軽く追記してもOK（好みで）
    if (merged.line && typeof merged.line.short === "string" && merged.line.short.trim()) {
      merged.line = { ...(merged.line || {}) };
      // short は長くしすぎるとLINE吹き出しが崩れるので、追記は任意
      // merged.line.short = appendText(merged.line.short, addon.message);
    }
  }

  // 任意上書き
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
// read body
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
// ✅ free運用に統一（free2=短文 / free1=長文）
// 併せて互換のため form12-1/2 も同時に送る（残してOK）
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
    // GET: デバッグプレビュー用
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

      const shortPreview = card ? buildTextShort(cardId, card) : "";
      const longPreview = card ? buildTextLong(cardId, card, getCtaByTheme(theme, uid)) : "";

      return res.status(200).json({
        ok: true,
        uid,
        theme,
        cardId,
        found: !!card,
        commonFrom,
        themeFrom,
        addon: addon ? "yes" : "no",
        shortPreview,
        longPreview: longPreview.slice(0, 240),
      });
    }

    // --------------------
    // POST: ProLine webhook
    // --------------------
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");

    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
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
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\n表示された文章をそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        // ✅ freeに統一
        free2: short,
        free1: long,
        free3: "",
        free4: theme,

        // 互換（残してOK）
        "form_data[form12-2]": short,
        "form_data[form12-1]": long,
        "form12-2": short,
        "form12-1": long,
      });

      return res.status(200).json({ ok: true, uid, fallback: true, writeBack });
    }

    const { card: common, from: commonFrom } = loadCommonCard(cardId);
    const { addon, from: themeFrom } = loadThemeAddon(theme, cardId);
    const card = mergeCard(common, addon);

    console.log("[tarot-love] commonFrom:", commonFrom);
    console.log("[tarot-love] themeFrom:", themeFrom);
    console.log("[tarot-love] addon:", addon ? "yes" : "no");

    // カードが読めない
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

    // ✅ 長さログ（ここが正しい位置：shortText/longText 定義後）
    console.log("[tarot-love] len free2(short):", shortText.length);
    console.log("[tarot-love] len free1(long):", longText.length);

    // ✅ 保存：freeに統一（cp21はfree1/free2だけ読む）
    const writeBack = await writeBackToProLine(uid, {
      // free運用（本命）
      free2: shortText,
      free1: longText,

      // デバッグ用（cp21に出してもいい）
      free3: cardId,
      free4: theme,

      // 互換（残してOK）
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
      addon: addon ? "yes" : "no",
      shortPreview: shortText,
      longPreview: longText,
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
