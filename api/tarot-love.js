export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // 疎通確認
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "tarot-love webhook alive" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const body = req.body || {};
  const uid = body.uid || "";
  const name = body.user_data?.linename || body.user_data?.snsname || "あなた";

  // ✅ ProLineフォームの回答欄（ここに「#整え続き\ncard_id:xxx」をコピペさせる想定）
  const pasted = body.form_data?.["form1-1"] || "";

  // card_id抽出（card_id:major_16 / card_id：major_16 どちらもOK）
  const m = String(pasted).match(/card_id\s*[:：=]\s*([a-z0-9_]+)/i);
  const cardId = m?.[1] || "";

  // ★ログ確認用（Vercel Logsで見える）
  console.log("uid:", uid);
  console.log("pasted:", pasted);
  console.log("cardId:", cardId);

  if (!cardId) {
    return res.status(200).json({
      ok: true,
      text:
        "カード情報が見つかりませんでした🙏\n\n" +
        "フォームに貼り付けた文章に\n" +
        "card_id:major_19 のような行が入っているか確認してね。"
    });
  }

  const msg = LOVE_MAP[cardId];

  if (!msg) {
    return res.status(200).json({
      ok: true,
      text:
        `受け取ってくれてありがとうございます🌿\n\n` +
        `でもこのカード（${cardId}）は、まだ“整えワンポイント”が未登録でした🙏\n` +
        `（たまみが順次追加します🌿）`
    });
  }

  // ✅ ProLineが拾いやすいように「text」で返す
  return res.status(200).json({
    ok: true,
    text:
      `受け取ってくれてありがとうございます🌿\n` +
      `${name}さんのカードに合わせて「整えの続きを」お届けします。\n\n` +
      `【今の恋】\n${msg.state}\n\n` +
      `【今日の整え】\n${msg.tip}\n\n` +
      `【ひとこと】\n${msg.one}\n`
  });
}

// ---- カード辞書（あなたの文章そのまま） ----
const LOVE_MAP = {
  major_19: {
    state: "堂々と受け取っていい流れ。隠すほど停滞します。",
    tip: "嬉しかった事実だけを、短文で伝える。",
    one: "気持ちは出してOK。関係を壊すカードではありません。"
  },
  major_18: {
    state: "不安が現実を歪めやすい時期。誤解が増えがち。",
    tip: "連絡は“確認”ではなく“共有”にする。",
    one: "試すLINEは逆効果。整えるだけで流れが戻ります。"
  },
  // ここに増やしていく
};
