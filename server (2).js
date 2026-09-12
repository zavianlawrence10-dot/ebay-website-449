// Apple Resale Pricing Tool — backend (no dependencies required)
//
// This server does two jobs:
//   1. Gets an OAuth token from eBay using your App ID + Cert ID
//      (kept here, server-side, never sent to the browser)
//   2. Proxies search requests to eBay's Browse API and returns
//      clean, simplified results to the frontend
//
// Run locally with: node server.js — then open http://localhost:3000
// On Render: Start Command is "node server.js", Build Command is
// "npm install". Your eBay keys are hardcoded below, so no environment
// variables need to be set up.
// Requires Node.js 18 or newer (for built-in fetch). No npm install needed.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ---- YOUR EBAY CREDENTIALS ----
// Hardcoded directly here for simplicity — no environment variables needed.
const EBAY_APP_ID = "ZavianLa-Websitw-PRD-482a8ad8a-980bd991";
const EBAY_CERT_ID = "PRD-82a8ad8a55c6-7820-41a9-b95b-b59e";
// Dev ID isn't needed for this OAuth flow, but keep it safe for later use.

const EBAY_MARKETPLACE = "EBAY_GB"; // change to EBAY_US etc. if needed

let cachedToken = null;
let tokenExpiresAt = 0;

async function getEbayToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`
    },
    body: "grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope"
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`eBay token request failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

async function handleSearch(query, limit, res) {
  if (!query || !query.trim()) {
    sendJson(res, 400, { error: "Missing search query" });
    return;
  }

  if (!EBAY_APP_ID || !EBAY_CERT_ID) {
    sendJson(res, 500, {
      error: "Server not configured — add your eBay App ID and Cert ID in server.js"
    });
    return;
  }

  try {
    const token = await getEbayToken();
    const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=${limit}`;

    const ebayRes = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": EBAY_MARKETPLACE
      }
    });

    if (!ebayRes.ok) {
      const errText = await ebayRes.text();
      sendJson(res, ebayRes.status, { error: `eBay search failed: ${errText}` });
      return;
    }

    const data = await ebayRes.json();

    const items = (data.itemSummaries || []).map(item => ({
      title: item.title,
      price: item.price ? parseFloat(item.price.value) : null,
      currency: item.price ? item.price.currency : null,
      condition: item.condition || "Not specified",
      url: item.itemWebUrl,
      image: item.image ? item.image.imageUrl : null,
      seller: item.seller ? item.seller.username : null
    })).filter(item => item.price !== null);

    sendJson(res, 200, { query, total: data.total || 0, items });

  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

function serveStatic(reqPath, res) {
  let filePath = reqPath === "/" ? "/index.html" : reqPath;
  filePath = path.join(PUBLIC_DIR, filePath);

  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://localhost:${PORT}`);

  if (urlObj.pathname === "/api/search") {
    const query = urlObj.searchParams.get("q");
    const limit = urlObj.searchParams.get("limit") || 15;
    handleSearch(query, limit, res);
    return;
  }

  serveStatic(urlObj.pathname, res);
});

server.listen(PORT, () => {
  console.log(`\nApple resale tool running — open http://localhost:${PORT} in your browser\n`);
});
