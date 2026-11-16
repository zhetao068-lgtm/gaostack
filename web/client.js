const $ = (id) => document.getElementById(id);
const fields = ['title','author','topic','summary','body','source'];
const stateNames = { draft:'草稿',queued:'已排期',rehearsed:'演练完成' };
const sourceNames = { manual:'手动撰写',ai:'AI 生成',mixed:'AI 辅助' };
const formatter = new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
let list=[], filter='all', current=null, cover='', saved='', revision=null, busy=false;
let record='publication', loadState='loading', connected=false;
const publicationNames = {
  submitting:'正在提交或等待核对', submitted:'微信处理中', published:'已发表',
  unknown:'结果待核对', failed:'微信未完成发表',
};

function showView(view) {
  const main=document.querySelector('main');
  if(main.dataset.mobileView===view)return;
  main.dataset.mobileView=view;
  for(const button of document.querySelectorAll('[data-view]')) {
    if(button.dataset.view===view)button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  if(matchMedia('(max-width: 760px)').matches) {
    window.scrollTo(0,0);
    const heading=document.querySelector('.'+view+' h2');
    heading.tabIndex=-1;
    heading.focus({preventScroll:true});
  }
}

const draft = () => ({...Object.fromEntries(fields.map(k=>[k,$(k).value])),image:cover});
const dirty = () => JSON.stringify(draft()) !== saved;
const stay = () => dirty() && !confirm('当前有未保存的改动，确定切换？');
function notice(text,failed=false,target='feedback') {
  $(target).textContent=text;
  $(target).dataset.error=String(failed);
  if(target==='libraryFeedback'||target==='scheduleFeedback')$(target).hidden=!text;
}
async function api(path,method='GET',body) {
  const response=await fetch('/api/'+path, {method,...(body===undefined?{}:{
    headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  })});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || '请求失败');
  return data;
}
function guarded(task,target='feedback') {
  return async (event) => {
    event?.preventDefault();
    if(busy) return;
    busy=true;
    notice('',false,target);
    try { await task(event); }
    catch(error){notice(error.message,true,target);}
    finally {busy=false;}
  };
}
function date(value) {return value?formatter.format(value):'—';}
function syncCover() {
  const image=$('coverPreview');
  if(cover) image.src=cover; else image.removeAttribute('src');
  image.hidden=!cover;
  $('coverLabel').textContent=cover?'已添加本地图片':'尚未添加配图';
  $('clearCover').disabled=!cover || Boolean(current && (current.state!=='draft' || current.publication));
}
function preview(isPreview) {
  $('preview').hidden=!isPreview;
  $('body').hidden=isPreview;
  $('body').required=!isPreview;
  $('editTab').classList.toggle('current',!isPreview);
  $('previewTab').classList.toggle('current',isPreview);
  $('wordCount').textContent=`${[...$('body').value.replace(/\s/g,'')].length.toLocaleString()} 字`;
  if(isPreview)renderPreview();
}
function renderPreview() {
  $('previewTitle').textContent=$('title').value.trim()||'未命名稿件';
  for(const [id,value] of [['previewAuthor',$('author').value],['previewSummary',$('summary').value]]) {
    $(id).textContent=value.trim();$(id).hidden=!value.trim();
  }
  const image=$('previewCover');
  if(cover)image.src=cover;else image.removeAttribute('src');
  image.hidden=!cover;
  $('previewBody').textContent=$('body').value || '正文预览会显示在这里。';
}
function loadForm(article) {
  current=article?.id?article:null;
  const d=article || {author:'',source:'manual'};
  fields.forEach(k=>{$(k).value=d[k]??'';});
  cover=d.image||'';
  saved=JSON.stringify(draft());
  const locked=current && (current.state!=='draft' || current.publication);
  fields.forEach(k=>{$(k).disabled=Boolean(locked);});
  $('pickCover').disabled=Boolean(locked);
  $('saveBtn').disabled=Boolean(locked);
  $('mobileSave').disabled=Boolean(locked);
  $('splitBtn').disabled=!current;
  $('cancelBtn').hidden=current?.state!=='queued';
  $('copyBtn').hidden=!current || Boolean(current.publication);
  $('publishBtn').hidden=!current || Boolean(locked);
  $('publishBtn').disabled=!connected;
  $('receiptBtn').hidden=current?.publication?.state!=='submitted';
  const receipt=current?.publication;
  const result=$('publication');
  result.textContent=receipt
    ? [publicationNames[receipt.state], receipt.message].filter(Boolean).join(' · ') : '';
  if(receipt?.public_url) {
    const link=document.createElement('a');
    link.href=receipt.public_url;
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='打开已发表文章';
    result.append('　',link);
  }
  $('editorHeading').textContent=current?'稿件详情':'新建稿件';
  $('statusLine').textContent=current
    ? [stateNames[current.state],current.due?'排期 '+date(current.due):'',current.rehearsed?'演练 '+date(current.rehearsed):'更新 '+date(current.updated)].filter(Boolean).join(' · ')
    : '编辑完成后保存到云端';
  syncCover();
  preview(Boolean(current));
  render();
}
function render() {
  const query=$('search').value.trim().toLowerCase();
  const rows=list.filter(a=>(filter==='all'||filter===a.state)&&[a.title,a.author,a.topic].join(' ').toLowerCase().includes(query));
  $('listCount').textContent=`显示 ${rows.length} / ${list.length} 篇`;
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('current',b.dataset.filter===filter));
  const container=$('articles');
  container.replaceChildren();
  for(const a of rows) {
    const button=document.createElement('button');
    button.type='button';
    button.className='article'+(a.id===current?.id?' selected':'');
    const name=document.createElement('span');
    name.textContent=a.title;
    const meta=document.createElement('small');
    meta.textContent=[a.author,a.topic,sourceNames[a.source],publicationNames[a.publishState] || stateNames[a.state],a.hasImage?'有配图':'待配图',a.due?date(a.due):''].filter(Boolean).join(' · ');
    button.append(name,meta);
    button.onclick=guarded(async()=>{if(!stay()) await open(a.id);},'libraryFeedback');
    container.append(button);
  }
  if(!rows.length) {
    const empty=document.createElement('p');
    empty.className='empty';
    empty.textContent=loadState==='loading'?'正在读取稿件…':loadState==='error'?'稿件库暂不可用，请刷新后重试。':list.length?'没有符合筛选条件的稿件。':'稿件库为空。可添加文字、导入稿件，或先载入示例。';
    container.append(empty);
  }
  renderRecords();
}
function renderRecords() {
  $('recordHeading').textContent=record==='publication'?'公众号回执':record==='queued'?'历史排期':'历史演练';
  for(const button of document.querySelectorAll('[data-record]'))button.setAttribute('aria-pressed',String(button.dataset.record===record));
  const rows=$('scheduleRows');
  rows.replaceChildren();
  const matching=list.filter(article=>record==='publication' ? article.publishState : article.state===record);
  for(const article of matching) {
    const button=document.createElement('button');
    button.type='button';button.className='article';
    const title=document.createElement('span');
    title.textContent=article.title;
    const details=document.createElement('small');
    details.textContent=(publicationNames[article.publishState] || stateNames[article.state])+' · '+date(article.due||article.rehearsed||article.updated);
    button.append(title,details);
    button.onclick=guarded(async()=>{if(!stay())await open(article.id);},'scheduleFeedback');
    rows.append(button);
  }
  if(!matching.length) {
    const empty=document.createElement('p');
    empty.className='empty';
    empty.textContent=loadState==='loading'?'正在读取记录…':loadState==='error'?'无法读取记录，请刷新后重试。':'暂无记录';
    rows.append(empty);
  }
}
async function refresh(){
  const data=await api('articles');
  list=data.articles;
  connected=data.connected;
  $('connection').textContent=connected?'微信凭证已配置':'微信待配置';
  loadState='ready';
  render();
}
async function open(id){loadForm((await api('articles/'+id)).article);showView('editor');}
async function save(){
  const data=await api(current?'articles/'+current.id:'articles',current?'PUT':'POST',draft());
  await refresh();
  await open(data.id);
  notice('已保存到云端。');
}
function download() {
  const file=new Blob([JSON.stringify(draft(),null,2)],{type:'application/json'});
  const url=URL.createObjectURL(file);
  const a=document.createElement('a');
  a.href=url;a.download=($('title').value||'公众号稿件')+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function compress(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size>15*1024*1024) {
    throw new Error('请选择不超过 15 MB 的 PNG、JPEG 或 WebP。');
  }
  const bitmap=await createImageBitmap(file);
  try {
    const c=document.createElement('canvas');
    const scale=Math.min(1,1500/Math.max(bitmap.width,bitmap.height));
    c.width=Math.max(1,Math.round(bitmap.width*scale));c.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=c.getContext('2d');
    context.fillStyle='#fff';context.fillRect(0,0,c.width,c.height);context.drawImage(bitmap,0,0,c.width,c.height);
    for(const quality of [.88,.75,.6,.45]){
      const encoded=c.toDataURL('image/jpeg',quality);
      if(encoded.length<940000)return encoded;
    }
    throw new Error('图片压缩后仍太大，请选择更小的图片。');
  } finally {bitmap.close();}
}

document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;render();});
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{if(!busy)showView(button.dataset.view);});
document.querySelectorAll('[data-record]').forEach(button=>button.onclick=()=>{record=button.dataset.record;renderRecords();});
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
$('search').oninput=render;
$('newDraft').onclick=()=>{if(!busy&&!stay()){loadForm();showView('editor');$('title').focus();}};
$('sampleBtn').onclick=()=>{
  if(stay())return;
  loadForm();
  $('title').value='周末散步，读懂一条街';
  $('topic').value='生活观察';
  $('summary').value='走慢一点，才看得见每天经过的地方。';
  $('body').value='周六早上，我把手机揣进口袋，沿着熟悉的街慢慢走。\n\n街口的早点铺把蒸笼搬到了门外。店主一边理着围裙，一边给路过的人指方向。\n\n一条街有自己的时钟。走慢一点，才听得见它。';
  preview(false);showView('editor');notice('示例已载入，保存后才进入云端稿件库。');
};
$('copyBtn').onclick=()=>{const d=draft();loadForm();fields.forEach(k=>{$(k).value=d[k];});cover=d.image;syncCover();preview(false);notice('副本已打开，保存后才成为新稿。');};
$('importBtn').onclick=()=>{if(!stay())$('importFile').click();};
$('importFile').onchange=guarded(async()=>{
  const file=$('importFile').files[0];$('importFile').value='';
  if(!file)return;
  if(file.size>1200000)throw new Error('请导入不超过 1.2 MB 的单篇稿件。');
  const raw=await file.text();
  let d;
  if(file.name.toLowerCase().endsWith('.json')){
    d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d))throw new Error('请选择单篇 JSON 稿件。');
    d.body=d.body||d.content;
  }else{
    const [title,...body]=raw.replace(/^\uFEFF/,'').split(/\r?\n/);
    d={title:title.replace(/^#+\s*/,''),body:body.join('\n').trim()||raw};
  }
  loadForm();
  for(const k of fields) if(typeof d[k]==='string')$(k).value=d[k];
  if(!sourceNames[$('source').value])$('source').value='manual';
  if(typeof d.image==='string'&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(d.image)&&d.image.length<950000)cover=d.image;
  syncCover();preview(false);showView('editor');notice('已导入到编辑器，核对后可保存。');
},'libraryFeedback');
$('exportBtn').onclick=download;
$('editTab').onclick=()=>preview(false);
$('previewTab').onclick=()=>preview(true);
$('body').oninput=()=>preview(false);
for(const id of ['title','author','summary'])$(id).addEventListener('input',()=>{if(!$('preview').hidden)renderPreview();});
$('pickCover').onclick=()=>$('coverFile').click();
$('clearCover').onclick=()=>{cover='';syncCover();if(!$('preview').hidden)renderPreview();};
$('coverFile').onchange=guarded(async()=>{const file=$('coverFile').files[0];$('coverFile').value='';if(file){cover=await compress(file);syncCover();if(!$('preview').hidden)renderPreview();}});
$('draftForm').onsubmit=guarded(save);
$('publishBtn').onclick=guarded(async()=>{
  if(!current || dirty()) throw new Error('请先保存本次修改。');
  if(!cover) throw new Error('请先选择并保存封面。');
  if(!confirm(`将《${current.title}》发表到公众号？本次不群发通知。`)) return;
  const id=current.id;
  notice('正在上传封面并提交微信…');
  try {
    await api(`articles/${id}/publish`,'POST',{revision:current.updated});
  } finally {
    await open(id);
    await refresh();
  }
  notice('发布记录已更新。');
});
$('receiptBtn').onclick=guarded(async()=>{
  const id=current.id;
  await api(`articles/${id}/receipt`,'POST');
  await open(id);
  await refresh();
});
$('cancelBtn').onclick=guarded(async()=>{await api(`articles/${current.id}/cancel`,'POST');await refresh();await open(current.id);notice('已取消排期。');});
$('splitBtn').onclick=()=>{
  if(dirty()){notice('请先保存正文，再拆分长文。',true);return;}
  revision=null;$('splitParts').replaceChildren();$('splitSave').disabled=true;notice('',false,'splitFeedback');$('splitDialog').showModal();
};
$('splitSize').onchange=()=>{$('splitSave').disabled=true;revision=null;};
$('splitPreview').onclick=guarded(async()=>{
  const {parts,revision:rev}=await api(`articles/${current.id}/split`,'POST',{target:Number($('splitSize').value),mode:'preview'});
  $('splitParts').replaceChildren();
  parts.forEach((part,i)=>{
    const details=document.createElement('details');details.open=i===0;
    const summary=document.createElement('summary');summary.textContent=`第 ${i+1} 篇 · ${part.trim().length} 字`;
    const body=document.createElement('pre');body.textContent=part;
    details.append(summary,body);$('splitParts').append(details);
  });
  revision=rev;$('splitSave').disabled=false;
  notice(`已校验 ${parts.length} 篇，拼回后与原文一致。`,false,'splitFeedback');
},'splitFeedback');
$('splitSave').onclick=guarded(async()=>{
  const {ids}=await api(`articles/${current.id}/split`,'POST',{target:Number($('splitSize').value),mode:'save',revision});
  $('splitDialog').close();filter='draft';await refresh();await open(ids[0]);
  notice(`已另存 ${ids.length} 篇拆分稿。可分别编辑和配图。`);
},'splitFeedback');
loadForm();
refresh().catch(error=>{loadState='error';render();notice(error.message,true,'libraryFeedback');notice(error.message,true);$('listCount').textContent='云端稿件库未能读取';});
