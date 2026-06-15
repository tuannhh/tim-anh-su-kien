# Dockerfile cho MISA - Tim anh AI (Google Cloud Run / AWS / server MISA co Docker)
# Debian (glibc) - KHONG dung Alpine vi onnxruntime-node/sharp can glibc.
FROM node:20-bookworm-slim

# Cong cu bien dich native (better-sqlite3) + curl de tai litestream
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Litestream: sao luu lien tuc SQLite -> Google Cloud Storage (giu du lieu lau dai tren Cloud Run)
RUN curl -fsSL https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-amd64.tar.gz \
  | tar -xz -C /usr/local/bin litestream

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Cau hinh litestream + script khoi dong
COPY litestream.yml /etc/litestream.yml
COPY entrypoint.sh /entrypoint.sh
# Xoa ky tu CR (\r) phong khi file bi luu kieu Windows (CRLF) -> tranh loi "exec: /entrypoint.sh: not found"
RUN sed -i 's/\r$//' /entrypoint.sh && chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV DATA_DIR=/tmp/data
EXPOSE 8080

# entrypoint: khoi phuc DB tu GCS (neu co LITESTREAM_BUCKET) roi chay app + sao luu lien tuc.
CMD ["/entrypoint.sh"]
