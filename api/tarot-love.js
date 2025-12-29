
<script>
(function () {
  function norm(s) {
    s = String(s || "");

    // 未置換は空扱い
    if (s.includes("[[free")) return "";

    // CLEAR は空扱い（過去混入対策）
    if (s.trim() === "__CLR__") return "";

    // ZWSPだけなら空扱い
    if (s.replace(/\u200B/g, "").trim() === "") return "";

    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  }

  function run() {
    var v6 = document.getElementById("v6");
    var v5 = document.getElementById("v5");
    var v3 = document.getElementById("v3");
    var v4 = document.getElementById("v4");
    var v2 = document.getElementById("v2");
    var v1 = document.getElementById("v1");

    var shortText = norm(v6 && v6.textContent);

    // ✅本文 → 追加 → CTA の順
    var parts = [
      norm(v5 && v5.textContent),
      norm(v3 && v3.textContent),
      norm(v4 && v4.textContent),
      norm(v2 && v2.textContent),
      norm(v1 && v1.textContent),
    ].filter(Boolean);

    var longOut = parts.join("\n\n");

    var outShort = document.getElementById("shortText");
    var outLong = document.getElementById("longText");
    var fb = document.getElementById("fallback");

    if (outShort) outShort.textContent = shortText || "";
    if (outLong) outLong.textContent = longOut || "";

    if (fb) {
      fb.style.display = (!shortText || !longOut) ? "block" : "none";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>
