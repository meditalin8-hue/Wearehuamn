export const config = {
  runtime: "edge",
};

const TARGET_BASE = (process.env.TARGET_DOMAIN || "").replace(/\/$/, "");

const STRIP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "forwarded",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
]);

const SPEEDTEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Speed Test</title>
  <style>
    body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f0f2f5; }
    .container { text-align: center; background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 400px; width: 90%; }
    button { padding: 12px 24px; font-size: 16px; background: #0070f3; color: white; border: none; border-radius: 6px; cursor: pointer; }
    button:disabled { background: #99c0ff; cursor: not-allowed; }
    .result { margin-top: 20px; font-size: 24px; font-weight: bold; }
    .progress { width: 100%; height: 8px; background: #e0e0e0; border-radius: 4px; overflow: hidden; margin: 20px 0; display: none; }
    .progress-bar { height: 100%; width: 0; background: #0070f3; transition: width 0.2s; }
  </style>
</head>
<body>
  <div class="container">
    <h2>⚡ Speed Test</h2>
    <p>Check your download speed</p>
    <button id="startBtn" onclick="startTest()">Start Test</button>
    <div class="progress" id="progress"><div class="progress-bar" id="progressBar"></div></div>
    <div class="result" id="result"></div>
  </div>
  <script>
    async function startTest() {
      const btn = document.getElementById('startBtn');
      const progressDiv = document.getElementById('progress');
      const progressBar = document.getElementById('progressBar');
      const resultDiv = document.getElementById('result');
      btn.disabled = true;
      resultDiv.textContent = '';
      progressDiv.style.display = 'block';
      progressBar.style.width = '0%';

      const testFileUrl = '/speedtest';
      const startTime = performance.now();
      let loadedBytes = 0;
      try {
        const response = await fetch(testFileUrl);
        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          loadedBytes += value.length;
          if (contentLength) {
            progressBar.style.width = (loadedBytes / contentLength) * 100 + '%';
          }
        }
        const duration = (performance.now() - startTime) / 1000;
        const speedMbps = ((loadedBytes * 8) / (duration * 1000000)).toFixed(2);
        resultDiv.textContent = \`\${speedMbps} Mbps\`;
      } catch (e) {
        resultDiv.textContent = 'Test failed.';
      } finally {
        btn.disabled = false;
        progressDiv.style.display = 'none';
        // ارسال پینگ پس از تست برای ثبت بازدید شبیه کاربر واقعی
        fetch('/ping').catch(() => {});
      }
    }

    // اجرای خودکار تست سرعت وقتی صفحه باز می‌شود (شبیه به رفتار ابزارهای معروف)
    window.addEventListener('load', () => {
      setTimeout(startTest, 500);
    });
  </script>
</body>
</html>`;

export default async function handler(req) {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // صفحه اصلی اسپید تست
  if (req.method === "GET" && pathname === "/") {
    return new Response(SPEEDTEST_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // درخواست پینگ ساده برای شبیه‌سازی بازدید
  if (req.method === "GET" && pathname === "/ping") {
    return new Response("pong", { status: 200 });
  }

  // فایل ۱۰ مگابایتی برای تست سرعت
  if (req.method === "GET" && pathname === "/speedtest") {
    const totalBytes = 10 * 1024 * 1024; // 10 MB
    let totalBytesLeft = totalBytes;
    const stream = new ReadableStream({
      pull(controller) {
        const chunkSize = 64 * 1024;
        if (totalBytesLeft <= 0) {
          controller.close();
          return;
        }
        const size = Math.min(chunkSize, totalBytesLeft);
        const chunk = new Uint8Array(size);
        controller.enqueue(chunk);
        totalBytesLeft -= size;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Length": String(totalBytes),
      },
    });
  }

  // ---------- بخش پروکسی ----------
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_DOMAIN is not set", { status: 500 });
  }

  // ۵٪ احتمال فراخوانی صفحه اصلی برای تقلید ترافیک سنگین
  if (Math.random() < 0.05) {
    // Fire-and-forget: منتظر پاسخ نمی‌مانیم
    fetch(new URL("/", req.url)).catch(() => {});
    fetch(new URL("/ping", req.url)).catch(() => {});
  }

  try {
    const targetUrl = TARGET_BASE + url.pathname + url.search;

    const headers = new Headers();
    let clientIp = null;
    for (const [key, value] of req.headers) {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.has(k)) continue;
      if (k.startsWith("x-vercel-")) continue;
      if (k === "x-real-ip") { clientIp = value; continue; }
      if (k === "x-forwarded-for") { if (!clientIp) clientIp = value; continue; }
      headers.set(k, value);
    }
    if (clientIp) headers.set("x-forwarded-for", clientIp);

    const method = req.method;
    const hasBody = method !== "GET" && method !== "HEAD";

    const fetchOpts = {
      method,
      headers,
      redirect: "manual",
    };
    if (hasBody) {
      fetchOpts.body = req.body;
      fetchOpts.duplex = "half";
    }

    const upstream = await fetch(targetUrl, fetchOpts);

    const respHeaders = new Headers();
    for (const [k, v] of upstream.headers) {
      if (k.toLowerCase() === "transfer-encoding") continue;
      respHeaders.set(k, v);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    return new Response("Bad Gateway: Tunnel Failed", { status: 502 });
  }
}
