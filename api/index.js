export const config = {
  runtime: "edge",
};

const BASE = (process.env.API_BASE || "").replace(/\/$/, "");

export default async function handler(req) {
  if (!BASE) {
    return new Response("Config error", { status: 500 });
  }

  const url = new URL(req.url);

  // مسیر مستقیم بدون پردازش اضافه
  const target = BASE + url.pathname + url.search;

  // فقط متدهای لازم برای کاهش پردازش
  if (
    req.method !== "GET" &&
    req.method !== "POST" &&
    req.method !== "HEAD"
  ) {
    return new Response("Not allowed", { status: 405 });
  }

  return fetch(target, {
    method: req.method,
    headers: req.headers,
    body: req.method === "POST" ? req.body : undefined,
    duplex: "half",
    redirect: "follow",
  });
}
