// Doc anh tu thu muc Google Drive cong khai (public) qua Google Drive API v3.
// Chi can mot "API key" (khoa API) - Super Admin nhap trong muc Cau hinh.
const { DATA_DIR } = require('./config');

// Tach ma thu muc (folder id) tu nhieu kieu link Drive khac nhau
function parseFolderId(link) {
  if (!link) return '';
  link = String(link).trim();
  // Neu nguoi dung dan thang ma thu muc
  if (/^[A-Za-z0-9_-]{15,}$/.test(link)) return link;
  let m =
    link.match(/\/folders\/([A-Za-z0-9_-]+)/) ||   // .../drive/folders/XXXX
    link.match(/[?&]id=([A-Za-z0-9_-]+)/) ||        // ...open?id=XXXX
    link.match(/\/d\/([A-Za-z0-9_-]+)/);            // .../d/XXXX
  return m ? m[1] : '';
}

// Lay ten thu muc + kiem tra co cong khai khong (tra ve {ok, name, error})
async function checkFolder(folderId, apiKey) {
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}` +
    `?fields=id,name,mimeType&supportsAllDrives=true&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (res.status === 404) return { ok: false, error: 'Khong tim thay thu muc. Kiem tra lai link.' };
    if (res.status === 403 || res.status === 401) {
      const j = await res.json().catch(() => ({}));
      const reason = j?.error?.errors?.[0]?.reason || '';
      if (reason === 'keyInvalid' || res.status === 401)
        return { ok: false, error: 'Khoa API Google khong hop le. Kiem tra lai trong Cau hinh.' };
      return { ok: false, error: 'Thu muc KHONG o che do cong khai (Anyone with the link).' };
    }
    if (!res.ok) return { ok: false, error: `Loi Google Drive (ma ${res.status}).` };
    const j = await res.json();
    if (j.mimeType !== 'application/vnd.google-apps.folder')
      return { ok: false, error: 'Link nay khong phai la mot THU MUC Drive.' };
    return { ok: true, name: j.name };
  } catch (e) {
    return { ok: false, error: 'Khong ket noi duoc toi Google Drive: ' + e.message };
  }
}

// Liet ke tat ca anh trong thu muc (co phan trang). Tra ve [{id, name, mimeType}]
async function listImages(folderId, apiKey) {
  const files = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and mimeType contains 'image/' and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files` +
      `?q=${q}&fields=nextPageToken,files(id,name,mimeType)` +
      `&pageSize=1000&orderBy=name_natural&supportsAllDrives=true&includeItemsFromAllDrives=true` +
      (pageToken ? `&pageToken=${pageToken}` : '') + `&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Drive list loi ${res.status}: ${t.slice(0, 200)}`);
    }
    const j = await res.json();
    for (const f of j.files || []) files.push(f);
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return files;
}

// Cac URL anh cong khai (khong can API key) - dung de hien thi & tai
const thumbUrl = (id, w = 600) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;
const fullUrl = (id) => `https://lh3.googleusercontent.com/d/${id}=s2048`;
const downloadUrl = (id) => `https://drive.google.com/uc?export=download&id=${id}`;

module.exports = { parseFolderId, checkFolder, listImages, thumbUrl, fullUrl, downloadUrl, DATA_DIR };
