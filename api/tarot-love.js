// pages/api/tarot-love.js
export default async function handler(req, res) {
  try {
    // ProLine→Vercelはサーバ間POSTなのでCORSは基本不要（残してもOK）
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    // 疎通確認
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, message: "tarot-love alive" });
    }
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "POST only" });
    }

    const body = req.body || {};
    const uid = body.uid || "";
    const name = body.user_data?.linename || body.user_data?.snsname || "あなた";

    // ✅ ProLineフォーム(form11)回答本文（あなたのpayload形に合わせてここが最重要）
    const pasted = body.form_data?.["form11-1"] || body.form_data?.["form1-1"] || "";
    const cardId = extractCardId(pasted);

    console.log("uid:", uid);
    console.log("pasted:", pasted);
    console.log("cardId:", cardId);

    if (!uid) {
      return res.status(200).json({ ok: true, note: "no uid (ignore)" });
    }
    if (!cardId) {
      // card_idがない場合でも、ユーザーにフォーム12へ返す文章を入れてシナリオ誘導するならここで作る
      const fallback =
        `カード情報が見つかりませんでした🙏\n\n` +
        `送る文章にこの行が入っているか確認してください。\n` +
        `card_id:major_19`;

      await writeBackToProLineForm12(uid, name, fallback);
      await moveScenarioByBeacon(uid);

      return res.status(200).json({ ok: true });
    }

    // ✅ 返信文を生成（辞書はここに増やす）
    const reply = buildReplyText(name, cardId);

    // ✅ 1) form12 に返信文を書き込む（外部からフォーム登録）
    await writeBackToProLineForm12(uid, name, reply);

    // ✅ 2) ビーコンで「返信本文」シナリオへ移動 → シナリオ内で [[form12-1]] を送信
    await moveScenarioByBeacon(uid);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

// --- card_id 抜き出し（全角：や空白/改行にも強くする） ---
function extractCardId(text) {
  if (!text) return "";
  const m = String(text).match(/card_id\s*[:：= ]\s*([a-zA-Z0-9_]+)/i);
  return m ? m[1] : "";
}

// --- 返信文生成（サンプル。辞書を増やしてOK） ---
function buildReplyText(name, cardId) {
  const LOVE = {
    "major_19": "🌞太陽\n今の恋：堂々と受け取っていい流れ。\n今日の整え：嬉しかった事実だけ短文で。\nひとこと：気持ちは出してOK。",
    "major_16": "⚡塔\n今の恋：揺れはリセットの合図。\n今日の整え：反射LINEを送らない。\nひとこと：壊れたように見えて、実は正位置。",
    "swords_14": "🗡️ソード14（※仮）\n今の恋：整えるポイントが見えています。\n今日の整え：まず感情の棚卸し。\nひとこと：急がず、順序で整う。"
  };

  const body = LOVE[cardId] || `（未登録のカードです）\ncard_id:${cardId}\n※辞書に追加してください`;

  return (
    `受け取ってくれてありがとうございます🌿\n` +
    `${name}さんのカードに合わせて、整えの続きをお届けします。\n\n` +
    body
  );
}

// --- ProLine: form12 に書き込む ---
async function writeBackToProLineForm12(uid, name, replyText) {
  const form12Id = process.env.PROLINE_FORM12_ID; // xBi34LzVvN
  if (!form12Id) throw new Error("Missing env PROLINE_FORM12_ID");

  // ProLine公式サンプル(sendform.php)が叩いているエンドポイントに合わせる
  const url = `https://autosns.me/fm/${form12Id}`;

  const params = new URLSearchParams();
  params.set("uid", uid);
  params.set("dataType", "json");
  // form12-1 に返信文
  params.set("form12-1", replyText);
  // もし名前なども入れたいなら自由に追加可能（フォーム側に項目があれば）
  // params.set("sei", name);

  const r = await fetch(url, { method: "POST", body: params });
  const t = await r.text();
  console.log("writeBack status:", r.status, "body:", t);
  if (!r.ok) throw new Error(`writeBack failed: ${r.status}`);
}

// --- ProLine: ビーコンでシナリオ移動（=返信本文へ） ---
async function moveScenarioByBeacon(uid) {
  const beaconId = process.env.PROLINE_BEACON_ID; // LG9OE8jlWD
  if (!beaconId) throw new Error("Missing env PROLINE_BEACON_ID");

  const url = `https://autosns.jp/api/call-beacon/${beaconId}/${encodeURIComponent(uid)}`;
  const r = await fetch(url, { method: "GET" });
  const t = await r.text();
  console.log("beacon status:", r.status, "body:", t);
  if (!r.ok) throw new Error(`beacon failed: ${r.status}`);
}
