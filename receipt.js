/* Домашние запасы: обработка чеков v0.9. OCR-модули размещены в самом приложении. */
(()=>{'use strict';
const norm=v=>String(v||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
const number=v=>Number(String(v||'').replace(/\s/g,'').replace(',','.'));
const ignore=/^(?:итого|всего|оплата|наличными|наличные|безнал|безналичными|сдача|ндс|кассовый чек|чек\s*[№#]|магазин|кассир|касса|приход|адрес|продавец|дата|время|телефон|тел\.|почта|email|инн\b|фн\b|фд\b|фп\b|ккт\b|смена|сно\b|сайт|www\.|https?:|добро пожаловать|спасибо|скидка по чеку|бонус|налог|признак|qr|электронный чек|торговый объект)/i;
function parseText(text){
 const raw=String(text||'').replace(/\r/g,'\n').replace(/\u00a0/g,' ');
 if(/^\s*t=\d{8}T\d{4}&s=.+&fn=/i.test(raw.trim()))throw Error('QR содержит реквизиты, а не список товаров. Нужен полный чек.');
 const lines=raw.split('\n').map(s=>s.trim().replace(/^\d{1,3}[.)]\s+/,'').replace(/\s+/g,' ')).filter(Boolean);
 const rows=[];let finished=false;
 const stop=/^(?:итого(?:\s|$)|товаров\s+на\s+сумму(?:\s|$)|всего\s+к\s+оплате(?:\s|$)|ваш\s+кешбэк(?:\s|$)|оплачено\s+бонусами(?:\s|$))/i;
 const ignoreHeader=/^(?:о покупке|написать в поддержку|оценить магазин|корзина|доставка|покупка на|кассовый чек|кассир|касса|приход|адрес|продавец|дата|время|телефон|почта|email|инн|фн|фд|фп|ккт|сайт|www\.|https?:|добро пожаловать|спасибо|скидка|сдача|бонус|налог|QR|электронный чек|\d+\s+товара?\s+на\s+сумму|магнит$|вкусвилл$|пятерочка$|пятёрочка$|лента$|дикси$)/i;
 const company=/(?:^|\s)(?:ООО|АО|ПАО|ОАО)(?:$|\s)/i;
 const measure=u=>/кг/i.test(u)?'кг':/^г/i.test(u)?'г':/шт/i.test(u)?'шт.':'уп.';
 const prior=()=>rows.length?rows[rows.length-1]:null;
 const grade=r=>{r.confidence=r.qtyKnown&&r.price!==null?.94:r.qtyKnown?.86:r.price!==null?.78:.43;r.flags=r.qtyKnown?[]:['Количество предположено: 1'];};
 const moneyPrice=/^(\d{1,7}[.,]\d{2})(?:\s*(?:₽|[рР]\.?|руб\.?))?$|^(\d{1,7})\s*(?:₽|[рР]\.?|руб\.?)$/i;
 const pricedQty=/^(\d{1,7}(?:[.,]\d{2})?)\s*(?:₽|[рР]\.?|руб\.?)?\s+(\d{1,6}(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?|уп\.?)$/i;
 const qtyPrice=/^(\d{1,6}(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?|уп\.?)\s+(\d{1,7}(?:[.,]\d{2})?)\s*(?:₽|[рР]\.?)?$/i;
 const qtyLine=/^(\d{1,6}(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?|уп\.?|пак\.?|бан\.?)(?:\s+по\s+\d{1,7}[.,]\d{2}\s*(?:₽|[рР]\.?)?\s*\/\s*(?:кг|шт\.?))?$/i;
 for(let line of lines){
  if(stop.test(line)){finished=true;continue;}
  if(finished||ignoreHeader.test(line)||ignore.test(line)||company.test(line))continue;
  if(/^\d{2}[.\/-]\d{2}[.\/-]\d{2,4}(?:\s*[\/|]\s*\d{1,2}:\d{2})?$/.test(line)||/^[-=_*•.\s]{3,}$/.test(line))continue;
  const prev=prior();
  const pq=line.match(pricedQty),qp=line.match(qtyPrice);
  if(prev&&(pq||qp)){
   const match=pq||qp;prev.price=number(pq?match[1]:match[3]);prev.qty=number(pq?match[2]:match[1]);
   prev.unit=measure(pq?match[3]:match[2]);prev.qtyKnown=true;grade(prev);continue;
  }
  const q=line.match(qtyLine);
  if(prev&&q){prev.qty=number(q[1]);prev.unit=measure(q[2]);prev.qtyKnown=true;grade(prev);continue;}
  const p=line.match(moneyPrice);
  if(p){if(prev&&prev.price===null){prev.price=number(p[1]||p[2]);grade(prev);}continue;}
  if(/^(?:\d{12,14}|\d{1,4}:\d{2})$/.test(line))continue;
  let name=line,qty=1,unit='уп.',price=null,qtyKnown=false;
  const inline=line.match(/(\d+(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?)?\s*[xх×*]\s*(\d{1,7}[.,]\d{2})(?:\s*(?:=)?\s*(\d{1,7}[.,]\d{2}))?\s*(?:₽|[рР]\.?)?$/i);
  if(inline){qty=number(inline[1]);unit=inline[2]?measure(inline[2]):'шт.';price=number(inline[4]||inline[3]);qtyKnown=true;name=line.slice(0,inline.index).trim();}
  else{
   const packed=line.match(/\s+(\d+(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?)\s+(\d{1,7}[.,]\d{2})\s*(?:₽|[рР]\.?)?$/i);
   if(packed){qty=number(packed[1]);unit=measure(packed[2]);price=number(packed[3]);qtyKnown=true;name=line.slice(0,packed.index).trim();}
  }
  name=name.replace(/^[^\p{L}]+/u,'').replace(/[,;.:—\-\s]+$/,'').trim();
  if(name.length<3||name.length>145||!/[а-яёa-z]{2}/i.test(name))continue;
  if(/(?:фискальн|эквайрин|терминал|признак расчета|банковск|оператор фд|офд)/i.test(name))continue;
  const continuation=/^(?:бондюэль|bonduelle|комфорт(?:\s|$)|ультра(?:\s|$))/i.test(name)||
    (/^[а-яё]/u.test(name)&&name.length<=42&&/\d{2,4}\s*(?:г|шт)(?:\s|$)/i.test(name)&&/(?:Huggies|Ultra|Бондюэль)/i.test(prev?.name||''));
  if(prev&&!prev.qtyKnown&&prev.price===null&&continuation){prev.name+=' '+name;prev.raw+='\n'+line;continue;}
  if(!Number.isFinite(qty)||qty<=0)continue;
  const row={name,raw:line,qty,unit,price,qtyKnown,flags:[],confidence:.43};grade(row);rows.push(row);
  if(rows.length>=100)break;
 }
 return rows.map(({qtyKnown,...item})=>item);
}
function parseJson(value){
 const doc=value?.ticket?.document?.receipt||value?.document?.receipt||value?.receipt||value;
 const entries=doc?.items||doc?.positions;
 if(!Array.isArray(entries))throw Error('Не найден список товаров в JSON.');
 return entries.map(x=>({name:String(x.name||x.productName||x.title||'').trim(),raw:String(x.name||x.productName||x.title||'').trim(),qty:Number(x.quantity??x.qty??x.count??1),unit:'уп.',price:Number.isFinite(Number(x.sum))?Number(x.sum)/100:null,confidence:1,flags:[]})).filter(x=>x.name&&Number.isFinite(x.qty)&&x.qty>0).slice(0,100);
}
function similarity(a,b){
 a=norm(a);b=norm(b);if(!a||!b)return 0;if(a===b)return 100;
 if(a.startsWith(b+' ')||b.startsWith(a+' '))return 90;
 const w=a.split(' ').filter(x=>x.length>1),v=b.split(' ').filter(x=>x.length>1),used=new Set();let overlap=0;
 for(const x of w){const i=v.findIndex((y,j)=>!used.has(j)&&(x===y||(x.length>=5&&y.length>=5&&x.slice(0,5)===y.slice(0,5))));if(i>=0){overlap++;used.add(i);}}
 if(!overlap)return 0;
 return Math.round(27+50*overlap/Math.max(w.length,v.length)+16*overlap/Math.min(w.length,v.length));
}
function candidates(name,shopping=[],products=[]){
 const opts=[];
 for(const x of shopping.filter(x=>x.status==='open')){const score=similarity(name,x.name);if(score>=57)opts.push({value:'shopping:'+x.id,name:x.name,unit:x.unit,score:score+3});}
 for(const x of products){const score=similarity(name,x.name);if(score>=68)opts.push({value:'product:'+x.id,name:x.name,unit:x.unit,score});}
 return opts.sort((a,b)=>b.score-a.score).slice(0,7);
}
function hash(text){let h=2166136261;const input=norm(text).slice(0,200000);for(let i=0;i<input.length;i++){h^=input.charCodeAt(i);h=Math.imul(h,16777619);}return 'receipt-'+(h>>>0).toString(16)+'-'+input.length;}
const scripts={};
async function script(url,globalName){
 if(window[globalName])return window[globalName];
 if(!scripts[globalName])scripts[globalName]=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=url;el.async=true;el.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('Библиотека не запустилась'));el.onerror=()=>reject(Error('Не удалось загрузить локальный OCR-модуль приложения. Проверьте подключение к интернету и обновите приложение.'));document.head.append(el);});
 try{return await scripts[globalName];}catch(e){delete scripts[globalName];throw e;}
}
async function prepareOcrImage(image,status){
 if(typeof createImageBitmap!=='function')return image;
 let bitmap;
 try{
  bitmap=await createImageBitmap(image);
  const scale=Math.min(2.1,2300/bitmap.width,3200/bitmap.height);
  const safeScale=Math.max(.6,scale);
  const canvas=document.createElement('canvas');
  canvas.width=Math.round(bitmap.width*safeScale);
  canvas.height=Math.round(bitmap.height*safeScale);
  const ctx=canvas.getContext('2d');
  if(!ctx)return image;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.filter='grayscale(100%) contrast(150%)';
  ctx.imageSmoothingEnabled=true;
  ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  status('Увеличиваю и усиливаю контраст текста чека…');
  return canvas;
 }catch(error){return image;}
 finally{if(bitmap?.close)bitmap.close();}
}
async function ocr(image,status){
 status('Загружаю модуль распознавания русского текста…');
 const t=await script('./vendor/ocr/tesseract.min.js','Tesseract');
 let worker;
 try{worker=await t.createWorker('rus+eng',1,{
  workerPath:new URL('./vendor/ocr/worker.min.js',location.href).href,
  corePath:new URL('./vendor/ocr/core',location.href).href.replace(/\/$/,''),
  langPath:new URL('./vendor/ocr/lang',location.href).href.replace(/\/$/,''),
  workerBlobURL:false,
  logger:m=>{if(m.status==='recognizing text')status('Распознавание: '+Math.round(m.progress*100)+'%');}
 });const res=await worker.recognize(await prepareOcrImage(image,status));return String(res?.data?.text||'');}
 finally{if(worker)await worker.terminate().catch(()=>{});}
}
async function extract(file,status=()=>{}){
 if(!file)throw Error('Выберите файл чека');
 const name=String(file.name||'').toLowerCase(),type=String(file.type||'');
 if(file.size>18e6)throw Error('Файл больше 18 МБ');
 if(/\.json$/.test(name)||type==='application/json')return {data:parseJson(JSON.parse(await file.text())),text:await file.text(),source:name};
 if(/\.(txt|csv)$/.test(name)||type.startsWith('text/'))return {text:await file.text(),source:name};
 if(/\.pdf$/.test(name)||type.includes('pdf')){
  status('Читаю PDF…');
  const pdf=await script('./vendor/ocr/pdf.min.js','pdfjsLib');
  pdf.GlobalWorkerOptions.workerSrc=new URL('./vendor/ocr/pdf.worker.min.js',location.href).href;
  const doc=await pdf.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const texts=[];
  for(let i=1;i<=Math.min(doc.numPages,4);i++){
   const p=await doc.getPage(i),content=await p.getTextContent(),groups=new Map();
   for(const item of content.items){if(!item.str)continue;const y=Math.round((item.transform?.[5]||0)/3)*3;if(!groups.has(y))groups.set(y,[]);groups.get(y).push(item);}
   const text=[...groups.entries()].sort((a,b)=>b[0]-a[0]).map(x=>x[1].sort((a,b)=>(a.transform?.[4]||0)-(b.transform?.[4]||0)).map(q=>q.str).join(' ')).join('\n');
   if(text.length>=40){texts.push(text);continue;}
   status('PDF как изображение: распознаю страницу '+i+'…');
   const vp=p.getViewport({scale:1.5}),canvas=document.createElement('canvas');canvas.width=Math.round(vp.width);canvas.height=Math.round(vp.height);
   await p.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
   texts.push(await ocr(canvas,status));
  }
  return {text:texts.join('\n'),source:name};
 }
 if(type.startsWith('image/')||/\.(jpg|jpeg|png|webp|bmp)$/.test(name)){
  status('Распознаю фото чека…');return {text:await ocr(file,status),source:name};
 }
 throw Error('Поддерживаются изображения, PDF, TXT и JSON.');
}
window.PantryReceipt={parseText,parseJson,similarity,candidates,hash,extract};
})();