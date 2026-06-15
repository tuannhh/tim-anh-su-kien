// Cau hinh duong dan du lieu - tren cloud (Railway) se dat bien moi truong DATA_DIR tro vao o luu tru lau dai
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// UPLOAD_DIR co the dat rieng (vd mount GCS tren Cloud Run de luu thumbnail lau dai)
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

module.exports = { DATA_DIR, UPLOAD_DIR };
