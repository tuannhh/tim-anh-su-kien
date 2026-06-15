# Dockerfile cho MISA - Tim anh AI (dung cho Google Cloud Run, AWS, hoac server MISA co Docker)
# Dung Debian (glibc) - KHONG dung Alpine vi onnxruntime-node/sharp can glibc.
FROM node:20-bookworm-slim

# Cong cu bien dich cho thu vien native (better-sqlite3 build tu nguon neu thieu prebuilt)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cai thu vien (tan dung cache layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Chep ma nguon
COPY . .

ENV NODE_ENV=production
# Cloud Run: o dia tam ghi duoc o /tmp. Model AI + DB se nam o day (tai lai khi khoi dong nguoi - chap nhan cho ban chay thu).
# Khi chay tren server thuong/AWS co o dia ben, dat DATA_DIR tro vao o dia do de luu lau dai.
ENV DATA_DIR=/tmp/data

# Cloud Run tu cap bien PORT (mac dinh 8080); server.js da doc process.env.PORT.
EXPOSE 8080

CMD ["node", "server.js"]
