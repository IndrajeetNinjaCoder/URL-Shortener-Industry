# URL Shortener

A basic URL shortener built with Node.js and Express.js.

## Installation

1. Install PostgreSQL.
2. Create a database: `createdb url_shortener`
3. Create the table:
   ```sql
   CREATE TABLE urls (
     short_id VARCHAR(10) PRIMARY KEY,
     original_url TEXT NOT NULL
   );
   ```
4. Clone the repository.
5. Run `npm install` to install dependencies.

## Usage

1. Set the DATABASE_URL environment variable if needed (default: postgresql://postgres:password@localhost:5432/url_shortener).
2. Run `npm start` to start the server.
3. The server will run on `http://localhost:3000`.

### API Endpoints

- **POST /shorten**: Shorten a URL.
  - Request body: `{ "url": "https://example.com" }`
  - Response: `{ "shortUrl": "http://localhost:3000/abc123" }`

- **GET /:shortId**: Redirect to the original URL.
  - Example: `http://localhost:3000/abc123` redirects to the original URL.

## Features

- Generates short IDs using nanoid.
- Stores URL mappings in memory (resets on restart).
- Basic error handling.