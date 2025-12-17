// api/tarot-love.js
// ProLine Form11 -> Vercel -> ProLine Form12(form12-1) writeback -> beacon -> scenario "返信本文"

export default async function handler(req, res) {
  try {
    const FM_BASE = (process.env.PROLINE_FM_BASE || "https://autosns.me/fm").replace(/\/$/, "");
    const FORM12_ID = process.env.PROLINE_FORM12_ID;
    const FORM12_FIELD = process.env.PROLINE_FORM12_FIELD || "form12-1";
    const BEACON_ID = process.env.PROLINE_BEACON_ID;

    if (!FORM12_ID) throw new Error("Missing env PROLINE_FORM12_ID");
    if (!BEACON_ID) throw new Error("Missing env PROLINE_BEACON_ID");

    // ProLineはフォーム送信時に JSON をPOSTしてくる想定
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { /* ignore */ }
    }

    const uid = body?.uid || body?.user_data?.uid || body?.user?.uid;
    const formData = body?.form_data || {};
    // form11 の入力はだいたい "form11-1" に入る（あなたの画面どおり）
    const pasted = formData["form11-1"] || formData["form11_1"] || body?.pasted || "";

    // card_id を本文から抽出（ユーザーには見せない）
    // 例: "card_id:major_19"
    const cardMatch = String(pasted).match(/card_id\s*:\s*([a-z0-9_]+)/i);
    const cardId = body?.cardId || body?.card_id || (cardMatch ? cardMatch[1] : "");

    if (!uid) {
      return res.status(400).json({ ok: false, error: "uid is missing", received: body });
    }

    // ===== ここが「生成」部分（今は簡易テンプレ。後でここにLLMを入れてOK） =====
    const replyText = buildReplyText({ pasted, cardId });

    // ===== ProLine form12 に書き戻す（form12-1 に全文）=====
    const writeBackResult = await writeBackToProLineForm({
      fmBase: FM_BASE,
      formId: FORM12_ID,
      uid,
      fieldName: FORM12_FIELD,
      value: replyText,
    });

    // ===== 返信本文シナリオへ移動（ビーコン）=====
    const beaconResult = await callBeacon({ beaconId: BEACON_ID, uid });

    return res.status(200).json({
      ok: true,
      uid,
      cardId,
      writeBack: writeBackResult,
      beacon: beaconResult,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

function buildReplyText({ pasted, cardId }) {
  // cardIdが無いときでも、ユーザーにcard_idを要求しない（綺麗に）
  // → 代わりに「もう一度ボタン」などの案内にするのがプロダクト的に正解
  if (!cardId) {
    return [
      "🙏 今回はカード情報の取得に失敗しました。",
      "",
      "お手数ですが、もう一度「タロット結果」を送信してください。",
      "（同じ内容でOKです）",
    ].join("\n");
  }

  // ここはあなたの世界観に合わせて後でいくらでも差し替え可能
  // まずは「整えワンポイント」系の短文テンプレを返す
  return [
    "🌿 今日の整えワンポイント",
    "",
    "今は、",
    "・無理に動かそうとしないこと",
    "・気持ちを整理すること",
    "",
    "この2つを意識するだけで、",
    "関係の流れは静かに整っていきます。",
    "",
    "（必要な方には、この先の整え方もお届けできます）",
  ].join("\n");
}

async function writeBackToProLineForm({ fmBase, formId, uid, fieldName, value }) {
  const url = `${fmBase}/${formId}`;
  const form = new URLSearchParams();
  form.set("uid", uid);
  form.set("dataType", "json");
  form.set(fieldName, value);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: form.toString(),
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`writeBack failed: ${resp.status} ${text}`);
  }
  return { status: resp.status, body: safeJson(text) ?? text };
}

async function callBeacon({ beaconId, uid }) {
  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const resp = await fetch(url, { method: "GET" });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`beacon failed: ${resp.status} ${text}`);
  }
  return { status: resp.status, body: safeJson(text) ?? text };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
