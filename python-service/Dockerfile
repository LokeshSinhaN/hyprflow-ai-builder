FROM python:3.11-slim

# Install system deps and Chromium
RUN apt-get update && apt-get install -y \
    wget gnupg unzip xvfb chromium chromium-driver \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1

# Use PORT env var when provided (Cloud Run), default to 8080 locally
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
