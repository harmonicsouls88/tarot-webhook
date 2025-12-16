export default function handler(req, res) {
  // CORS（ProLineから叩く時に必要になることが多い）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, message: "tarot-love webhook alive" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  // ===== 1) ProLineから来る「本文」を拾う（どの形でも拾えるように）=====
  const body = req.body || {};
  const text =
    body.text ||
    body.message ||
    body.messageText ||
    body.original_text ||
    "";

  // ===== 2) 本文から card_id を抜き出す（ここが超重要）=====
  // 想定： "card_id:major_19" / "card_id：major_19" / 改行混在
  const match = String(text).match(/card_id\s*[:：]\s*([a-zA-Z0-9_]+)/);
  const cardId = match ? match[1] : "";

  if (!cardId) {
    return res.status(200).json({
      text:
        "カードIDが見つかりませんでした🙏\n\n" +
        "ワンカード結果の「#整え続き」をそのままコピペして送ってください🌿"
    });
  }

  // ===== 3) ここに「カード別の最初の整えワンポイント」を全部入れる =====
  const CARDS = {
    // --- 恋愛で出やすい12枚（例） ---
    major_19: {
      title: "🌞 太陽",
      now: "堂々と受け取っていい流れ。隠すほど停滞します。",
      today: "嬉しかった事実だけを短文で伝える。",
      one: "気持ちは出してOK。関係を壊すカードではありません。"
    },
    major_18: {
      title: "🌙 月",
      now: "不安が現実を歪めやすい時期。誤解が増えがち。",
      today: "連絡は“確認”ではなく“共有”にする。",
      one: "試すLINEは逆効果。整えるだけで流れが戻ります。"
    },
    major_06: {
      title: "💞 恋人",
      now: "気持ちは通じているが、決断はまだ先。",
      today: "白黒を迫らず、会える形を1つだけ提示。",
      one: "選ばせるより、安心できる場を。"
    },
    major_04: {
      title: "👑 皇帝",
      now: "相手は立場や責任を意識しています。",
      today: "感情ではなく“事実ベース”で話す。",
      one: "不倫・年上関係ほど、感情より構造調整が効きます。"
    },
    major_03: {
      title: "🌿 女帝",
      now: "受け取る準備が整っています。",
      today: "与えすぎを1つやめる。",
      one: "尽くしすぎは縁を重くします。"
    },
    major_11: {
      title: "⚖ 正義",
      now: "バランス調整のタイミング。",
      today: "自分だけ我慢している点を書き出す。",
      one: "不公平感が続くなら、整え直しが必要。"
    },
    major_17: {
      title: "⭐ 星",
      now: "ゆっくりだが回復方向。",
      today: "未来の話より、今日を軽くする。",
      one: "信じる＝待つ、ではありません。"
    },
    major_14: {
      title: "🧪 節制",
      now: "今は混ぜ合わせる段階。",
      today: "距離を詰めすぎない。",
      one: "ツイン関係は“中庸”が最短ルート。"
    },
    major_15: {
      title: "😈 悪魔",
      now: "執着が連絡頻度を乱しています。",
      today: "相手のSNSを見ない時間を作る。",
      one: "縁は“切る”より“緩める”。"
    },
    major_16: {
      title: "🗼 塔",
      now: "揺れはリセットの合図。",
      today: "反射LINEを送らない。",
      one: "壊れたように見えて、実は正位置。"
    },
    major_13: {
      title: "☠ 死神",
      now: "形を変える準備段階。",
      today: "今までのやり方を1つ終わらせる。",
      one: "終わり＝縁切りではありません。"
    },
    major_21: {
      title: "🌍 世界",
      now: "一区切りが近い。",
      today: "望む関係を言語化する。",
      one: "完成は“受け取り方”で決まります。"
    },

    // --- カップ（例：A〜10） ---
    cups_01: { title:"🥤 カップA", now:"気持ちは動く。連絡の“入口”が開く。", today:"短く、温度のある一言だけ送る。", one:"複雑恋愛ほど「軽い嬉しさ」が突破口。" },
    cups_02: { title:"🥤 カップ2", now:"相互の好意あり。会う話が現実になりやすい。", today:"「いつ空いてる？」より「◯日どう？」で具体化。", one:"曖昧に引っ張らないのが吉。" },
    cups_03: { title:"🥤 カップ3", now:"会話ややり取りは増えるが、周囲要因も混ざる。", today:"恋の話より“日常の共有”を増やす。", one:"不倫・ツインは「関係の場」を整えると安定。" },
    cups_04: { title:"🥤 カップ4", now:"相手の気持ちが停滞。あなたも飽き/疲れが出やすい。", today:"追いLINEはしない。自分の予定を先に埋める。", one:"止まってる時は、動かすより“重さを抜く”。" },
    cups_05: { title:"🥤 カップ5", now:"失望・不安が強く出る。過去の出来事に引っ張られる。", today:"「良かった事実」を1つだけ思い出す。", one:"修復は可能。ただ“責め”は連絡を遠ざける。" },
    cups_06: { title:"🥤 カップ6", now:"過去の縁・懐かしさが動く。連絡の再開が起きやすい。", today:"重い話題は避け、思い出や共通の話題を1つだけ。", one:"「昔に戻る」より「今の距離で再接続」。"},
    cups_07: { title:"🥤 カップ7", now:"迷い・期待過多。選択肢に振り回されがち。", today:"妄想を止め、事実だけを書き出す。", one:"幻想を減らすと現実が動く。"},
    cups_08: { title:"🥤 カップ8", now:"気持ちはあるが、この形に限界を感じ始めている。", today:"「我慢していること」を1つやめる。", one:"離れる＝縁切りではない。距離調整。"},
    cups_09: { title:"🥤 カップ9", now:"望みは叶いやすい。ただし“条件付き”。", today:"欲しい結果を1つに絞る。", one:"全部欲しがると、連絡も会うも遠のく。"},
    cups_10: { title:"🥤 カップ10", now:"感情面は満たされる流れ。安心感が戻る。", today:"「安心できた瞬間」を言葉にする。", one:"心が安定すると現実が整う。" },

    // --- ソード（例：A〜10） ---
    swords_01: { title:"⚔ ソードA", now:"状況がクリアになる。決断・線引きが必要。", today:"曖昧な期待をやめ、条件を1つ言語化。", one:"複雑恋愛ほど「現実のルール作り」が効く。" },
    swords_02: { title:"⚔ ソード2", now:"様子見・保留。決めきれない。", today:"「待つ」ではなく“期限”を自分で決める。", one:"決めない＝停滞。自分側の軸から動かす。" },
    swords_03: { title:"⚔ ソード3", now:"心が痛い局面。言葉が刺さりやすい。", today:"反射で返さず、1日置く。", one:"切るより冷却。修復の余地は残す。" },
    swords_04: { title:"⚔ ソード4", now:"休止・距離調整。返信が遅いのは“回復時間”。", today:"追わず、生活を整える（睡眠/食事/予定）。", one:"一旦休むが正解の時がある。" },
    swords_05: { title:"⚔ ソード5", now:"意地・勝ち負けが出る。揉めやすい。", today:"“正しさ”より“関係が続く言い方”を選ぶ。", one:"勝っても失う。引く強さが現実を守る。" },
    swords_06: { title:"⚔ ソード6", now:"状況は少しずつ好転。距離や環境が変わる兆し。", today:"感情整理を優先し、無理に結論を出さない。", one:"複雑恋愛は「場所・時間」を変えると動く。" },
    swords_07: { title:"⚔ ソード7", now:"本音を隠す/隠される可能性。", today:"疑う前に、確認しない選択をする。", one:"探らない強さが信頼を呼ぶ。" },
    swords_08: { title:"⚔ ソード8", now:"「動けない」は思い込み。自分で制限をかけている。", today:"できる行動を1つ探す。", one:"“自分側の制限解除”が鍵。" },
    swords_09: { title:"⚔ ソード9", now:"不安・後悔が膨らみやすい。考えすぎ注意。", today:"夜のスマホ時間を減らす。", one:"連絡が来ない夜ほど、休む勇気を。" },
    swords_10: { title:"⚔ ソード10", now:"一度どん底を見る流れ。だが回復は目前。", today:"終わった前提で、明日の予定を立てる。", one:"完全な終わりではなく「底打ち」。" }
  };

  const card = CARDS[cardId];

  // ===== 4) 返信本文を作る（整えワンポイント：最初の1通）=====
  if (!card) {
    return res.status(200).json({
      text:
        "カードが見つかりませんでした🙏\n\n" +
        `受け取ったID：${cardId}\n` +
        "（運営側で順次追加していきます🌿）"
    });
  }

  const reply =
    "受け取ってくれてありがとうございます🌿\n\n" +
    `${card.title}\n\n` +
    "【今の恋】\n" + card.now + "\n\n" +
    "【今日の整え】\n" + card.today + "\n\n" +
    "【ひとこと】\n" + card.one + "\n\n" +
    "必要なら、次は「続き」と送ってください🌿";

  // ProLineが受け取れる形（あなたの画面では { "text": "..."} が出てたのでこれでOK）
  return res.status(200).json({ text: reply });
}
