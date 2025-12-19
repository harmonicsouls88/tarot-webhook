// /api/tarot-love.js
// - 小アルカナ：LINE完結（free2）
// - 大アルカナ：cp21で読む（free1に長文を保存）＋LINEは軽い案内（free2）
//
// 必須ENV:
//   PROLINE_FORM12_ID        : FMのID（例: xBi34LzVvN）
//   PROLINE_FORM12_FIELD     : 既定の書き込み先（推奨: user_data[free2] = LINE吹き出し用）
//   PROLINE_BEACON_ID        : Beacon ID
//
// 追加でおすすめ（任意）:
//   PROLINE_CP21_FIELD       : cp21用の書き込み先（推奨: user_data[free1]）
//   PROLINE_LINE_FIELD       : LINE用の書き込み先（推奨: user_data[free2]）
//
// cards配置（推奨）:
//   /cards/major/major_00.json
//   /cards/minor/swords_09.json
// 互換:
//   /cards/major_00.json
//   /cards/swords_09.json
//   /cards/swords/swords_09.json なども拾います

const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  const s = String(pasted);
  // card_id:major_20 / card_id=major_20 / card_id : major_20
  const m = s.match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
  return m?.[1] ?? "";
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
  if (!p) return null;
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * cards 置き場の候補を複数試す（運用中でも崩れにくい）
 */
function loadCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
    // 推奨
    path.join(cwd, "cards", "major", `${cardId}.json`),
    path.join(cwd, "cards", "minor", `${cardId}.json`),

    // 互換（フォルダ分けしてない場合）
    path.join(cwd, "cards", `${cardId}.json`),

    // さらに互換（suitごとに分けている場合）
    suit ? path.join(cwd, "cards", suit, `${cardId}.json`) : null,
  ].filter(Boolean);

  for (const p of candidates) {
    const j = readJsonIfExists(p);
    if (j) return { card: j, from: p };
  }
  return { card: null, from: candidates };
}

// cp21 URL（uidだけでOKにするのが最強）
function buildCp21Url(uid) {
  const base = "https://l8x1uh5r.autosns.app/cp/bYnEXcWDaC";
  return uid ? `${base}?uid=${encodeURIComponent(uid)}` : base;
}

// 小アルカナ（LINE完結）
function buildTextForLine(cardId, card) {
  // 新フォーマットがあるなら最優先
  const full = card?.line?.full;
  if (full) return String(full);

  // 互換：旧フォーマットから組み立て
  const title = card?.title ? `【カード】${card.title}` : `【カード】${cardId}`;
  const msg = card?.message ? String(card.message) : "";
  const focus = card?.focus ? `【意識すること】${card.focus}` : "";
  const action = card?.action ? `【今日の一手】${card.action}` : "";

  return [
    "🌿 今日の整えワンポイント",
    "",
    title,
    msg,
    "",
    focus,
    action,
  ]
    .filter(Boolean)
    .join("\n");
}

// 大アルカナ（cp21で読む＝free1に保存する長文）
function buildTextForCp21(card) {
  // card.cp21 があるならそれを使う（推奨）
  const t = card?.title || "";
  const msg =
    (card?.cp21 && card.cp21.message) ||
    card?.message ||
    "";
  const focus =
    (card?.cp21 && card.cp21.focus) ||
    card?.focus ||
    "";
  const action =
    (card?.cp21 && card.cp21.action) ||
    card?.action ||
    "";
  const closing =
    (card?.cp21 && card.cp21.closing) ||
    "今日はここまでで大丈夫です🌙";

  return [
    `🌿 ${t}`,
    "",
    String(msg).trim(),
    "",
    "【意識すること】",
    String(focus).trim(),
    "",
    "【今日の一手】",
    String(action).trim(),
    "",
    String(closing).trim(),
  ]
    .filter((v) => v !== "")
    .join("\n");
}

// 大アルカナ：LINEは軽い案内（free2）
function buildMajorLineText(card, uid) {
  const focus = card?.focus || (card?.cp21 && card.cp21.focus) || "整え";
  const cp21 = buildCp21Url(uid);
  const light =
    card?.line?.light ||
    `🌿今日はこのテーマ：${focus}`;

  return [
    light,
    "",
    "続き（読む）はこちら👇",
    cp21,
    "",
    "※何度も引き直さなくて大丈夫。今日のテーマを1つだけ受け取ればOKです。",
  ].join("\n");
}

async function readBody(req) {
  // Vercel Node Function では req.body が object / string / undefined のことがあるので吸収する
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return qs.parse(req.body);

  // bodyが取れない場合に備えてストリームから読む
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return qs.parse(raw);
}

// ProLineへ書き戻し（FM）
async function writeBackToProLine(uid, text, fieldOverride) {
  const formId = process.env.PROLINE_FORM12_ID;
  const defaultField = process.env.PROLINE_FORM12_FIELD; // 既定（推奨：LINE用 free2）
  const field = fieldOverride || defaultField;

  if (!formId) throw new Error("Missing env PROLINE_FORM12_ID");
  if (!field) throw new Error("Missing env PROLINE_FORM12_FIELD (or override)");

  const url = `https://autosns.me/fm/${formId}`;
  const body = new URLSearchParams({
    uid,
    [field]: text,
  }).toString();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json, field };
}

// Beaconで送信
async function callBeacon(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID;
  if (!beaconId) throw new Error("Missing env PROLINE_BEACON_ID");

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    // GETはテスト用（ブラウザで card_id 直接渡せる）
    if (req.method === "GET") {
      const uid = String(req.query?.uid || "test");
      const pasted = String(req.query?.pasted || "");
      const cardId = pickCardId(pasted);

      const { card, from } = loadCard(cardId);

      const preview = card
        ? isMajor(cardId)
          ? buildTextForCp21(card).slice(0, 140)
          : buildTextForLine(cardId, card).slice(0, 140)
        : "";

      return res.status(200).json({
        ok: true,
        uid,
        pasted,
        cardId,
        found: !!card,
        cardFrom: from,
        preview,
      });
    }

    // POST（ProLine webhook）
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");

    // ProLine形式: form_data[form11-1] など
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      // 互換
      String(body?.["form11-1"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });
    }

    // どこに書くか（推奨）
    const CP21_FIELD = process.env.PROLINE_CP21_FIELD || "user_data[free1]";
    const LINE_FIELD = process.env.PROLINE_LINE_FIELD || process.env.PROLINE_FORM12_FIELD || "user_data[free2]";

    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";

      await writeBackToProLine(uid, fallback, LINE_FIELD);
      const beacon = await callBeacon(uid);

      return res.status(200).json({ ok: true, uid, cardId: "", fallback: true, beacon });
    }

    const { card, from } = loadCard(cardId);

    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";

      await writeBackToProLine(uid, notFound, LINE_FIELD);
      const beacon = await callBeacon(uid);

      return res.status(200).json({ ok: true, uid, cardId, found: false, from, beacon });
    }

    // --------------------
    // 大アルカナ：free1 にcp21本文、free2 に短文案内
    // --------------------
    if (isMajor(cardId)) {
      const cp21Text = buildTextForCp21(card);
      const lineText = buildMajorLineText(card, uid);

      const wb1 = await writeBackToProLine(uid, cp21Text, CP21_FIELD);
      const wb2 = await writeBackToProLine(uid, lineText, LINE_FIELD);
      const beacon = await callBeacon(uid);

      console.log("[tarot-love] major writeBack cp21:", wb1.status, wb1.field);
      console.log("[tarot-love] major writeBack line:", wb2.status, wb2.field);
      console.log("[tarot-love] beacon:", beacon.status);

      return res.status(200).json({
        ok: true,
        uid,
        cardId,
        major: true,
        from,
        writeBackCp21: wb1,
        writeBackLine: wb2,
        beacon,
      });
    }

    // --------------------
    // 小アルカナ：LINE完結（free2）
    // --------------------
    const lineText = buildTextForLine(cardId, card);
    const writeBack = await writeBackToProLine(uid, lineText, LINE_FIELD);
    const beacon = await callBeacon(uid);

    console.log("[tarot-love] minor writeBack:", writeBack.status, writeBack.field);
    console.log("[tarot-love] beacon:", beacon.status);

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      major: false,
      from,
      writeBack,
      beacon,
    });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
