export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const LOVE_MAP = {
    "major_19": {
      state: "堂々と受け取っていい流れ。隠すほど停滞します。",
      tip: "嬉しかった事実だけを短文で伝える。",
      cta: "気持ちは出してOK。関係を壊すカードではありません。"
    },
    "major_18": {
      state: "不安が現実を歪めやすい時期。誤解が増えがち。",
      tip: "連絡は“確認”ではなく“共有”にする。",
      cta: "試すLINEは逆効果。整えるだけで流れが戻ります。"
    }
  };

  // GETでもPOSTでも受け取れるようにする（テストが楽）
  const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const cardId = payload.card_id || payload.cardId || payload.id;

  // デバッグ用：何が来たか返す（最初だけ）
  // ※動いたら消してOK
  // res.status(200).json({ received: payload, cardId });

  if (!cardId) {
    return res.status(200).json({ text: "card_id が未指定です🙏（例: major_19）", received: payload });
  }

  const hit = LOVE_MAP[cardId];
  if (!hit) {
    return res.status(200).json({ text: `カードが見つかりませんでした🙏 (${cardId})`, received: payload });
  }

  const text =
`${hit.state}

【今日の整え】
${hit.tip}

【ひとこと】
${hit.cta}`;

  return res.status(200).json({ text });
}
