// /api/tarot-love.js

export default function handler(req, res) {
  // ---- CORS ----
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  const q = req.query || {};
  const body = req.body || {};

  // ---- uid を拾う（ProLine payload想定）----
  const uid =
    q.uid ||
    body.uid ||
    body.user_data?.uid ||
    body.user_data?.user_id ||
    body.basic_id ||
    "";

  // ---- 受け取った本文（フォーム回答 or クエリ）----
  // 1) URLパラメータ pasted を最優先（完了ページURL方式）
  let pasted =
    q.pasted ||
    q.text ||
    q.message ||
    "";

  // 2) ProLineのform_dataから拾う（form11-1 を想定、無ければ form11-* を探索）
  const formData = body.form_data || {};
  if (!pasted) {
    pasted =
      formData["form11-1"] ||
      findFirstValueByPrefix(formData, "form11-") ||
      formData["form1-1"] || // もしテストで form1-1 になってても拾えるように
      "";
  }

  // ---- card_id 抜き出し ----
  const cardId = extractCardId(pasted);

  // ---- 応答文を作る ----
  const name = body.user_data?.linename || body.user_data?.snsname || "あなた";

  const reply = buildReplyText({ name, cardId });

  // ---- HTML表示モード（完了ページで見せる用）----
  const renderHtml = q.render === "1" || q.render === "html" || acceptsHtml(req);

  if (renderHtml) {
    return res.status(200).send(renderHtmlPage({ name, uid, cardId, reply, pasted }));
  }

  // ---- JSON（デバッグ/他連携用）----
  return res.status(200).json({
    ok: true,
    uid,
    card_id: cardId || null,
    reply_text: reply,
    pasted: pasted || null,
    note: "ProLineの『外部送信』は返答を自動返信しません。完了ページURLで render=1 を使うのが確実です。",
  });
}

// ---------------- helpers ----------------

function extractCardId(text) {
  if (!text) return "";
  // card_id:major_16 / card_id=major_16 / card_id：major_16 など許容
  const m = String(text).match(/card_id\s*[:=： ]\s*([a-zA-Z0-9_]+)/);
  return m ? m[1] : "";
}

function findFirstValueByPrefix(obj, prefix) {
  for (const k of Object.keys(obj || {})) {
    if (k.startsWith(prefix)) {
      const v = obj[k];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return "";
}

function acceptsHtml(req) {
  const a = req.headers?.accept || "";
  return String(a).includes("text/html");
}

// ---- ここが「カード辞書」：増やす場所 ----
const LOVE_MAP = {
  major_19: {
    state: "堂々と受け取っていい流れ。隠すほど停滞します。",
    tip: "嬉しかった事実だけを、短文で伝える。",
    one: "気持ちは出してOK。関係を壊すカードではありません。",
  },
  major_18: {
    state: "不安が現実を歪めやすい時期。誤解が増えがち。",
    tip: "連絡は“確認”ではなく“共有”にする。",
    one: "試すLINEは逆効果。整えるだけで流れが戻ります。",
  },
  major_16: {
    state: "揺れはリセットの合図。崩れたように見えて整う前段階。",
    tip: "反射LINEを送らず、まず深呼吸→文章は一晩寝かせる。",
    one: "壊れたのではなく“調律中”。焦らないほど戻ります。",
  },
  major_13: {
    state: "形を変える準備段階。終わりは“更新”のサイン。",
    tip: "今までのやり方を1つ終わらせる（追う/確かめる/我慢など）。",
    one: "終わり＝縁切りではありません。整う形へ移行中です。",
  },

  // 例：小アルカナ
  cups_06: {
    state: "懐かしさや過去の縁が動きやすい。連絡再開の兆し。",
    tip: "重い話題は避け、共通の話題を1つだけ送る。",
    one: "昔に戻すより“今の距離で再接続”がうまくいきます。",
  },
  swords_04: {
    state: "休止・距離調整。返信が遅いのは回復時間の可能性。",
    tip: "追わずに生活を整える（睡眠/食事/予定を先に）。",
    one: "一旦休むのが正解の時があります。焦らないでOK。",
  },
};

function buildReplyText({ name, cardId }) {
  if (!cardId) {
    return (
      `カード情報が見つかりませんでした🙏\n\n` +
      `送る文章にこの行が入っているか確認してください。\n` +
      `card_id:major_19`
    );
  }

  const m = LOVE_MAP[cardId];

  if (!m) {
    return (
      `受け取ってくれてありがとうございます🌿\n\n` +
      `${name}さんのカード（${cardId}）の“整えワンポイント”は、まだ準備中です。\n` +
      `（順次追加します🌙）`
    );
  }

  return (
    `受け取ってくれてありがとうございます🌿\n` +
    `${name}さんのカードに合わせて、“整えの続きを”お届けします。\n\n` +
    `【今の恋】\n${m.state}\n\n` +
    `【今日の整え】\n${m.tip}\n\n` +
    `【ひとこと】\n${m.one}\n`
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderHtmlPage({ name, uid, cardId, reply, pasted }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>整えの続き</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Sans","Noto Sans JP",sans-serif;margin:0;background:#0b1020;color:#fff;}
  .wrap{max-width:760px;margin:0 auto;padding:22px;}
  .card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px;line-height:1.7;}
  .title{font-size:18px;font-weight:800;margin:0 0 10px;}
  .meta{opacity:.8;font-size:12px;margin:0 0 12px;}
  pre{white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,.25);padding:12px;border-radius:12px;margin:0;}
  .small{opacity:.7;font-size:12px;margin-top:12px;}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <p class="title">整えの続き 🌿</p>
      <p class="meta">name: ${escapeHtml(name)} / uid: ${escapeHtml(uid)} / card_id: ${escapeHtml(cardId || "-")}</p>
      <pre>${escapeHtml(reply)}</pre>
      <p class="small">（受け取った本文）</p>
      <pre>${escapeHtml(pasted || "(なし)")}</pre>
    </div>
  </div>
</body>
</html>`;
}
