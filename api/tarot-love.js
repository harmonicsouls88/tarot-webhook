export default function handler(req, res) {
  // CORS（ProLineから叩く時に必要になることが多い）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // --- 1) 入力を集める（GET/POSTどちらでも動くように） ---
  const q = req.query || {};
  const body = req.body || {};

  // ProLineっぽいpayloadも想定（uid / user_data / form_data / message など）
  const uid =
    q.uid ||
    body.uid ||
    body.user_data?.uid ||
    body.basic_id ||
    body.user_data?.basic_id ||
    "";

  // 「ユーザーが送った本文」候補をできるだけ拾う
  const incomingText =
    q.text ||
    q.message ||
    body.text ||
    body.message ||
    body.chat?.text ||
    body.chat?.message ||
    body.event_data?.message ||
    body.event_data?.text ||
    body.form_data?.["form1-1"] || // もしフォームに入れてたらここ
    "";

  // card_id を本文から抜く（例: card_id:major_16）
  const cardId = extractCardId(incomingText) || (q.card_id || q.cardId || body.card_id || body.cardId || "");

  // 疎通確認用（ブラウザで開いた時に分かりやすい）
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      uid,
      card_id: cardId || null,
      note: "GET is for debug. Use POST from ProLine for production.",
      example_send: {
        text: "#整え続き\ncard_id:major_19"
      }
    });
  }

  // --- 2) 返す文章を作る ---
  if (!cardId) {
    return res.status(200).json({
      text: "カードIDが見つかりませんでした🙏\n\nコピペはこの形で送ってください。\n#整え続き\ncard_id:major_19"
    });
  }

  const msg = LOVE_MAP[cardId] || null;
  if (!msg) {
    return res.status(200).json({
      text: `そのカード（${cardId}）の“整えワンポイント”がまだ登録されていません🙏\n\n（たまみが順次追加します🌿）`
    });
  }

  // ProLine側が {text:"..."} を期待している動きに合わせる
  return res.status(200).json({
    text:
      `受け取ってくれてありがとうございます🌿\n` +
      `あなたのカードに合わせて、今の恋を“整えるためのワンポイント”をお届けします。\n\n` +
      `【今の恋】\n${msg.state}\n\n` +
      `【今日の整え】\n${msg.tip}\n\n` +
      `【ひとこと】\n${msg.one}\n`
  });
}

// --- card_id 抜き出し ---
function extractCardId(text) {
  if (!text) return "";
  // card_id:major_16 / card_id：major_16 / card_id major_16 など許容
  const m = String(text).match(/card_id\s*[:： ]\s*([a-zA-Z0-9_]+)/);
  return m ? m[1] : "";
}

// --- ここに「カード別ワンポイント」を登録する ---
// まずは「恋愛で出やすい12枚」＋ カップ/ソード（A〜10, コート）を収録
const LOVE_MAP = {
  // ===== 大アルカナ（恋愛で出やすい12） =====
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
  major_06: {
    state: "気持ちは通じているが、決断はまだ先。",
    tip: "白黒を迫らず、会える形を1つだけ提示。",
    one: "選ばせるより、安心できる“場”を。"
  },
  major_04: {
    state: "相手は立場や責任を意識しています。",
    tip: "感情ではなく“事実ベース”で話す。",
    one: "不倫・年上関係ほど、感情より構造調整が効きます。"
  },
  major_03: {
    state: "受け取る準備が整っています。",
    tip: "与えすぎを1つやめる。",
    one: "尽くしすぎは縁を重くします。"
  },
  major_11: {
    state: "バランス調整のタイミング。",
    tip: "自分だけ我慢している点を書き出す。",
    one: "不公平感が続くなら、整え直しが必要。"
  },
  major_17: {
    state: "ゆっくりだが回復方向。",
    tip: "未来の話より、今日を軽くする。",
    one: "信じる＝待つ、ではありません。"
  },
  major_14: {
    state: "今は混ぜ合わせる段階。",
    tip: "距離を詰めすぎない。",
    one: "ツイン関係は“中庸”が最短ルート。"
  },
  major_15: {
    state: "執着が連絡頻度を乱しています。",
    tip: "相手のSNSを見ない時間を作る。",
    one: "縁は“切る”より“緩める”。"
  },
  major_16: {
    state: "揺れはリセットの合図。",
    tip: "反射LINEを送らない。",
    one: "壊れたように見えて、実は正位置。"
  },
  major_13: {
    state: "形を変える準備段階。",
    tip: "今までのやり方を1つ終わらせる。",
    one: "終わり＝縁切りではありません。"
  },
  major_21: {
    state: "一区切りが近い。",
    tip: "望む関係を言語化する。",
    one: "完成は“受け取り方”で決まります。"
  },

  // ===== カップ A〜10 =====
  cups_01: { state: "気持ちは動く。連絡の“入口”が開く。", tip: "短く、温度のある一言だけ送る。", one: "複雑恋愛ほど「軽い嬉しさ」が突破口。" },
  cups_02: { state: "相互の好意あり。会う話が現実になりやすい。", tip: "「いつ空いてる？」より「◯日どう？」で具体化。", one: "曖昧に引っ張らないのが吉。" },
  cups_03: { state: "やり取りは増えるが、周囲要因も混ざる。", tip: "恋の話より“日常の共有”を増やす。", one: "不倫・ツインは「関係の場」を整えると安定。" },
  cups_04: { state: "相手の気持ちが停滞。あなたも疲れが出やすい。", tip: "追いLINEはしない。自分の予定を先に埋める。", one: "止まってる時は、動かすより“重さを抜く”。" },
  cups_05: { state: "失望・不安が強く出る。過去に引っ張られる。", tip: "「良かった事実」を1つだけ思い出す。", one: "修復は可能。ただ“責め”は連絡を遠ざける。" },
  cups_06: { state: "過去の縁・懐かしさが動く。連絡再開が起きやすい。", tip: "重い話題は避け、共通の話題を1つだけ。", one: "復縁・ツインは「昔に戻る」より「今の距離で再接続」。"},
  cups_07: { state: "迷い・期待過多。選択肢に振り回されがち。", tip: "妄想を止め、事実だけを書き出す。", one: "曖昧関係ほど、幻想を減らすと現実が動く。" },
  cups_08: { state: "気持ちはあるが、この形に限界を感じ始めている。", tip: "「我慢していること」を1つやめる。", one: "離れる＝縁切りではない。距離調整のカード。" },
  cups_09: { state: "望みは叶いやすい。ただし“条件付き”。", tip: "欲しい結果を1つに絞る。", one: "全部欲しがると、連絡も会うも遠のく。" },
  cups_10: { state: "感情面は満たされる流れ。安心感が戻る。", tip: "「安心できた瞬間」を言葉にする。", one: "不倫・ツインでも、心が安定すると現実が整う。" },

  // ===== カップ コート =====
  cups_page: { state: "好意はあるが不安定。気分で連絡が変わりやすい。", tip: "重い話はせず、軽いリアクションに留める。", one: "追うほど逃げる。安心が育つ距離が必要。" },
  cups_knight:{ state: "ロマンチックだが波がある。甘い言葉は出る。", tip: "期待値を上げすぎない。", one: "ツイン系に多い。現実の行動を見て判断。" },
  cups_queen: { state: "相手は感情深く、あなたに安心を求めている。", tip: "聞き役に回りすぎない。", one: "受け止めすぎは縁を重くする。" },
  cups_king:  { state: "感情は安定。ただし本音は見せにくい。", tip: "感謝を事実ベースで伝える。", one: "不倫・年上関係に多い。尊重が鍵。" },

  // ===== ソード A〜10 =====
  swords_01: { state: "状況がクリアになる。決断・線引きが必要。", tip: "曖昧な期待をやめ、条件を1つ言語化。", one: "複雑恋愛ほど「現実のルール作り」が効く。" },
  swords_02: { state: "様子見・保留。決めきれない。", tip: "「待つ」ではなく“期限”を自分で決める。", one: "決めない＝停滞。自分側の軸から動かす。" },
  swords_03: { state: "心が痛い局面。言葉が刺さりやすい。", tip: "反射で返さず、1日置く。", one: "切るより冷却。修復の余地は残す。" },
  swords_04: { state: "休止・距離調整。返信が遅いのは“回復時間”。", tip: "追わず、生活を整える（睡眠/食事/予定）。", one: "不倫・ツインは「一旦休む」が正解の時がある。" },
  swords_05: { state: "意地・勝ち負けが出る。揉めやすい。", tip: "“正しさ”より“関係が続く言い方”を選ぶ。", one: "勝っても失うカード。引く強さが現実を守る。" },
  swords_06: { state: "状況は少しずつ好転。距離や環境が変わる兆し。", tip: "感情整理を優先し、無理に結論を出さない。", one: "複雑恋愛は「場所・時間」を変えると流れが動く。" },
  swords_07: { state: "本音を隠している、または隠されている可能性。", tip: "疑う前に、確認しない選択をする。", one: "探らない強さが、逆に信頼を呼ぶ。" },
  swords_08: { state: "自分で制限をかけている。「動けない」は思い込み。", tip: "できない理由ではなく、できる行動を1つ探す。", one: "ツイン・不倫ほど“自分側の制限解除”が鍵。" },
  swords_09: { state: "不安・後悔が膨らみやすい。考えすぎ注意。", tip: "夜のスマホ時間を減らす。", one: "連絡が来ない夜ほど、休む勇気を。" },
  swords_10: { state: "一度どん底を見る流れ。だが回復は目前。", tip: "終わった前提で、明日の予定を立てる。", one: "完全な終わりではなく「底打ち」。" },

  // ===== ソード コート =====
  swords_page: { state: "様子見・探り中。返信は来るが浅い。", tip: "情報を与えすぎない。", one: "詮索すると一気に距離が空く。" },
  swords_knight:{ state: "急展開・急停止が起きやすい。", tip: "即レスしない。", one: "勢い型。不倫関係では事故りやすい。" },
  swords_queen: { state: "理性的で線引きがはっきり。", tip: "感情より事実で話す。", one: "曖昧さを嫌う。誠実さが連絡を安定させる。" },
  swords_king:  { state: "主導権を握りたいタイプ。決断は遅め。", tip: "感情的な訴えを控える。", one: "立場差・既婚者に多い。構造理解が最優先。" }
};
