import { mkdir, readFile, writeFile } from 'node:fs/promises';

const read = (file) => readFile(new URL(file, import.meta.url), 'utf8');
const [html, css, client, server] = await Promise.all(
  ['web/index.html', 'web/style.css', 'web/client.js', 'worker.mjs'].map(read),
);
await mkdir(new URL('dist/server/', import.meta.url), { recursive: true });
await writeFile(new URL('dist/server/index.js', import.meta.url),
  `const PAGE = ${JSON.stringify(html)};\nconst CSS = ${JSON.stringify(css)};\nconst CLIENT = ${JSON.stringify(client)};\n${server}`);
