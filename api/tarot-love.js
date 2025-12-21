// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// ========= ProLine フィールド（あなたの実物に固定） =========
// form12（結果深掘り）
// 長文（free1）: txt[vgbwPXeBy6]
// 短文（free2）: txt[I8onOXeYSh]
const FIELD_LONG = "txt[vgbwPXeBy6]";
const FIELD_SHORT = "txt[I8onOXeYSh]";

// form11（貼り付け）
const FIELD_PASTED = "txt[zeRq0T9Qo1]";

// 有料版URL（ここはあなたのURLに差し替え）
const PAID_URL_LOVE = "https://example.com/paid-love";
const PAID_URL_WORK = "https://example.com/paid-work";

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  const m = String(pasted).match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
}

function pickTheme(pasted) {
  if (!pasted) return "love";
  const m = String(pasted).match(/^\s*theme\s*[:=]\s*(love|work)\s*$/im);
  return (m?.[1] || "love").toLowerCase();
}

function isMajor(cardId) {
  return /^major_\d{2}$/.test(cardId);
}

function detectSuit(cardId) {
  if (cardId.startsWith("cups_")) return "cups";
  if (cardId.startsWith("swords_")) return "swords";
  if (cardId.startsWith("wands_")) return "wands";
  if (cardId.startsWith("pentacles_")) return "pentacles";
  return "";
}

function readJsonIfExists(p) {
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

function loadCard(cardId, theme) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  // テーマ別cardsを優先し、無ければ従来cardsへフォールバック
  const themedBase = path.join(cwd, "cards", theme);   // cards/love or cards/work
  const legacyBase = path.join(cwd, "cards");         // cards/

  const candidates = [
    // theme優先
    path.join(themedBase, "major", `${cardId}.json`),
    path.join(themedBase, "minor", `${cardId}.json`),
    suit ? path.join(themedBase, suit, `${cardId}.json`) : null,
    path.join(themedBase, `${cardId}.json`),

    // 旧構成（共通cards）
    path.join(legacyBase, "major", `${cardId}.json`),
    path.join(legacyBase, "minor", `${cardId}.json`),
    suit ? path.join(legacyBase, suit, `${cardId}.json`) : null,
    path.join(legacyBase, `${cardId}.json`),
  ].filter(Boolean);

  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { card: j, from: p };
  }
  return { card: null, from: candidates };
}

function buildTextShort(cardId, card) {
  const short = card?.line?.short;
  if (short) return String(short);

  const full = card?.line?.full;
  if (full) return String(full).slice(0, 120);

  const title = card?.title || cardId;
  const focus = card?.focus ? `意識：${String(card.focus)}` : "";
  const action = card?.action ? `一手：${String(card.action)}` : "";

  return [`【${title}】`, focus, action].filter(Boolean).join("\n");
}

function buildTextLong(cardId, card, theme) {
  const long = card?.line?.long;
  const base =
    long
      ? String(long)
      : [
          "🌿 今日の整えワンポイント",
          "",
          card?.title ? `【カード】${card.title}` : `【カード】${cardId}`,
          card?.message ? String(card.message) : "",
          "",
          card?.focus ? `【意識すること】\n${String(card.focus)}` : "",
          "",
          card?.action ? `【今日の一手】\n${String(card.action)}` : "",
          "",
          "今日はここまででOKです🌙",
        ]
          .filter(Boolean)
          .join("\n");

  // テーマ別：有料導線を末尾に差し替え
  const paidUrl = theme === "work" ? PAID_URL_WORK : PAID_URL_LOVE;
  const paidLabel = theme === "work" ? "💼 仕事版（有料）はこちら" : "💗 恋愛版（有料）はこちら";

  return base + `\n\n${paidLabel}\n${paidUrl}`;
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
// ProLineへ書き戻し（fm）
// form12 の txt[...] に入れる
// --------------------
async function writeBackToProLine(uid, payloadObj) {
  const formId = process.env.PROLINE_FORM12_ID; // form12 のID（xBi34LzVvN）
  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");

  const fmBase = (process.env.PROLINE_FM_BASE || "https://l8x1uh5r.autosns.app/fm").replace(/\/$/, "");
  const url = `${fmBase}/${formId}`;

  // PHPサンプルに合わせて dataType=json を付ける（無害＆安定）
  const params = new URLSearchParams({ uid, dataType: "json" });

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
    // GETは動作確認用
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const theme = pickTheme(pasted);
      const cardId = pickCardId(pasted);

      const { card, from } = loadCard(cardId, theme);
      return res.status(200).json({
        ok: true,
        uid,
        theme,
        cardId,
        found: !!card,
        cardFrom: from,
        shortPreview: card ? buildTextShort(cardId, card) : "",
        longPreview: card ? buildTextLong(cardId, card, theme).slice(0, 180) : "",
      });
    }

    // POST（ProLine）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");

    // form11の貼り付け（txt[zeRq0T9Qo1]）を最優先で読む
    const pasted =
      String(body?.[FIELD_PASTED] || "") ||
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.pasted || "");

    const theme = pickTheme(pasted);
    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] theme:", theme);
    console.log("[tarot-love] pasted head:", String(pasted).slice(0, 160));
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    // card_idが無い
    if (!cardId) {
      const short =
        "🙏 うまく読み取れませんでした。\n" +
        "貼り付け文の中に「card_id:xxxx」が入っているか確認してください。";
      const long =
        short +
        "\n\n（例）\ncard_id:major_09\ncard_id:swords_07\n\nそのままコピーして貼るのが確実です🌿";

      const writeBack = await writeBackToProLine(uid, {
        [FIELD_SHORT]: short,
        [FIELD_LONG]: long,
      });

      return res.status(200).json({ ok: true, uid, theme, fallback: true, writeBack });
    }

    const { card, from } = loadCard(cardId, theme);
    console.log("[tarot-love] cardFrom:", from);

    if (!card) {
      const short =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";
      const long =
        short +
        "\n\n（原因例）\n・途中で文章が欠けた\n・card_idの行が消えた\n・余計な改行が入った";

      const writeBack = await writeBackToProLine(uid, {
        [FIELD_SHORT]: short,
        [FIELD_LONG]: long,
      });

      return res.status(200).json({ ok: true, uid, theme, cardId, found: false, writeBack });
    }

    // ✅ 本文生成（テーマ別）
    const shortText = buildTextShort(cardId, card);
    const longText = buildTextLong(cardId, card, theme);

    const writeBack = await writeBackToProLine(uid, {
      [FIELD_SHORT]: shortText,
      [FIELD_LONG]: longText,
    });

    return res.status(200).json({
      ok: true,
      uid,
      theme,
      cardId,
      found: true,
      major: isMajor(cardId),
      writeBack,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
