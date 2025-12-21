// tools/generate_cards_common.js
// 使い方: node tools/generate_cards_common.js
// 出力先: cards/major と cards/minor（必要なら下の OUT_BASE を cards/common に変えてOK）

const fs = require("fs");
const path = require("path");

const OUT_BASE = path.join(process.cwd(), "cards"); // ← cards/common にしたい場合はここを書き換え

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// ----------------------
// 共通スタイル（たまみさん用：整え・優しい導線）
// ----------------------
function packLine(title, message, focus, action) {
  const short = `今日は「${title}」の整え。小さくでOKです🌿`;
  const full = [
    "🌿 今日の整えワンポイント",
    "",
    `【カード】${title}`,
    message,
    "",
    "【意識すること】",
    focus,
    "",
    "【今日の一手】",
    action,
    "",
    "今日はここまででOKです🌙"
  ].join("\n");

  const long = [
    "🌿 今日の整えワンポイント（詳細）",
    "",
    `【カード】${title}`,
    message,
    "",
    "【意識すること】",
    focus,
    "",
    "【今日の一手】",
    action,
    "",
    "🌙 焦らなくて大丈夫。整えた分だけ、現実がついてきます。"
  ].join("\n");

  return { short, full, long };
}

// ----------------------
// 小アルカナ（56枚）
// 番号の“整え意味”を共通化して、各スートで言い回しを少し変える
// ----------------------
const suits = {
  cups: { jp: "カップ", keyword: "気持ち・受容・つながり" },
  swords: { jp: "ソード", keyword: "思考・境界線・決断" },
  wands: { jp: "ワンド", keyword: "情熱・行動・推進" },
  pentacles: { jp: "ペンタクル", keyword: "現実・お金・体・積み上げ" }
};

const rankNames = {
  1: "エース",
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "ペイジ",
  12: "ナイト",
  13: "クイーン",
  14: "キング"
};

// 番号ごとの共通“整えメッセージ”
function minorCore(rank, suitKey) {
  const s = suits[suitKey];

  const byRank = {
    1: {
      msg: `始まりのサイン。${s.keyword}の“種”が動きます。今日は小さく始めるだけで十分。`,
      focus: "・最初の一歩を小さく\n・完璧を条件にしない\n・意図を1行で決める",
      action: "・5分だけ着手\n・やることを1つに絞る"
    },
    2: {
      msg: `バランス調整。${s.keyword}の“両立”がテーマ。揺れは整い直しの途中です。`,
      focus: "・やり過ぎ/我慢し過ぎを見直す\n・優先順位をつける\n・保留も選択",
      action: "・A/Bで迷うなら“今日はAだけ”\n・不要な予定を1つ外す"
    },
    3: {
      msg: `流れが増えるタイミング。${s.keyword}が“育ち始める”日。小さく共有すると進みます。`,
      focus: "・一人で抱えない\n・進捗を見える化\n・協力を受け取る",
      action: "・誰かに1通だけ連絡\n・メモに3行まとめる"
    },
    4: {
      msg: `安定と休息。${s.keyword}を“守る”日。整えるほど次が軽くなります。`,
      focus: "・守る境界線\n・休むことを許す\n・最低限を決める",
      action: "・作業場所を3分整える\n・睡眠/休憩を優先"
    },
    5: {
      msg: `違和感の発見。${s.keyword}の“ズレ”が見える日。責めずに調律すればOK。`,
      focus: "・比較をやめる\n・ズレは調整サイン\n・感情/事実を分ける",
      action: "・“何が嫌だった？”を1行\n・次の一手を小さく決める"
    },
    6: {
      msg: `回復と前進。${s.keyword}の“流れが戻る”日。受け取るほど整います。`,
      focus: "・過去より今\n・助けを受け取る\n・小さな成功に気づく",
      action: "・できたことを3つ書く\n・お礼/返信を1通"
    },
    7: {
      msg: `見極めの時間。${s.keyword}で“守る/選ぶ”がテーマ。焦らず選別すると整います。`,
      focus: "・全部やらない\n・必要/不要を分ける\n・直感を尊重",
      action: "・やることを3つに絞る\n・NOを1つ入れる"
    },
    8: {
      msg: `動かす日。${s.keyword}を“現実に落とす”タイミング。勢いを10分使うと進みます。`,
      focus: "・スピードより継続\n・まずやってみる\n・完了条件を小さく",
      action: "・10分タイマー\n・提出/送信/予約など“外に出す”"
    },
    9: {
      msg: `整いの完成に近い日。${s.keyword}の“満たし方”を確認しましょう。やり切らなくてOK。`,
      focus: "・休息も成果\n・自分を労う\n・今あるものを見る",
      action: "・ご褒美を1つ\n・棚卸し（残タスクをメモ）"
    },
    10: {
      msg: `一区切り。${s.keyword}の“手放し/仕上げ”の日。終わらせることで次が始まります。`,
      focus: "・終わらせる勇気\n・引き受け過ぎ注意\n・次の準備",
      action: "・未完了を1つだけ完了\n・不要なものを1つ捨てる"
    },
    11: {
      msg: `学びと好奇心。${s.keyword}の“新しい視点”が入る日。軽く試すのが正解。`,
      focus: "・試して学ぶ\n・型を真似る\n・小さく実験",
      action: "・テンプレを1つ作る\n・1回だけテストする"
    },
    12: {
      msg: `勢いと実行。${s.keyword}を“動かす役”が来ています。焦りは手順化で整います。`,
      focus: "・やる順番\n・障害は分解\n・短距離で走る",
      action: "・最初の1手を1行\n・15分だけ集中"
    },
    13: {
      msg: `受容と育成。${s.keyword}の“整え役”の日。自分にも他人にも優しい境界線を。`,
      focus: "・整える/育てる\n・感情のケア\n・丁寧さを選ぶ",
      action: "・温かい飲み物\n・相手/自分に優しい言葉を1つ"
    },
    14: {
      msg: `統率と安定。${s.keyword}を“仕組みにする”日。決めるほど現実が整います。`,
      focus: "・優先順位\n・ルール化\n・守る仕組み",
      action: "・今日の上位3つ\n・やらないことを1つ決める"
    }
  };

  return byRank[rank];
}

function makeMinorCard(suitKey, rank) {
  const id = `${suitKey}_${pad2(rank)}`;
  const title = `${suits[suitKey].jp}の${rankNames[rank]}`;

  const core = minorCore(rank, suitKey);
  const line = packLine(title, core.msg, core.focus, core.action);

  return {
    card_id: id,
    title,
    message: core.msg,
    focus: core.focus,
    action: core.action,
    line
  };
}

// ----------------------
// 大アルカナ（共通18枚：0〜17）
// ※まず74枚という要望に合わせて18枚にしています（0〜17）
// ----------------------
const major18 = [
  { n: 0, title: "愚者（The Fool）", msg: "正解探しをやめた瞬間に、流れが動きます。今日は「小さく一歩」でOK。", focus: "・完璧を条件にしない\n・軽いYES\n・小さく始める", action: "・5分着手\n・選択肢を2つに絞る" },
  { n: 1, title: "魔術師（The Magician）", msg: "必要な道具は揃っています。決めた瞬間に整う日。", focus: "・具体化\n・手順化\n・最初の一手", action: "・最初の1手を1行\n・3分整える" },
  { n: 2, title: "女教皇（The High Priestess）", msg: "静けさの中で本音が浮かぶ日。", focus: "・急がない\n・観察\n・情報を足しすぎない", action: "・深呼吸3回→1行メモ\n・SNSを15分止める" },
  { n: 3, title: "女帝（The Empress）", msg: "満たすほど循環します。受け取っていい日。", focus: "・先に満たす\n・優しい選択\n・小さな豊かさ", action: "・温かい飲み物\n・優しい予定を1つ" },
  { n: 4, title: "皇帝（The Emperor）", msg: "境界線を引くほど安定します。ルールを決める日。", focus: "・優先順位\n・NO\n・仕組み", action: "・3つに絞る\n・やらないこと1つ" },
  { n: 5, title: "教皇（The Hierophant）", msg: "王道が最短。基本に戻ると整う日。", focus: "・型を使う\n・信頼を積む\n・飛ばさない", action: "・テンプレ1つ\n・順番を見える化" },
  { n: 6, title: "恋人（The Lovers）", msg: "選ぶほど現実が整います。心が喜ぶ方を。", focus: "・自然さ\n・本音\n・選ぶ覚悟", action: "・身体が軽い方\n・本音を1行" },
  { n: 7, title: "戦車（The Chariot）", msg: "進むと決めると加速。ブレーキを外す日。", focus: "・勢い\n・手順\n・迷い→行動", action: "・10分タイマー\n・確認は1つだけ" },
  { n: 8, title: "力（Strength）", msg: "強さは優しさ。責めずに整え直せる日。", focus: "・優しい言葉\n・小さな継続\n・感情を扱う", action: "・声かけを変える\n・1%前進" },
  { n: 9, title: "隠者（The Hermit）", msg: "一人の時間が答えを連れてきます。内省→整理。", focus: "・自分の軸\n・減らす\n・静けさ", action: "・3行メモ\n・予定を1つ減らす" },
  { n: 10, title: "運命の輪（Wheel of Fortune）", msg: "流れが切り替わる日。小さな変化に乗ると整います。", focus: "・タイミング\n・流れに乗る\n・固執しない", action: "・1つだけ新しいこと\n・やり方を1つ変える" },
  { n: 11, title: "正義（Justice）", msg: "整合性を取る日。事実と感情を分けると楽になります。", focus: "・事実/感情を分ける\n・公平\n・約束", action: "・ToDoを整理\n・必要な連絡を1通" },
  { n: 12, title: "吊るされた男（Hanged Man）", msg: "急がない方が整う日。視点を変えると道が見えます。", focus: "・保留\n・別視点\n・手放す", action: "・今日は“待つ”を選ぶ\n・別案を1つ書く" },
  { n: 13, title: "死神（Death）", msg: "終わらせることで始まる日。手放しが整えになります。", focus: "・区切り\n・手放し\n・更新", action: "・不要を1つ捨てる\n・やめることを1つ決める" },
  { n: 14, title: "節制（Temperance）", msg: "混ぜて整える日。極端をやめると回復します。", focus: "・中庸\n・調整\n・少しずつ", action: "・作業を分割\n・水分/休憩を入れる" },
  { n: 15, title: "悪魔（Devil）", msg: "執着に気づく日。縛りは外せます。", focus: "・依存/恐れの正体\n・条件を疑う\n・選び直す", action: "・“本当は何が怖い？”を1行\n・小さく距離を取る" },
  { n: 16, title: "塔（Tower）", msg: "崩れて整う日。リセットは悪いことではありません。", focus: "・手放し\n・安全確保\n・立て直し", action: "・優先を1つに絞る\n・環境を整える" },
  { n: 17, title: "星（Star）", msg: "希望が戻る日。小さな光を信じて大丈夫。", focus: "・希望\n・回復\n・未来を描く", action: "・願いを1行\n・できる一歩を1つ" }
];

function makeMajorCard(n, title, msg, focus, action) {
  const id = `major_${pad2(n)}`;
  const line = packLine(title, msg, focus, action);
  return { card_id: id, title, message: msg, focus, action, line };
}

// ----------------------
// 生成（74枚）
// 大アルカナ18枚（0〜17） + 小アルカナ56枚
// ----------------------
function main() {
  const majorDir = path.join(OUT_BASE, "major");
  const minorDir = path.join(OUT_BASE, "minor");
  ensureDir(majorDir);
  ensureDir(minorDir);

  // major 18
  for (const m of major18) {
    const obj = makeMajorCard(m.n, m.title, m.msg, m.focus, m.action);
    const fp = path.join(majorDir, `${obj.card_id}.json`);
    writeJson(fp, obj);
  }

  // minor 56
  for (const suitKey of Object.keys(suits)) {
    for (let r = 1; r <= 14; r++) {
      const obj = makeMinorCard(suitKey, r);
      const fp = path.join(minorDir, `${obj.card_id}.json`);
      writeJson(fp, obj);
    }
  }

  console.log("✅ generated common 74 cards:");
  console.log(" - cards/major (18 files: major_00..major_17)");
  console.log(" - cards/minor (56 files: cups/swords/wands/pentacles 01..14)");
}

main();
