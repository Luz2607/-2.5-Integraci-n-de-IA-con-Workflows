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

/* =============== IP pública (mejorado, sin tocar lo demás) =============== */
async function getPublicIP() {
  // Ejecuta varias fuentes en paralelo y regresa la primera que funcione.
  // Soporta JSON y texto plano; maneja CORS y timeouts cortos.
  const sources = [
    { url: "https://api.ipify.org?format=json", type: "json", path: ["ip"] },
    { url: "https://api64.ipify.org?format=json", type: "json", path: ["ip"] },
    { url: "https://api.myip.com", type: "json", path: ["ip"] },
    { url: "https://ipapi.co/json/", type: "json", path: ["ip"] },
    { url: "https://geolocation-db.com/json/", type: "json", path: ["IPv4","ipv4","ip"] },
    // Texto plano (muchos permiten CORS): parseamos la primera línea como IP
    { url: "https://ipv4.icanhazip.com", type: "text" },
    { url: "https://checkip.amazonaws.com", type: "text" },
    // Cloudflare trace (texto con key=value)
    { url: "https://www.cloudflare.com/cdn-cgi/trace", type: "trace" }
  ];

  const withTimeout = (p, ms = 2500) =>
    Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))
    ]);

  const tryOne = async (src) => {
    const r = await withTimeout(fetch(src.url, { cache: "no-store" }));
    if (!r.ok) throw new Error("http");
    const ct = (r.headers.get("content-type") || "").toLowerCase();

    if (src.type === "json") {
      if (!ct.includes("application/json")) throw new Error("not-json");
      const j = await r.json();
      // Busca en las rutas posibles
      for (const key of src.path) {
        if (j && typeof j[key] === "string" && j[key].trim()) {
          return normalizeIP(j[key].trim());
        }
      }
      // fall back por si el servicio devuelve otra llave estándar
      const guess = j.ip || j.query || j.address || j.addr;
      if (typeof guess === "string" && guess.trim()) return normalizeIP(guess.trim());
      throw new Error("no-ip");
    }

    if (src.type === "text") {
      if (!ct.includes("text/plain")) {
        // algunos devuelven text/html pero el body sigue siendo la IP
      }
      const t = (await r.text()).trim();
      if (t) return normalizeIP(t.split(/\s+/)[0]);
      throw new Error("no-ip");
    }

    if (src.type === "trace") {
      const t = await r.text();
      const m = t.match(/^ip=([^\n\r]+)/m);
      if (m && m[1]) return normalizeIP(m[1].trim());
      throw new Error("no-ip");
    }

    throw new Error("unknown-type");
  };

  try {
    // Promise.any devuelve el primero que resuelva
    const ip = await Promise.any(sources.map(tryOne));
    return ip || null;
  } catch {
    return null;
  }
}

function normalizeIP(ip) {
  // Limpia caracteres raros y soporta IPv4/IPv6; quita corchetes si aparecieran
  return ip.replace(/^\[|\]$/g, "").trim();
}
