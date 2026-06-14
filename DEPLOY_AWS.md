# Deploying to AWS — Pilot Runbook

> **This output is AI-generated and must be reviewed and approved before business or regulatory use.**
> Have your DevOps/security team review networking, secrets handling, and access controls before any production traffic.

This brings the platform up on a **single EC2 instance** with Docker — fastest path to a testable URL. The database stays on your existing **AWS RDS PostgreSQL**. For a hardened production setup, see "Going beyond the pilot" at the end.

## Architecture (pilot)

```
            Internet
               │  :80
        ┌──────▼───────┐        ┌──────────────────┐
        │  frontend     │  /api  │     backend       │
        │  nginx + SPA  ├───────►│  FastAPI + agents │
        └───────────────┘        │  + scheduler      │
        (Docker, same EC2 host)  └─────────┬─────────┘
                                           │ TLS (sslmode=require)
                                  ┌────────▼─────────┐
                                  │  AWS RDS Postgres │
                                  └───────────────────┘
```

The frontend container serves the built React app and reverse-proxies `/api/*` to the backend container over the internal Docker network, so only port 80 is exposed.

## 1. Launch an EC2 instance

- **AMI**: Amazon Linux 2023 (or Ubuntu 22.04+).
- **Type**: `t3.medium` minimum (the agentic pipeline + LLM calls + nginx build are memory-hungry; `t3.large` if scoring the full NIFTY500).
- **Storage**: 20 GB gp3.
- **Security group (inbound)**:
  - `80/tcp` from your office/test IPs (or `0.0.0.0/0` for an open pilot — restrict ASAP).
  - `22/tcp` from your admin IP only.
- Outbound: allow 443 (LLM APIs, NSE/Yahoo, news RSS) and 5432 (RDS).

## 2. Let RDS accept the EC2 instance

In the RDS security group, add an inbound rule: `5432/tcp` from the **EC2 instance's security group** (or its private IP). Keep RDS **not publicly accessible**.

## 3. Copy the repo to the instance

From your machine:

```bash
# zip without local junk, then scp
scp -i your-key.pem -r broking-ai-bot ec2-user@<EC2_PUBLIC_IP>:~/
```

(Or `git clone` if the repo is in a private Git remote.)

## 4. Configure secrets — `backend/.env`

```bash
cd ~/broking-ai-bot/backend
cp .env.example .env
nano .env
```

Set at minimum:

```env
# Point at your RDS instance — note sslmode=require
DATABASE_URL=postgresql+psycopg2://broking_app:STRONG_PASSWORD@your-rds.ap-south-1.rds.amazonaws.com:5432/broking_ai?sslmode=require

# Long random secret (e.g. `openssl rand -hex 32`)
JWT_SECRET=<64-char-random-string>
ENVIRONMENT=production

# Persisted audit trail inside the container's mounted volume
AUDIT_LOG_PATH=/data/audit.log

# At least one LLM key. Two+ enables the independent AI checker to use a
# different model than the rationale writer.
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...

# Only the deployed origin should be allowed (replace with your domain/IP)
CORS_ORIGINS=http://<EC2_PUBLIC_IP>
```

> `.env` holds all secrets — never commit it or bake it into an image. The Dockerfiles and `.dockerignore` already exclude it.

## 5. Prepare the database (one time)

If this RDS database is brand new:

```bash
psql "host=your-rds.ap-south-1.rds.amazonaws.com port=5432 user=postgres dbname=broking_ai sslmode=require" -f db/init_postgres.sql
```

If it already has v1/v2 tables, run the incremental upgrade for the new
maker-checker / AI-checker / research-RAG objects:

```bash
psql "host=your-rds... dbname=broking_ai sslmode=require" -f db/upgrade_v3.sql
```

(SQLite dev DBs auto-migrate on boot; Postgres needs the SQL above.)

## 6. Bring it up

```bash
cd ~/broking-ai-bot
chmod +x deploy/aws-ec2-setup.sh
./deploy/aws-ec2-setup.sh
```

The script installs Docker, builds both images, starts the stack, and waits for the backend health check.

## 7. Create the first admin & run a scoring pass

```bash
sudo docker compose -f docker-compose.prod.yml exec backend python scripts/create_admin.py
```

Open `http://<EC2_PUBLIC_IP>/`, log in, then **Admin → run scoring** (or wait for the daily job). Scores appear after the pipeline finishes.

## HTTPS with your own domain (Caddy auto-SSL) — recommended

Use this instead of the plain port-80 stack once you have a domain. Caddy obtains
and auto-renews a free Let's Encrypt certificate and forces HTTPS — no manual cert
files. This is the path for an **existing EC2 instance** in `ap-south-1`.

**1. Give the instance a stable IP.** Allocate an Elastic IP (EC2 → Elastic IPs →
Allocate) and associate it with your instance, so the address survives reboots.

**2. Point your domain at it.** In your DNS provider, add an **A record**:

```
invest.yourdomain.com   →   <ELASTIC_IP>
```

Wait for it to resolve (`nslookup invest.yourdomain.com` should return the IP).

**3. Open the firewall.** In the EC2 security group, allow inbound **80/tcp and
443/tcp** from `0.0.0.0/0` (Let's Encrypt validates over 80; users connect over
443). Keep 22 restricted to your admin IP.

**4. Set the domain + ACME email** in `backend/.env`:

```env
APP_DOMAIN=invest.yourdomain.com
ACME_EMAIL=devops@yourdomain.com
CORS_ORIGINS=https://invest.yourdomain.com
```

**5. Bring up the HTTPS stack:**

```bash
cd ~/broking-ai-bot
sudo docker compose -f docker-compose.https.yml up -d --build
```

Caddy will fetch the certificate within a few seconds. Visit
`https://invest.yourdomain.com` — you should get a valid padlock. First admin:

```bash
sudo docker compose -f docker-compose.https.yml exec backend python scripts/create_admin.py
```

> Troubleshooting: if the cert doesn't issue, check `sudo docker compose -f
> docker-compose.https.yml logs caddy`. The usual causes are the A record not yet
> resolving to this server, or port 80/443 not open in the security group.

## Day-2 operations

> If you deployed the HTTPS stack, replace `docker-compose.prod.yml` with
> `docker-compose.https.yml` in every command below.

```bash
# Logs
sudo docker compose -f docker-compose.prod.yml logs -f backend

# Restart after editing .env
sudo docker compose -f docker-compose.prod.yml restart backend

# Rebuild after pulling new code
sudo docker compose -f docker-compose.prod.yml up -d --build

# Stop
sudo docker compose -f docker-compose.prod.yml down
```

The audit trail and (if used) the SQLite fallback live in the `backend_data` Docker volume, surviving restarts and rebuilds.

## Going beyond the pilot (for the production review)

- **TLS**: put the app behind an Application Load Balancer with an ACM certificate, or add Caddy/Nginx with Let's Encrypt. Do not run customer traffic over plain HTTP.
- **Secrets**: move `.env` values into AWS Secrets Manager / SSM Parameter Store; inject at deploy time.
- **Scaling**: the backend runs the APScheduler in-process, so keep it to **one** backend instance, or pin the scheduler to a single node and scale only the stateless API behind the LB.
- **Backups**: enable automated RDS snapshots; ship `audit.log` to S3/CloudWatch for immutable retention.
- **Monitoring**: CloudWatch alarms on the `/api/v1/health` endpoint and container restarts.
- **Access**: SSH via SSM Session Manager instead of an open port 22.
