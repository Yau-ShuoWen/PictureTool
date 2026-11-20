const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const VERSION = 'v5';

async function thumbnailData(file, cacheDir, dataUrl = true) {
  const stat = await fs.stat(file);
  const key = crypto.createHash('sha256').update(`${file}\0${stat.size}\0${stat.mtimeMs}`).digest('hex');
  const cached = path.join(cacheDir, `${VERSION}-${key}.png`);
  try { if (!dataUrl) { await fs.access(cached); return cached; } return `data:image/png;base64,${(await fs.readFile(cached)).toString('base64')}`; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const png = await sharp(file, { failOn: 'none', animated: false })
    .rotate().resize(720, 720, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
    .png({ compressionLevel: 6 }).toBuffer();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cached, png);
  return dataUrl ? `data:image/png;base64,${png.toString('base64')}` : cached;
}

module.exports = { thumbnailData, VERSION };
