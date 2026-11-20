const fs = require('node:fs/promises');
const path = require('node:path');
const { thumbnailData } = require('../src/thumbnail');

const root = process.env.PICTURETOOL_ROOT || 'F:\\哏圖';
const cache = path.resolve(__dirname, '..', '.picturetool', 'thumbs-v5');
const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff']);

async function main() {
  const files = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
    }
  }
  await walk(root);
  console.log(`需要检查 ${files.length} 张图片`);
  let index = 0, done = 0, failed = 0;
  async function worker() {
    while (index < files.length) {
      const file = files[index++];
      try { await thumbnailData(file, cache, false); }
      catch (error) { failed++; if (failed <= 10) console.error(`${file}: ${error.message}`); }
      done++;
      if (done % 500 === 0 || done === files.length) console.log(`进度 ${done}/${files.length}，失败 ${failed}`);
    }
  }
  await Promise.all([worker(), worker()]);
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });
