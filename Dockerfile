# Lightwell: one container serves the website and the agent API (FastAPI).
# Local:        docker build -t lightwell . && docker run -p 8080:8080 --env-file .env lightwell   -> http://localhost:8080
# DigitalOcean: App Platform builds this file from GitHub (see .do/app.yaml and Doc/DEPLOY.md).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY lightwell lightwell
WORKDIR /app/backend
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
