Hello!!! Zippy here
I made this for block the resales of tickets in webs

# BuyCut Ticket System

BuyCut Core is a server-side ticket-purchase protection system. It exposes an HTTP API that a ticketing platform's backend can call during checkout. It does not include a ticket-buying website or browser interface.

> **Project status:** This repository contains an API prototype, but it is not yet verified for live ticket sales. A deployment still needs real provider credentials, reachable PostgreSQL, HTTPS, and end-to-end validation. Review the known gaps below before going live.

## Updates

- **2026-11-14:** Reworked the README in English with the feature list, API reference, deployment steps, website-backend integration guide, and attribution expectations.
- **2026-11-14:** Added PostgreSQL-backed reservations, OTP challenges, verified contacts, and identity-session storage through migrations.
- **2026-11-14:** Added API-key authentication, request rate limiting, validated request bodies, trusted-proxy configuration, and a database health endpoint.
- **2026-11-14:** Added Twilio Verify OTP delivery and Stripe Identity document/selfie verification adapters. Provider setup and live credential checks remain necessary.

## Features

- **Purchase evaluation:** Checks account, email, phone, identity token, payment token, and the IP address observed by the API. Each signal has a four-ticket limit per event.
- **Reservations:** An allowed evaluation creates a ten-minute reservation. The ticketing backend commits after successful payment or releases after payment failure.
- **Contact verification:** Sends six-digit codes by email, SMS, or WhatsApp. Codes expire after five minutes, allow up to five attempts, and verified contacts are linked to one account.
- **Identity verification:** Creates a Stripe Identity document session with selfie matching. BuyCut stores a hashed document fingerprint and returns an opaque document token; the ticketing backend should not store document images.
- **IP risk lookup:** Calls a configured risk service using the IP observed by the API. The service must follow the contract in [Provider configuration](#provider-configuration).
- **API protection:** All routes require a server-to-server bearer key, validate request bodies, and use rate limiting.
- **Health check and migrations:** `/health` checks PostgreSQL connectivity; the migration script applies the SQL schema.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check API and database availability |
| `POST` | `/v1/verifications/otp/start` | Start email, SMS, or WhatsApp contact verification |
| `POST` | `/v1/verifications/otp/confirm` | Confirm a contact code |
| `POST` | `/v1/verifications/identity/start` | Create a Stripe Identity session |
| `POST` | `/v1/verifications/identity/result` | Check the identity session and obtain an opaque document token |
| `POST` | `/v1/purchases/evaluate` | Evaluate a purchase and reserve tickets if allowed |
| `POST` | `/v1/purchases/commit` | Mark a reservation as paid and committed |
| `POST` | `/v1/purchases/release` | Release a reservation after failed or abandoned payment |

All routes, including `/health`, require:

```http
Authorization: Bearer YOUR_BUYCUT_API_KEY
```

## Run locally

### Requirements

- Node.js 22 or newer
- PostgreSQL 17 or Docker Compose
- A Twilio Verify Service
- Stripe Identity enabled on a Stripe account
- An HTTP risk service matching the contract below

### Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API in watch mode for local development |
| `npm run typecheck` | Check TypeScript types without generating build output |
| `npm run build` | Compile the API into `dist/` |
| `npm start` | Start the compiled API |
| `npm run migrate` | Apply pending PostgreSQL migrations |

### Configure secrets

1. Copy `.env.example` to `.env`.
2. Replace `API_KEY`, `BUYCUT_HASH_SECRET`, and `POSTGRES_PASSWORD` with unique random values. Use at least 32 characters for the first two. Keep the PostgreSQL password alphanumeric because Compose inserts it into `DATABASE_URL`.
3. Add the provider variables listed below. Never commit `.env` or expose provider keys in browser code.
4. If the API sits behind a reverse proxy, set `TRUST_PROXY` to that proxy's exact IP address or CIDR. Leave it `false` when there is no trusted proxy.

### Start with Docker Compose

```sh
docker compose up -d --build
```

Compose starts PostgreSQL, waits for its health check, applies migrations, builds the API, and starts it. PostgreSQL and API ports are bound to loopback by default: `127.0.0.1:5432` and `127.0.0.1:3000`.

Check health from the host:

```sh
curl -H "Authorization: Bearer YOUR_BUYCUT_API_KEY" http://127.0.0.1:3000/health
```

To run the API directly with separately managed PostgreSQL:

```sh
npm install
npm run migrate
npm run build
npm start
```

## Provider configuration

### Twilio Verify

Add these variables to `.env`:

```dotenv
TWILIO_API_KEY=...
TWILIO_API_SECRET=...
TWILIO_VERIFY_SERVICE_SID=VA...
```

Create a Verify Service in Twilio and enable custom verification codes. Configure each channel you plan to use. Twilio requires a SendGrid integration for email and a configured WhatsApp sender for WhatsApp delivery. Trial accounts can send only to verified recipients. See the [Twilio Verify API](https://www.twilio.com/docs/verify/api) and [email setup](https://www.twilio.com/docs/verify/email).

### Stripe Identity

Add `STRIPE_SECRET_KEY` and configure:

```dotenv
IDENTITY_RETURN_HOSTS=tickets.example.com
IDENTITY_PROVIDER_REDIRECT_HOSTS=verify.stripe.com
```

The return URL sent to `/v1/verifications/identity/start` must use HTTPS and its hostname must appear in `IDENTITY_RETURN_HOSTS`. The provider redirect hostname is also checked against `IDENTITY_PROVIDER_REDIRECT_HOSTS`. See Stripe's [Identity guide](https://docs.stripe.com/identity/verify-identity-documents) and [VerificationSession API](https://docs.stripe.com/api/identity/verification_sessions).

### IP risk service

Set `RISK_PROVIDER_URL` and `RISK_PROVIDER_TOKEN`. The API calls the configured URL with a GET request and an `ip` query parameter, using bearer authentication. The endpoint must return JSON in this shape:

```json
{
  "networkType": "residential",
  "vpnOrProxy": false,
  "sharedIpPurchases": 0,
  "country": "AR",
  "region": "Buenos Aires"
}
```

`networkType` must be `residential`, `mobile`, `hosting`, or `unknown`; `vpnOrProxy` must be boolean; `sharedIpPurchases` must be numeric. This repository does not yet contain a vendor-specific MaxMind adapter. MaxMind credentials will not work with this generic response contract without an adapter or proxy service.

## Connect BuyCut to a ticketing website

BuyCut is a backend system. The browser should call the ticketing platform's backend, and that backend calls BuyCut. Never put `API_KEY`, database credentials, or provider secrets in browser JavaScript.

### 1. Verify contact details

The ticketing backend starts OTP verification:

```http
POST /v1/verifications/otp/start
Content-Type: application/json
Authorization: Bearer YOUR_BUYCUT_API_KEY
```

```json
{
  "channel": "whatsapp",
  "contactType": "phone",
  "destination": "+5491112345678",
  "accountId": "acct_123"
}
```

Return the response's `challengeId` to the ticketing frontend. When the buyer enters the code, the ticketing backend forwards it to `/v1/verifications/otp/confirm` with `challengeId`, `destination`, `code`, `accountId`, and `contactType`. Repeat with `channel: "email"` and `contactType: "email"` to verify an email address.

### 2. Verify identity

Call `/v1/verifications/identity/start` from the ticketing backend:

```json
{
  "accountId": "acct_123",
  "returnUrl": "https://tickets.example.com/identity/return"
}
```

Redirect the buyer to the returned `url`. After the provider flow, call `/v1/verifications/identity/result` with `sessionId` and `accountId`. When the status is `verified`, retain the returned `documentToken` as an opaque value and send it in the purchase evaluation. Do not store identity images or raw document data in the ticketing system.

### 3. Evaluate before payment

Call `/v1/purchases/evaluate` from the ticketing backend with the event, quantity, and buyer signals. Send a payment processor token, never a card number or security code.

```json
{
  "eventId": "concert_2026_01",
  "quantity": 2,
  "buyer": {
    "accountId": "acct_123",
    "email": "buyer@example.com",
    "phone": "+5491112345678",
    "documentToken": "OPAQUE_TOKEN_FROM_BUYCUT",
    "paymentToken": "PAYMENT_PROCESSOR_TOKEN"
  }
}
```

Do not send an IP address in the body. BuyCut reads the connection IP and, only when configured, trusted reverse-proxy headers.

### 4. Complete the purchase

- **`allow`:** Continue payment. After successful payment, call `/v1/purchases/commit` with the evaluation ID and quantity.
- **`review`:** Stop automatic checkout and send the attempt to manual review. Do not charge while it is under review.
- **`block`:** Reject the attempt.
- **Payment failure or abandonment:** Call `/v1/purchases/release` with the evaluation ID.

Reservations expire after ten minutes. Commit every successful payment and release unsuccessful payments.

## Put the API online

This publishes the backend API for a ticketing platform; it does not create or host the ticketing website itself.

1. Provision a Linux server or managed container host with Docker Engine and the Docker Compose plugin. Point a DNS name such as `api.example.com` at it.
2. Copy the project to the host and create `.env` with fresh production secrets and real provider credentials. Do not reuse development secrets.
3. Set `TRUST_PROXY` to the exact address or CIDR of the reverse proxy. Configure a TLS certificate on that proxy.
4. Keep PostgreSQL private. Keep the API bound to loopback as configured and route `https://api.example.com` through the reverse proxy to `127.0.0.1:3000`.
5. Start with `docker compose up -d --build` and inspect `docker compose logs -f api`. Confirm `/health` returns `{"status":"ok","database":"ok"}` when called with the API key.
6. Configure the ticketing backend to call the public HTTPS API URL. Store the BuyCut key in the ticketing server's secret manager, never in the frontend.
7. Before opening sales, validate contact verification, identity verification, risk lookups, concurrent reservations, commit/release behavior, database backup and restore, and provider outage handling in staging.

## Known gaps before live sales

- Provider credentials and real provider-side channel setup are required; they are not included in this repository.
- The IP-risk connector is generic and is not yet adapted to a specific vendor.
- Deployment has not been verified end to end against a live PostgreSQL instance and production host.
- BuyCut must be integrated with the ticketing platform's backend; it does not replace checkout or payment processing.
- Configure data retention, monitoring, backups, and a privacy review for the countries where the ticketing platform operates.

## Attribution

This project is intended to remain free to use and adapt. Anyone may use, modify, and share it, provided the original project attribution is preserved and the project is not presented as their original creation. Keep this attribution statement with redistributed copies.

## Development acknowledgment
This project was developed with assistance from AI tools.

## License

this was created and worked by Zippy Team™.
© BuyCut Ticket System, All rights reserved.
"BuyCut" and "BuyCut Ticket System" is a registered trademark of Zippy Team™. All other trademarks are the property of their respective owners.
