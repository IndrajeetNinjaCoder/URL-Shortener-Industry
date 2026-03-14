# 🔗 SnapURL — URL Shortener API

A powerful, production-ready URL shortener built with **Node.js**, **PostgreSQL**, and **Redis**. Supports user authentication, advanced link management, analytics, QR codes, and more.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 **User Authentication** | JWT-based signup, login, and protected routes |
| 🔗 **Link Shortening** | Generate short URLs with auto or custom aliases |
| 🔒 **Password Protection** | Secure individual links behind a password |
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
| 👤 **Link Ownership** | Users can only edit/delete their own links |

---

## 🛠️ Tech Stack

- **Runtime** — Node.js + Express
- **Database** — PostgreSQL (NeonDB)
- **Cache** — Redis (Upstash)
- **Auth** — JSON Web Tokens (JWT)
- **Libraries** — `nanoid`, `bcrypt`, `jsonwebtoken`, `qrcode`, `geoip-lite`, `ua-parser-js`, `axios`

---

## 🗄️ Database Schema

### `users` Table
```sql
id         SERIAL PRIMARY KEY
name       TEXT NOT NULL
email      TEXT UNIQUE NOT NULL
password   TEXT NOT NULL
created_at TIMESTAMP DEFAULT now()
```

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
user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE
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

## 📁 Project Structure

```
URL-Shortener/
├── server.js                           # Entry point — boots server, handles shutdown
├── package.json
├── .env
├── .gitignore
└── src/
    ├── app.js                          # Express setup, middleware, route mounting
    ├── config/
    │   ├── db.js                       # PostgreSQL pool
    │   ├── jwt.js                      # JWT secret & expiry config
    │   └── redis.js                    # Redis client
    ├── controllers/
    │   ├── auth.controller.js          # signup, login, getMe
    │   ├── url.controller.js           # createShortUrl, redirectUrl, edit, delete, bulk, preview
    │   └── analytics.controller.js     # getAnalytics
    ├── middleware/
    │   ├── auth.js                     # JWT authentication middleware
    │   └── rateLimiter.js              # Rate limiting middleware
    ├── routes/
    │   ├── auth.routes.js              # /auth/*
    │   ├── url.routes.js               # /shorten, /:shortId, /edit, /delete, /preview
    │   └── analytics.routes.js         # /analytics/:shortId
    └── utils/
        └── helpers.js                  # parseTTL(), logClick()
```

---

## 🚀 Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/your-username/url-shortener.git
cd url-shortener
npm install
```

### 2. Set Up Environment

Create a `.env` file in the root:

```env
PORT=3000
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
REDIS_URL=rediss://default:password@host:6379
JWT_SECRET=your_super_secret_key_change_this
```

### 3. Set Up Database

Run these in your NeonDB SQL editor:

```sql
CREATE TABLE users (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE urls (
  id           SERIAL PRIMARY KEY,
  short_id     VARCHAR(10) UNIQUE NOT NULL,
  original_url TEXT NOT NULL,
  created_at   TIMESTAMP DEFAULT now(),
  expires_at   TIMESTAMP,
  password     TEXT,
  click_limit  INTEGER,
  one_time     BOOLEAN DEFAULT false,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE click_events (
  id         SERIAL PRIMARY KEY,
  short_id   VARCHAR(10),
  ip_address TEXT,
  user_agent TEXT,
  clicked_at TIMESTAMP DEFAULT now(),
  country    TEXT,
  device     TEXT,
  browser    TEXT
);
```

### 4. Start the Server

```bash
# Development (auto-restart on file changes)
npm run dev

# Production
npm start
```

---

## 📡 API Reference

### 🔐 Auth Routes

#### `POST /auth/signup` — Create Account

```json
{
  "name": "Indrajeet",
  "email": "indrajeet@email.com",
  "password": "secret123"
}
```

**Response:**
```json
{
  "message": "Account created successfully",
  "token": "eyJhbGci...",
  "user": { "id": 1, "name": "Indrajeet", "email": "indrajeet@email.com" }
}
```

---

#### `POST /auth/login` — Login

```json
{
  "email": "indrajeet@email.com",
  "password": "secret123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGci...",
  "user": { "id": 1, "name": "Indrajeet", "email": "indrajeet@email.com" }
}
```

---

#### `GET /auth/me` — Get Current User 🔒

```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "name": "Indrajeet",
  "email": "indrajeet@email.com",
  "createdAt": "2026-03-12T10:00:00.000Z"
}
```

---

### 🔗 URL Routes

> 🔒 = Requires `Authorization: Bearer <token>` header

#### `POST /shorten` — Create Short URL 🔒

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

#### `GET /:shortId` — Redirect (Public)

Redirects to the original URL. For password-protected links, pass the password as a query param.

```
GET /my-link?password=secret
```

| Code | Meaning |
|---|---|
| `302` | Redirect successful |
| `401` | Password required |
| `403` | Incorrect password |
| `404` | Short URL not found |
| `410` | Expired / click limit reached / one-time used |

---

#### `GET /preview/:shortId` — Link Preview 🔒

Returns OG metadata scraped from the destination URL.

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

#### `PUT /edit/:shortId` — Edit a Link 🔒

Only the owner can edit. Send any fields you want to update.

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

#### `DELETE /delete/:shortId` — Delete a Link 🔒

Only the owner can delete. Removes the link and all its click history.

**Response:**
```json
{
  "message": "Short URL 'my-link' deleted successfully"
}
```

---

#### `POST /shorten/bulk` — Bulk Create Links 🔒

Create up to **50 short URLs** in one request.

```json
{
  "links": [
    { "url": "https://youtube.com", "customAlias": "yt", "expiryType": "7d" },
    { "url": "https://github.com", "expiresInDays": 30 },
    { "url": "https://wikipedia.org", "oneTime": true }
  ]
}
```

**Response (`207 Multi-Status`):**
```json
{
  "total": 3,
  "succeeded": 3,
  "failed": 0,
  "results": [ /* array of created links with qrCode */ ],
  "errors":  []
}
```

---

#### `GET /analytics/:shortId` — Link Analytics 🔒

Only the owner can view analytics for their link.

**Response:**
```json
{
  "shortId": "my-link",
  "totalClicks": 42,
  "countries": [{ "country": "IN", "count": "30" }],
  "devices":   [{ "device": "desktop", "count": "35" }],
  "browsers":  [{ "browser": "Chrome", "count": "28" }]
}
```

---

## ⚙️ Rate Limiting

- **Window:** 15 minutes
- **Max requests:** 100 per IP
- **Response on limit:** `429 Too Many Requests`

---

## 🔒 Security

- Passwords hashed with **bcrypt** (10 salt rounds) — never stored as plain text
- JWT tokens expire after **7 days**
- Password-protected links are **never cached** in Redis
- Redis cache is invalidated on link edit or deletion
- Every protected route verifies **ownership** — users can only modify their own links

---

## 📜 License

MIT — free to use, modify, and distribute.