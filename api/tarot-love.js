const LOVE_TEXT = {
  "19-TheSun.png": "🌞 太陽\n\n今の恋：...\n今日の整え：...\nひとこと：...",
  "18-TheMoon.png": "🌙 月\n\n今の恋：...\n..."
};

export default function handler(req, res) {
  const cardFile = req.query.card_file; // 例: 19-TheSun.png
  const text = LOVE_TEXT[cardFile] || "カードが見つかりませんでした🙏";
  res.status(200).json({ text });
}
