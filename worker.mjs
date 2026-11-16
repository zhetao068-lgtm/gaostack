const types = {
  '/': ['text/html; charset=utf-8', () => PAGE],
  '/style.css': ['text/css; charset=utf-8', () => CSS],
  '/client.js': ['text/javascript; charset=utf-8', () => CLIENT],
};

const projection = 'id,title,author,topic,summary,source,length(body) AS words,image<>\'\' AS hasImage,state,due,updated,rehearsed';
const privateHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const json = (value, status = 200) => Response.json(value, {
  status, headers: privateHeaders,
});
const error = (message, status = 400) => json({ error: message }, status);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const connected = (env) => env.ENABLE_PUBLISH === 'true' && Boolean(env.WECHAT_APP_ID && env.WECHAT_APP_SECRET);
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

class WeChatError extends Error {
  constructor(code) {
    super(code === 48001 ? '微信未授权该接口，请检查公众号接口权限。'
      : code === 40164 ? '微信拒绝服务端 IP，请检查公众号 IP 白名单。'
        : `微信接口返回错误 ${code}，请核对后台状态。`);
  }
}

async function wechat(path, body, token) {
  const url = new URL(path, 'https://api.weixin.qq.com');
  if (token) url.searchParams.set('access_token', token);
  const form = body instanceof FormData;
  const response = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: form ? undefined : { 'Content-Type': 'application/json' },
    body: form ? body : JSON.stringify(body),
  });
  if (!response.ok) throw new Error('微信响应不可确认');
  const result = await response.json();
  if (Number.isInteger(result.errcode) && result.errcode !== 0) throw new WeChatError(result.errcode);
  return result;
}

async function accessToken(env) {
  const result = await wechat('/cgi-bin/stable_token', {
    grant_type: 'client_credential', appid: env.WECHAT_APP_ID,
    secret: env.WECHAT_APP_SECRET, force_refresh: false,
  });
  if (typeof result.access_token !== 'string' || !result.access_token) throw new Error('未取得微信凭证');
  return result.access_token;
}

async function submitArticle(article, token) {
  const [, extension, encoded] = article.image.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const form = new FormData();
  form.set('media', new Blob([bytes], { type: 'image/' + extension }), 'cover.' + extension);
  const cover = await wechat('/cgi-bin/material/add_material?type=image', form, token);
  if (!cover.media_id) throw new Error('未收到封面凭证');
  const paragraphs = article.body.split(/\n\s*\n/).map((p) => '<p>' + escapeHtml(p).replace(/\n/g, '<br>') + '</p>').join('');
  const disclosure = article.source === 'ai' ? '<p>内容由 AI 生成。</p>'
    : article.source === 'mixed' ? '<p>内容使用 AI 辅助创作。</p>' : '';
  const draft = await wechat('/cgi-bin/draft/add', { articles: [{
    title: article.title, author: article.author, digest: article.summary,
    content: disclosure + paragraphs, thumb_media_id: cover.media_id, need_open_comment: 0,
  }] }, token);
  if (!draft.media_id) throw new Error('未收到微信草稿凭证');
  const submitted = await wechat('/cgi-bin/freepublish/submit', { media_id: draft.media_id }, token);
  if (typeof submitted.publish_id !== 'string' || !submitted.publish_id) throw new Error('未收到发布编号');
  return submitted.publish_id;
}

function validateDraft(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const draft = {
    title: clean(raw.title, 64), author: clean(raw.author, 16), topic: clean(raw.topic, 40),
    summary: clean(raw.summary, 120), body: clean(raw.body, 50000),
    source: raw.source, image: typeof raw.image === 'string' ? raw.image : '',
  };
  if (!draft.title || !draft.author || !draft.body || raw.title.trim().length > 64 ||
      raw.author.trim().length > 16 || raw.body.trim().length > 50000 ||
      !['manual', 'ai', 'mixed'].includes(draft.source)) return null;
  if (draft.image && (draft.image.length > 950000 ||
      !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(draft.image))) return null;
  return draft;
}

export function splitDraft(body, target) {
  const matches = [...body.matchAll(/\n+|[。！？；!?;]+[”’」』）)]*/g)].map((m) => m.index + m[0].length);
  const parts = [];
  let cursor = 0;
  while (body.length - cursor > target * 1.25) {
    const limit = Math.min(cursor + Math.floor(target * 1.25), body.length - Math.floor(target / 4));
    const candidates = matches.filter((end) => end > cursor && end <= limit && body.slice(cursor, end).trim());
    if (!candidates.length) throw new Error('有一段太长且没有句末或换行，请增加段落或调大每篇字数。');
    const end = candidates.reduce((best, next) =>
      Math.abs(next - cursor - target) < Math.abs(best - cursor - target) ? next : best);
    parts.push(body.slice(cursor, end));
    cursor = end;
  }
  parts.push(body.slice(cursor));
  if (parts.length < 2 || !parts.at(-1).trim() || parts.join('') !== body) {
    throw new Error('当前字数不足以拆分，请选择更小的每篇字数。');
  }
  return parts;
}

const insert = (db, owner, id, d, now) => db.prepare(
  'INSERT INTO articles (id,owner,title,author,topic,summary,body,source,image,updated) VALUES (?,?,?,?,?,?,?,?,?,?)'
).bind(id, owner, d.title, d.author, d.topic, d.summary, d.body, d.source, d.image, now);

async function requestBody(request) {
  const limit = 1150000;
  if (request.headers.get('content-type')?.split(';', 1)[0] !== 'application/json' ||
      !request.body || Number(request.headers.get('content-length')) > limit) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let raw = '', length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(raw + decoder.decode());
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return null;
      }
      raw += decoder.decode(value, { stream: true });
    }
  } catch (e) {
    if (e instanceof TypeError) return null;
    throw e;
  } finally {
    reader.releaseLock();
  }
}

async function authenticated(request, password) {
  const header = request.headers.get('Authorization') || '';
  if (header.length > 512 || !header.startsWith('Basic ')) return false;
  try {
    const encoder = new TextEncoder();
    const candidate = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', encoder.encode(password),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const expected = await crypto.subtle.sign('HMAC', key, encoder.encode('editor:' + password));
    return crypto.subtle.verify('HMAC', key, expected, candidate);
  } catch {
    return false;
  }
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(env.APP_ORIGIN || '') ||
      !/^[A-Za-z0-9_-]{32,128}$/.test(env.ACCESS_PASSWORD || '')) {
    return error('请先配置私有 HTTPS 地址和访问密码。', 503);
  }
  if (url.origin !== env.APP_ORIGIN) return error('访问地址无效。', 403);
  if (!await authenticated(request, env.ACCESS_PASSWORD)) {
    return new Response('请输入工作台访问凭证。', {
      status: 401, headers: { ...privateHeaders, 'WWW-Authenticate': 'Basic realm="GaoStack", charset="UTF-8"' },
    });
  }
  if (request.method === 'GET' && types[path]) {
    const [type, content] = types[path];
    return new Response(content(), { headers: {
      ...privateHeaders, 'Content-Type': type,
    } });
  }
  if (!path.startsWith('/api/')) return error('页面不存在', 404);
  if (path === '/api/automation/rehearse' || path === '/api/rehearse'
      || /^\/api\/articles\/[^/]+\/queue$/.test(path)) {
    return error('自动执行与定时排期已关闭。', 410);
  }
  const owner = 'editor';
  if (!env.DB) return error('云端稿件库暂不可用。', 503);
  if (request.method !== 'GET' && request.headers.get('Origin') !== url.origin) return error('请求来源无效', 403);
  const db = env.DB;
  const now = Date.now();
  try {
    if (request.method === 'GET' && path === '/api/articles') {
      const { results } = await db.prepare(`SELECT ${projection},
        (SELECT state FROM publications WHERE article_id=articles.id) AS publishState
        FROM articles WHERE owner=? ORDER BY updated DESC`).bind(owner).all();
      const state = await db.prepare('SELECT checked FROM automation_heartbeat WHERE singleton=1').first();
      return json({ articles: results, checked: state?.checked ?? null, connected: connected(env) });
    }
    if (request.method === 'POST' && path === '/api/articles') {
      const d = validateDraft(await requestBody(request));
      if (!d) return error('请核对标题、作者、正文、来源和图片大小。');
      const id = crypto.randomUUID();
      await insert(db, owner, id, d, now).run();
      return json({ id }, 201);
    }
    const match = path.match(/^\/api\/articles\/([a-f0-9-]{36})(?:\/(cancel|split|publish|receipt))?$/);
    if (!match) return error('稿件不存在', 404);
    const [, id, action] = match;
    const article = await db.prepare('SELECT * FROM articles WHERE owner=? AND id=?').bind(owner, id).first();
    if (!article) return error('稿件不存在', 404);
    const readPublication = () => db.prepare(
      'SELECT state,publish_id,public_url,message,updated FROM publications WHERE article_id=?'
    ).bind(id).first();
    if (request.method === 'POST' && action === 'publish') {
      if (!connected(env)) return error('服务端尚未配置微信公众号凭证。', 503);
      const input = await requestBody(request);
      if (input?.revision !== article.updated || article.state !== 'draft') return error('稿件状态已变化，请重新打开。', 409);
      if (!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(article.image)) {
        return error('发布前请选择并保存 PNG 或 JPEG 封面。');
      }
      let token;
      try { token = await accessToken(env); }
      catch (e) { return error(e instanceof WeChatError ? e.message : '未能连接微信，请检查配置和网络。', 502); }
      const claim = await db.prepare(`INSERT OR IGNORE INTO publications (article_id,state,updated)
        SELECT id,'submitting',? FROM articles WHERE id=? AND owner=? AND state='draft' AND updated=?`)
        .bind(now,id,owner,input.revision).run();
      if (!claim.meta.changes) return error('已有发布记录或稿件已改变，请刷新核对。', 409);
      try {
        const publishId = await submitArticle(article, token);
        await db.prepare("UPDATE publications SET state='submitted',publish_id=?,updated=? WHERE article_id=?")
          .bind(publishId,Date.now(),id).run();
      } catch (e) {
        const message = e instanceof WeChatError ? e.message : '微信返回结果不明。请先核对微信后台记录。';
        await db.prepare("UPDATE publications SET state=?,message=?,updated=? WHERE article_id=? AND state='submitting'")
          .bind(e instanceof WeChatError ? 'failed' : 'unknown',message,Date.now(),id).run();
      }
      return json({ publication: await readPublication() });
    }
    if (request.method === 'POST' && action === 'receipt') {
      const publication = await readPublication();
      if (!publication) return error('尚无发布记录。', 404);
      if (publication.state !== 'submitted' || !publication.publish_id) return json({ publication });
      if (!connected(env)) return error('服务端尚未配置微信公众号凭证。', 503);
      let receipt;
      try {
        receipt = await wechat('/cgi-bin/freepublish/get', { publish_id: publication.publish_id }, await accessToken(env));
      } catch (e) {
        return error(e instanceof WeChatError ? e.message : '微信回执暂不可用，请稍后查询。', 502);
      }
      const link = receipt.article_detail?.item?.[0]?.article_url;
      const validLink = typeof link === 'string' && /^https:\/\/mp\.weixin\.qq\.com\/s(?:\/|\?)/.test(link);
      if (receipt.publish_status === 0 && validLink) {
        await db.prepare("UPDATE publications SET state='published',public_url=?,updated=? WHERE article_id=? AND state='submitted'")
          .bind(link,Date.now(),id).run();
      } else if ([2,3,4,5,6].includes(receipt.publish_status)) {
        await db.prepare("UPDATE publications SET state='failed',message=?,updated=? WHERE article_id=? AND state='submitted'")
          .bind(`微信发布状态：${receipt.publish_status}。请到公众号后台核对。`,Date.now(),id).run();
      }
      return json({ publication: await readPublication() });
    }
    if (request.method === 'GET' && !action) {
      const { owner: _owner, ...visible } = article;
      return json({ article: { ...visible, publication: await readPublication() } });
    }
    if (request.method === 'PUT' && !action) {
      const d = validateDraft(await requestBody(request));
      if (!d) return error('请核对标题、作者、正文、来源和图片大小。');
      const result = await db.prepare(
        "UPDATE articles SET title=?,author=?,topic=?,summary=?,body=?,source=?,image=?,updated=? WHERE owner=? AND id=? AND state='draft' AND NOT EXISTS (SELECT 1 FROM publications WHERE article_id=articles.id)"
      ).bind(d.title,d.author,d.topic,d.summary,d.body,d.source,d.image,now,owner,id).run();
      return result.meta.changes ? json({ id }) : error('请先取消排期，已演练稿件可复制成新稿。', 409);
    }
    if (request.method === 'POST' && action === 'cancel') {
      const result = await db.prepare("UPDATE articles SET state='draft',due=NULL,updated=? WHERE owner=? AND id=? AND state='queued'")
        .bind(now,owner,id).run();
      return result.meta.changes ? json({ id }) : error('该稿件当前无法取消排期。',409);
    }
    if (request.method === 'POST' && action === 'split') {
      const input = await requestBody(request);
      if (![400,800,1200,1600,2000].includes(input?.target) || !['preview','save'].includes(input?.mode)) {
        return error('请选择每篇字数。');
      }
      let parts;
      try { parts = splitDraft(article.body, input.target); } catch (e) { return error(e.message); }
      if (parts.length > 40) return error('拆分篇数超过 40，请调大每篇字数。');
      if (input.mode === 'preview') return json({ parts, revision: article.updated });
      if (input.revision !== article.updated) return error('原稿已更新，请重新预览。',409);
      const ids = parts.map(() => crypto.randomUUID());
      await db.batch(parts.map((body, i) => {
        const suffix = `（${i+1}/${parts.length}）`;
        return insert(db, owner, ids[i], { ...article, title: article.title.slice(0,64-suffix.length)+suffix,
          body, summary: body.trim().replace(/\s+/g, ' ').slice(0,100), image: '' }, now);
      }));
      return json({ ids }, 201);
    }
    return error('不支持此操作', 405);
  } catch (e) {
    if (e instanceof SyntaxError) return error('无法读取请求内容');
    console.error('gaostack_request_failed');
    return error('云端请求未完成，请刷新后核对稿件状态。', 500);
  }
}

export default { fetch: handle };
