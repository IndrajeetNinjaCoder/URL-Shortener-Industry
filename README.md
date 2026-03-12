# 🔗 SnapURL — URL Shortener API

A powerful, production-ready URL shortener built with **Node.js**, **PostgreSQL**, and **Redis**. Supports advanced link management, analytics, QR codes, and more.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔗 **Link Shortening** | Generate short URLs with auto or custom aliases |
| 🔐 **Password Protection** | Secure links behind a password |
| ⏳ **Link Expiry** | Set expiry by hours, days, or preset durations |
| 🔢 **Click Limits** | Cap how many times a link can be visited |
| 1️⃣ **One-Time Links** | Links that self-destruct after first use |
| 📊 **Analytics** | Track clicks, countries, devices, and browsers |
| 👁️ **Link Preview** | Fetch OG metadata (title, description, image) |
| ✏️ **Link Editing** | Update any property of an existing link |
| 🗑️ **Link Deletion** | Delete links and all associated click data |
| 📦 **Bulk Creation** | Create up to 50 short URLs in a single request |
| 📷 **QR Codes** | Auto-generated QR code for every short URL |
| ⚡ **Redis Caching** | Lightning-fast redirects via Redis cache |
| 🛡️ **Rate Limiting** | 100 requests per 15 minutes per IP |

---

## 🛠️ Tech Stack

- **Runtime** — Node.js + Express
- **Database** — PostgreSQL (NeonDB)
- **Cache** — Redis (Upstash)
- **Libraries** — `nanoid`, `bcrypt`, `qrcode`, `geoip-lite`, `ua-parser-js`, `axios`

---

## 🗄️ Database Schema

### `urls` Table
```sql
id            SERIAL PRIMARY KEY
short_id      VARCHAR(10) UNIQUE NOT NULL
original_url  TEXT NOT NULL
created_at    TIMESTAMP DEFAULT now()
expires_at    TIMESTAMP
password      TEXT
click_limit   INTEGER
one_time      BOOLEAN DEFAULT false
```

### `click_events` Table
```sql
id          SERIAL PRIMARY KEY
short_id    VARCHAR(10)
ip_address  TEXT
user_agent  TEXT
clicked_at  TIMESTAMP DEFAULT now()
country     TEXT
device      TEXT
browser     TEXT
```

---

## 🚀 Getting Started

### 1. Install Dependencies

```bash
npm install express nanoid pg redis geoip-lite ua-parser-js express-rate-limit bcrypt qrcode axios sharp
```

### 2. Configure Environment

Update the connection strings in `index.js`:

```js
// PostgreSQL
const pool = new Pool({ connectionString: "YOUR_POSTGRES_URL" });

// Redis
const redisClient = createClient({ url: "YOUR_REDIS_URL" });
```

### 3. Start the Server

```bash
node index.js
# Server running on port 3000
```

---

## 📡 API Reference

### `POST /shorten` — Create Short URL

**Request Body:**

```json
{
  "url": "https://example.com",
  "customAlias": "my-link",
  "expiryType": "7d",
  "password": "secret",
  "clickLimit": 100,
  "oneTime": false
}
```

> `expiryType` options: `"1h"` · `"24h"` · `"7d"` · or use `expiresInHours` / `expiresInDays`

**Response:**

```json
{
  "shortUrl": "http://localhost:3000/my-link",
  "qrCode": "data:image/png;base64,...",
  "expiresAt": "2026-03-19T10:00:00.000Z",
  "clickLimit": 100,
  "oneTime": false,
  "customAlias": "my-link",
  "passwordProtected": true
}
```

---

### `GET /:shortId` — Redirect

Redirects to the original URL. For password-protected links, pass the password as a query param.

```
GET /my-link?password=secret
```

**Status Codes:**

| Code | Meaning |
|---|---|
| `302` | Redirect successful |
| `401` | Password required |
| `403` | Incorrect password |
| `404` | Short URL not found |
| `410` | Link expired / click limit reached / one-time used |

---

### `GET /analytics/:shortId` — Link Analytics

```
GET /analytics/my-link
```

**Response:**

```json
{
  "shortId": "my-link",
  "totalClicks": 42,
  "countries": [{ "country": "US", "count": "30" }],
  "devices":   [{ "device": "desktop", "count": "35" }],
  "browsers":  [{ "browser": "Chrome", "count": "28" }]
}
```

---

### `GET /preview/:shortId` — Link Preview

Returns OG metadata scraped from the destination URL.

```
GET /preview/my-link
```

**Response:**

```json
{
  "shortId": "my-link",
  "shortUrl": "http://localhost:3000/my-link",
  "originalUrl": "https://example.com",
  "createdAt": "2026-03-12T10:00:00.000Z",
  "expiresAt": null,
  "totalClicks": 42,
  "preview": {
    "title": "Example Domain",
    "description": "This is an example website.",
    "image": "https://example.com/og-image.png"
  }
}
```

---

### `PUT /edit/:shortId` — Edit a Link

Update any combination of fields. Only fields included in the body are changed.

```
PUT /edit/my-link
```

**Request Body:**

```json
{
  "url": "https://new-destination.com",
  "newAlias": "new-name",
  "expiryType": "24h",
  "password": "newpassword",
  "clickLimit": 50,
  "oneTime": false
}
```

**Response:**

```json
{
  "message": "Link updated successfully",
  "shortId": "new-name",
  "shortUrl": "http://localhost:3000/new-name",
  "updatedFields": ["original_url", "expires_at", "password", "short_id"]
}
```

---

### `DELETE /delete/:shortId` — Delete a Link

Permanently removes the link and all its click event history.

```
DELETE /delete/my-link
```

**Response:**

```json
{
  "message": "Short URL 'my-link' deleted successfully"
}
```

---

### `POST /shorten/bulk` — Bulk Create Links

Create up to **50 short URLs** in a single request.

**Request Body:**

```json
{
  "links": [
    {
      "url": "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "customAlias": "rick-roll",
      "expiryType": "7d",
      "clickLimit": 100
    },
    {
      "url": "https://github.com",
      "expiresInDays": 30
    },
    {
      "url": "https://wikipedia.org",
      "oneTime": true
    }
  ]
}
```

**Response (`207 Multi-Status`):**

```json
{
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [
    {
      "index": 0,
      "shortId": "rick-roll",
      "shortUrl": "http://localhost:3000/rick-roll",
      "qrCode": "data:image/png;base64,...",
      "originalUrl": "https://youtube.com/...",
      "expiresAt": "2026-03-19T10:00:00.000Z",
      "clickLimit": 100,
      "oneTime": false,
      "passwordProtected": false
    }
  ],
  "errors": []
}
```

> Partial failures return `207` with successful items in `results` and failed ones in `errors`.

---

## ⚙️ Rate Limiting

All endpoints are protected by a rate limiter:

- **Window:** 15 minutes
- **Max requests:** 100 per IP
- **Response on limit:** `429 Too Many Requests`

---

## 🔒 Security Notes

- Passwords are hashed with **bcrypt** (salt rounds: 10) — plain text is never stored
- Password-protected links are **never cached** in Redis
- Redis cache is invalidated on link edit or deletion

---

## 📁 Project Structure

```
├── index.js          # Main application — all routes and logic
├── package.json
└── README.md
```

---

## 📜 License

MIT — free to use, modify, and distribute.