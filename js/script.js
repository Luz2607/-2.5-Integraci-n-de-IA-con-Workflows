// ⚠️ Pega aquí la URL EXACTA de tu webhook n8n (POST).
// Ejemplo en n8n cloud: "https://TU-SUBDOMINIO.app.n8n.cloud/webhook/ec86780d-48af-4e41-a4ec-d837d6fea0cb"
const WEBHOOK_URL = "https://luzmaria.app.n8n.cloud/webhook/ec86780d-48af-4e41-a4ec-d837d6fea0cb";

const $ = (s) => document.querySelector(s);
const form = $("#form");
const input = $("#op");
const btn = $("#btn");
const resultEl = $("#result");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = (input.value || "").trim();
  if (!text) {
    resultEl.textContent = "Escribe una operación.";
    input.focus();
    return;
  }

  setLoading(true);
  try {
    // === OBTENER IP PÚBLICA ===
    const ipCliente = await getPublicIP();

    // —— Importante ——
    // Mandamos IP por tres vías:
    // 1) Header: X-IP-Client          -> $json.headers["x-ip-client"]
    // 2) Query param: ?ip=...         -> $json.query.ip
    // 3) Body: { "ip pública": ... }  -> $json.body["ip pública"]
    const url = new URL(WEBHOOK_URL);
    if (ipCliente) url.searchParams.set("ip", ipCliente);

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(ipCliente ? { "X-IP-Client": ipCliente } : {})
      },
      body: JSON.stringify({ text, ["ip pública"]: ipCliente })
    });

    let resultado = null;

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (res.ok && ct.includes("application/json")) {
      const data = await res.json();
      resultado = getResultadoFromJSON(data);
    } else if (res.ok && ct.includes("text/plain")) {
      const txt = await res.text();
      const n = Number(txt);
      resultado = Number.isFinite(n) ? n : null;
    }

    if (resultado == null) {
      resultado = computeExpression(text);
    }

    resultEl.textContent =
      resultado == null || resultado === "" ? "No hubo resultado. Revisa el workflow." : String(resultado);
  } catch (_err) {
    resultEl.textContent = "Error de conexión con el webhook.";
  } finally {
    setLoading(false);
  }
});

function setLoading(v) {
  btn.disabled = v;
  btn.textContent = v ? "Calculando..." : "Calcular";
}

function getResultadoFromJSON(obj) {
  const queue = [obj];
  const re = /^(resultado|result|output|value)$/i;
  while (queue.length) {
    const cur = queue.shift();
    if (cur && typeof cur === "object") {
      for (const k of Object.keys(cur)) {
        if (re.test(k)) {
          const v = cur[k];
          const n = Number(v);
          if (Number.isFinite(n)) return n;
          if (typeof v === "string" && v.trim() !== "") return v;
        }
        if (cur[k] && typeof cur[k] === "object") queue.push(cur[k]);
      }
    }
  }
  return null;
}

function computeExpression(userExpr) {
  if (!userExpr) return null;
  let expr = String(userExpr).replace(/,/g, ".").replace(/[^\d+\-*/().\s]/g, "");
  if (!expr || /[a-zA-Z]/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const val = Function(`"use strict"; return (${expr});`)();
    if (typeof val === "number" && Number.isFinite(val)) {
      return Math.round((val + Number.EPSILON) * 1e10) / 1e10;
    }
    return null;
  } catch {
    return null;
  }
}

/* =============== IP pública =============== */
async function getPublicIP() {
  const endpoints = [
    "https://api.ipify.org?format=json",
    "https://api64.ipify.org?format=json",
    "https://api.myip.com",
    "https://ipapi.co/json/"
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) continue;
      const j = await r.json();
      const ip = j.ip || j.query || j.address || j.addr || null;
      if (typeof ip === "string" && ip.trim()) return ip.trim();
    } catch {}
  }
  try {
    const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
    if (r.ok) {
      const t = await r.text();
      const m = t.match(/^ip=([^\n\r]+)/m);
      if (m && m[1]) return m[1].trim();
    }
  } catch {}
  return null;
}
