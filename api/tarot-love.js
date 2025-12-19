// /api/tarot-love.js
const fs = require("fs");
const path = require("path");
const qs = require("querystring");

// --------------------
// helpers
// --------------------
function pickCardId(pasted) {
  if (!pasted) return "";
  const m = String(pasted).match(/card_id\s*[:=]\s*([A-Za-z0-9_]+)/);
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
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

/**
 * cards 置き場の候補を複数試す（運用中でも崩れにくい）
 * 推奨:
 *   /cards/major/major_00.json
 *   /cards/minor/swords_09.json
 */
function loadCard(cardId) {
  const cwd = process.cwd();
  const suit = detectSuit(cardId);

  const candidates = [
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

function buildCp21Url(uid) {
  // cp21は free1 を表示するだけにしたので、uid だけでOK
  const base = "https://l8x1uh5r.autosns.app/cp/bYnEXcWDaC";
  return `${base}?uid=${encodeURIComponent(uid)}`;
}

// --- 文面生成 ---
function buildTextForCp21(card, cardId) {
  // cp21に表示する「完成本文」（free1に入れる）
  const title = card?.title || cardId;
  const msg = card?.cp21?.message || card?.message || "";
  const focus = card?.cp21?.focus || card?.focus || "";
  const action = card?.cp21?.action || card?.action || "";
  const closing = card?.cp21?.closing || "今日はここまでで大丈夫です🌙";

  return [
    `🌿 ${title}`,
    "",
    msg,
    "",
    "【意識すること】",
    focus,
    "",
    "【今日の一手】",
    action,
    "",
    closing,
  ].join("\n");
}

function buildLineTextMajor(card, uid) {
  // LINEに返すのは軽く、読むのはcp21
  const light =
    card?.line?.light ||
    `🌿今日は「${card?.cp21?.focus || card?.focus || "整え"}」を受け取る日。`;

  const url = buildCp21Url(uid);

  return [light, "", "読む（結果ページ）👇", url].join("\n");
}

function buildLineTextMinor(card, cardId) {
  // 小アルカナ：LINE完結
  const full = card?.line?.full;
  if (full) return full;

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
  ].filter(Boolean).join("\n");
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
// ProLine writeback / beacon
// --------------------
async function writeBack(uid, field, value) {
  const fmBase = process.env.PROLINE_FM_BASE || "https://autosns.me/fm";
  const formId = process.env.PROLINE_FORM_ID; // ★ form11に統一するならここに Dj4HaOm6hI を入れる
  if (!formId) throw new Error("Missing env PROLINE_FORM_ID");

  const url = `${fmBase.replace(/\/$/, "")}/${formId}`;
  const body = new URLSearchParams({ uid, [field]: value }).toString();

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json, url, field };
}

async function callBeacon(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID;
  if (!beaconId) throw new Error("Missing env PROLINE_BEACON_ID");

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, body: json, url };
}

// --------------------
// handler
// --------------------
module.exports = async (req, res) => {
  try {
    const body = await readBody(req);

    const uid = String(body?.uid || req.query?.uid || "");
    const pasted =
      String(body?.["form_data[form11-1]"] || "") ||
      String(body?.["form_data[form12-1]"] || "") ||
      String(body?.["form11-1"] || "") ||
      String(body?.["form12-1"] || "") ||
      String(body?.pasted || "");

    const cardId = pickCardId(pasted);

    console.log("[tarot-love] uid:", uid);
    console.log("[tarot-love] pasted:", pasted);
    console.log("[tarot-love] cardId:", cardId);

    if (!uid) return res.status(200).json({ ok: true, skipped: true, reason: "uid missing" });

    const CP21_FIELD = process.env.PROLINE_CP21_FIELD || "free1"; // ★ free1
    const LINE_FIELD = process.env.PROLINE_LINE_FIELD || "free2"; // ★ free2

    if (!cardId) {
      const fallback =
        "🙏 うまく読み取れませんでした。\n" +
        "フォームに貼り付ける文章に、この1行が入っているか確認してください👇\n" +
        "card_id:xxxx";

      const wb = await writeBack(uid, LINE_FIELD, fallback);
      const beacon = await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, fallback: true, wb, beacon });
    }

    const { card, from } = loadCard(cardId);
    if (!card) {
      const notFound =
        "🙏 カード情報が見つかりませんでした。\n" +
        "もう一度「今日のワンカード」で引き直して、表示された文章をそのまま貼り付けてください🌿";

      const wb = await writeBack(uid, LINE_FIELD, notFound);
      const beacon = await callBeacon(uid);
      return res.status(200).json({ ok: true, uid, cardId, found: false, from, wb, beacon });
    }

    // --- 大アルカナ ---
    if (isMajor(cardId)) {
      const cp21Text = buildTextForCp21(card, cardId);      // free1へ
      const lineText = buildLineTextMajor(card, uid);       // free2へ

      const wb1 = await writeBack(uid, CP21_FIELD, cp21Text);
      const wb2 = await writeBack(uid, LINE_FIELD, lineText);
      const beacon = await callBeacon(uid);

      console.log("[tarot-love] major from:", from);
      console.log("[tarot-love] major writeBack cp21:", wb1.status, wb1.field);
      console.log("[tarot-love] major writeBack line:", wb2.status, wb2.field);
      console.log("[tarot-love] beacon:", beacon.status);

      return res.status(200).json({ ok: true, uid, cardId, major: true, from, wb1, wb2, beacon });
    }

    // --- 小アルカナ（人物カードもここに入ります：page/knight/queen/king もminor扱い） ---
    const lineText = buildLineTextMinor(card, cardId);
    const wb = await writeBack(uid, LINE_FIELD, lineText);
    const beacon = await callBeacon(uid);

    console.log("[tarot-love] minor from:", from);
    console.log("[tarot-love] minor writeBack line:", wb.status, wb.field);
    console.log("[tarot-love] beacon:", beacon.status);

    return res.status(200).json({ ok: true, uid, cardId, major: false, from, wb, beacon });
  } catch (e) {
    console.error("[tarot-love] ERROR:", e);
    return res.status(200).json({ ok: false, error: String(e?.message || e) });
  }
};
