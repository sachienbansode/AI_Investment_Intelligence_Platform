FROM python:3.12-slim
WORKDIR /srv

# System deps for psycopg2 / building optional wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Persisted audit trail + (optional) sqlite live under /data
ENV PYTHONUNBUFFERED=1
VOLUME ["/data"]

EXPOSE 8000

# Single worker: APScheduler runs in-process; multiple workers would create
# duplicate schedulers. Scale read traffic with multiple containers behind a
# load balancer only if the scheduler is pinned to one instance.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
