{
const pad=n=>String(n).padStart(2,'0');
const IMG=Array.from({length:71},(_,i)=>i+1).filter(n=>n!==44),N=IMG.length;
const sample={};
const store={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const works=IMG.map((f,i)=>({n:i+1,id:pad(i+1),img:pad(f),st:sample[i+1]||'av'}));
let fav=new Set(store.get('msa-fav',[])),filter='all',mode='work',cur=0,dview='work';
const $=id=>document.getElementById(id);
const wall=$('wall'),ov=$('ov'),stage=$('stage'),big=$('big');
const title=w=>'No. '+w.id;
const label={av:'Available',hold:'On hold',sold:'Sold'};
function cols(){const w=innerWidth;wall.style.setProperty('--cols',w<600?3:w<900?5:w<1300?7:9)}
function render(){
  const list=works.filter(w=>filter==='all'||(filter==='av'&&w.st==='av')||(filter==='fav'&&fav.has(w.id)));
  wall.classList.toggle('wallmode',mode==='wall');
  wall.innerHTML=list.length?list.map(w=>`<button class="cell${w.st!=='av'?' gone':''}" data-i="${w.n-1}" aria-label="${title(w)}, ${label[w.st]}"><div class="frame"><img loading="lazy" src="/msa/img/${mode==='wall'?'r':'t'}${w.img}.jpg" alt="">${fav.has(w.id)?'<span class="fav" aria-hidden="true">♥</span>':''}</div><div class="cap"><span class="n">${w.id}</span>${w.st==='sold'?'<span class="dot"></span>':w.st==='hold'?'<span class="dot hold"></span>':''}</div></button>`).join(''):`<p class="empty">${filter==='fav'?'Your shortlist is empty. Open a painting and add it to the shortlist.':'Nothing to show.'}</p>`;
  $('nAvail').textContent=works.filter(w=>w.st==='av').length;
  $('nFav').textContent=fav.size;
  $('grp').hidden=!(filter==='fav'&&fav.size>=3);
  $('grp2').hidden=fav.size<3;
}
function press(ids,on){for(const id of ids)$(id).setAttribute('aria-pressed',id===on)}
function show(i){
  cur=(i+N)%N;const w=works[cur];
  stage.classList.remove('zoom');big.style.transformOrigin='';
  stage.classList.toggle('wallv',dview==='wall');
  big.src=`/msa/img/${dview==='wall'?'r':'w'}${w.img}.jpg`;big.alt=title(w);
  $('dn').textContent=`${w.id} / ${N}`;$('mn').textContent=`${w.id} / ${N}`;$('dt').textContent=title(w);$('dref').textContent='MSER-26-'+w.id;
  $('dst').innerHTML=(w.st==='sold'?'<span class="dot"></span>':w.st==='hold'?'<span class="dot hold"></span>':'<span class="dot" style="background:#2e8b57"></span>')+label[w.st];
  const r=$('res');r.classList.toggle('off',w.st!=='av');r.textContent=w.st==='av'?'Reserve by email':w.st==='hold'?'On hold':'Sold';
  r.href=w.st==='av'?'mailto:diego@diez.gallery?subject='+encodeURIComponent(`Reservation: Mario Sergio Alvarez, ${title(w)} (MSER-26-${w.id})`)+'&body='+encodeURIComponent(`Hello Diego,\n\nI would like to reserve Mario Sergio Alvarez, ${title(w)} (MSER-26-${w.id}), from the series All the Photographs of Flamboyant Trees I Find on the Internet. Oil on canvas, 140 x 85 cm. EUR 5,000 excl. VAT.\n\nName:\nCity / country:\n\nBest regards,\n`):'#';
  $('fav').textContent=fav.has(w.id)?'Remove from shortlist':'Add to shortlist';
  press(['dWork','dWall'],dview==='wall'?'dWall':'dWork');
  new Image().src=`/msa/img/w${works[(cur+1)%N].img}.jpg`;
  if(location.hash!=='#work-'+w.id)history.replaceState(null,'','#work-'+w.id);
}
function open(i,kb){ov.classList.add('on');document.body.style.overflow='hidden';show(i);if(kb)$('close').focus()}
function close(){ov.classList.remove('on');document.body.style.overflow='';history.replaceState(null,'',location.pathname+location.search);const c=wall.querySelector(`[data-i="${cur}"]`);c&&c.focus()}
wall.addEventListener('click',e=>{const c=e.target.closest('.cell');if(c)open(+c.dataset.i,e.detail===0)});
$('prev').onclick=()=>show(cur-1);$('next').onclick=()=>show(cur+1);$('close').onclick=close;
$('dWork').onclick=()=>{dview='work';show(cur)};$('dWall').onclick=()=>{dview='wall';show(cur)};
big.addEventListener('click',e=>{if(dview==='wall')return;const r=big.getBoundingClientRect();big.style.transformOrigin=`${(e.clientX-r.left)/r.width*100}% ${(e.clientY-r.top)/r.height*100}%`;stage.classList.toggle('zoom')});
stage.addEventListener('pointermove',e=>{if(!stage.classList.contains('zoom'))return;const r=stage.getBoundingClientRect();big.style.transformOrigin=`${(e.clientX-r.left)/r.width*100}% ${(e.clientY-r.top)/r.height*100}%`});
$('fav').onclick=()=>{const id=works[cur].id;fav.has(id)?fav.delete(id):fav.add(id);store.set('msa-fav',[...fav]);show(cur);render()};
addEventListener('keydown',e=>{
  if($('cmp').classList.contains('on')){if(e.key==='Escape')$('cmp').classList.remove('on');return}
  if(!ov.classList.contains('on'))return;
  if(e.key==='ArrowRight')show(cur+1);else if(e.key==='ArrowLeft')show(cur-1);else if(e.key==='Escape')close();
});
let tx=0;stage.addEventListener('touchstart',e=>{tx=e.touches[0].clientX},{passive:true});
stage.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-tx;if(Math.abs(d)>50&&!stage.classList.contains('zoom'))show(cur+(d<0?1:-1))});
function setF(f,id){filter=f;press(['fAll','fAv','fFav'],id);render()}
$('fAll').onclick=()=>setF('all','fAll');$('fAv').onclick=()=>setF('av','fAv');$('fFav').onclick=()=>setF('fav','fFav');
$('vWork').onclick=()=>{mode='work';press(['vWork','vWall'],'vWork');render()};
$('vWall').onclick=()=>{mode='wall';press(['vWork','vWall'],'vWall');render()};
function renderCmp(){
  const ids=[...fav];
  $('cmpg').innerHTML=ids.length?ids.map(id=>{const w=works[+id-1];return `<figure><img src="/msa/img/w${w.img}.jpg" alt="${title(w)}"><figcaption><span>${title(w)}, ${label[w.st]}</span><button data-rm="${id}">Remove</button></figcaption></figure>`}).join(''):'<p class="empty">Add paintings to your shortlist to compare them side by side.</p>';
}
$('vCmp').onclick=()=>{renderCmp();$('cmp').classList.add('on');$('cmpX').focus()};
$('cmpX').onclick=()=>$('cmp').classList.remove('on');
$('cmpg').addEventListener('click',e=>{const b=e.target.closest('[data-rm]');if(!b)return;fav.delete(b.dataset.rm);store.set('msa-fav',[...fav]);render();renderCmp()});
const IV=[['f'],['f'],['l'],['l'],['f'],['l'],['p'],['p'],['p'],['p'],['p'],['l'],['p'],['f']];
const order=[1,2,3,6,7,8,4,5,11,9,10,12,13];
$('igrid').innerHTML=order.map(i=>`<button class="ig ${IV[i][0]}" data-ii="${i}" aria-label="Installation view ${i+1}"><img loading="lazy" src="/msa/img/is${pad(i+1)}.jpg" alt=""></button>`).join('');
let ic=0;const ilb=$('ilb');
function ishow(i){ic=(i+IV.length)%IV.length;$('iimg').src=`/msa/img/i${pad(ic+1)}.jpg`;$('icap').innerHTML=`Installation view, Rijksakademie, Amsterdam, 2026<span style="margin-left:16px;opacity:.6">${ic+1} / ${IV.length}</span>`;new Image().src=`/msa/img/i${pad((ic+1)%IV.length+1)}.jpg`}
function iopen(i){ilb.classList.add('on');document.body.style.overflow='hidden';ishow(i)}
function iclose(){ilb.classList.remove('on');document.body.style.overflow=''}
document.addEventListener('click',e=>{const b=e.target.closest('[data-ii]');if(b)iopen(+b.dataset.ii)});
$('ix').onclick=iclose;$('ip').onclick=()=>ishow(ic-1);$('in').onclick=()=>ishow(ic+1);
addEventListener('keydown',e=>{if(!ilb.classList.contains('on'))return;e.stopImmediatePropagation();if(e.key==='ArrowRight')ishow(ic+1);else if(e.key==='ArrowLeft')ishow(ic-1);else if(e.key==='Escape')iclose()},true);
let itx=0;ilb.addEventListener('touchstart',e=>{itx=e.touches[0].clientX},{passive:true});
ilb.addEventListener('touchend',e=>{const d=e.changedTouches[0].clientX-itx;if(Math.abs(d)>50)ishow(ic+(d<0?1:-1))});
function route(){const m=location.hash.match(/^#work-(\d\d)$/);if(m&&+m[1]>=1&&+m[1]<=N)open(+m[1]-1)}
const ro=new ResizeObserver(cols);ro.observe(document.body);
cols();render();route();
fetch('/msa/status.json',{cache:'no-cache'}).then(r=>r.ok?r.json():{}).then(s=>{for(const w of works)if(s[w.id])w.st=s[w.id];render();if(ov.classList.contains('on'))show(cur)}).catch(()=>{});addEventListener('hashchange',route);
}