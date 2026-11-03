/* Домашние запасы: обработка чеков v0.7. Изображения распознаются на устройстве. */
(()=>{'use strict';
const norm=v=>String(v||'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/gi,' ').replace(/\s+/g,' ').trim();
const number=v=>Number(String(v||'').replace(/\s/g,'').replace(',','.'));
const ignore=/^(?:итого|всего|оплата|наличными|наличные|безнал|безналичными|сдача|ндс|кассовый чек|чек\s*[№#]|магазин|кассир|касса|приход|адрес|продавец|дата|время|телефон|тел\.|почта|email|инн\b|фн\b|фд\b|фп\b|ккт\b|смена|сно\b|сайт|www\.|https?:|добро пожаловать|спасибо|скидка по чеку|бонус|налог|признак|qr|электронный чек|торговый объект)/i;
function parseText(text){
 const raw=String(text||'').replace(/\r/g,'\n').replace(/\u00a0/g,' ');
 if(/^\s*t=\d{8}T\d{4}&s=.+&fn=/i.test(raw.trim()))throw Error('QR содержит реквизиты чека, но не позиции. Загрузите полный чек.');
 const lines=raw.split('\n').map(s=>s.replace(/^\s*\d{1,3}[.)]\s+/,'').replace(/\s+/g,' ').trim()).filter(Boolean);
 const result=[];let finished=false;
 for(let line of lines){
  if(/^(?:итого|всего к оплате|к оплате|сумма чека|итог чека)\b/i.test(line)){finished=true;continue;}
  const splitQty=line.match(/^(\d+(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?)?\s*[xх×*]\s*(\d{1,7}[.,]\d{2})(?:\s+(\d{1,7}[.,]\d{2}))?$/i);
  if(splitQty&&result.length&&result[result.length-1].confidence<.6){
   const prior=result[result.length-1];
   prior.qty=number(splitQty[1]);prior.unit=/кг/i.test(splitQty[2]||'')?'кг':/^г/i.test(splitQty[2]||'')?'г':'шт.';
   prior.price=number(splitQty[4]||splitQty[3]);prior.confidence=.87;prior.flags=[];
   continue;
  }
  if(/^\d+[.,]\d{2}$/.test(line)&&result.length&&result[result.length-1].confidence<.6){
   const prior=result[result.length-1];
   prior.price=number(line);prior.confidence=.76;prior.flags=['Количество предположено: 1'];
   continue;
  }
  if(finished||ignore.test(line)||/^(?:\d{12,14}|\d{1,4}:\d{2}|\d+[.,]\d{2}\s*(?:руб|₽)?|[-_*=.\s]+)$/i.test(line))continue;
  if(/^(?:магнит|вкусвилл|пятерочка|пятёрочка|перекресток|перекрёсток|лента|дикси|ашан)$/i.test(line))continue;
  const original=line;
  let qty=1,unit='уп.',price=null,confidence=.4,flags=['Проверьте количество'];
  const mult=line.match(/(\d+(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?)?\s*[xх×*]\s*(\d{1,7}[.,]\d{2})(?:\s*(?:=)?\s*(\d{1,7}[.,]\d{2}))?/i);
  if(mult){qty=number(mult[1]);unit=mult[2]?(/кг/i.test(mult[2])?'кг':/^г/i.test(mult[2])?'г':'шт.'):'шт.';price=number(mult[4]||mult[3]);confidence=.9;flags=[];line=line.replace(mult[0],' ').trim();}
  else{
   const units=line.match(/(\d+(?:[.,]\d{1,3})?)\s*(кг|г|шт\.?|уп\.?|пак\.?|бан\.?)(?=\s|$)/i);
   if(units){qty=number(units[1]);unit=/кг/.test(units[2])?'кг':/^г/.test(units[2])?'г':/шт/.test(units[2])?'шт.':'уп.';line=line.replace(units[0],' ').trim();confidence=.75;flags=[];}
  }
  const money=line.match(/(?:^|\s)(\d{1,7}[.,]\d{2})\s*(?:₽|р\.?|руб\.?)?\s*$/i);
  if(money){if(price===null)price=number(money[1]);line=line.slice(0,money.index).trim();if(confidence<.76){confidence=.76;if(qty===1&&flags.length)flags=['Количество предположено: 1'];}}
  line=line.replace(/^[^a-zа-яё]+/i,'').replace(/[-_,.;:=\s]+$/,'').trim();
  if(line.length<3||line.length>120||!/[а-яёa-z]{2}/i.test(line)||ignore.test(line))continue;
  if(/фискальн|эквайрин|терминал|признак расчета|банк\.|оператор фд|офд/i.test(line))continue;
  if(!Number.isFinite(qty)||qty<=0)continue;
  result.push({name:line,raw:original,qty,unit,price,confidence,flags});
  if(result.length>=100)break;
 }
 return result;
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
 if(!scripts[globalName])scripts[globalName]=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=url;el.async=true;el.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('Библиотека не запустилась'));el.onerror=()=>reject(Error('Не удалось загрузить библиотеку (интернет или CDN).'));document.head.append(el);});
 try{return await scripts[globalName];}catch(e){delete scripts[globalName];throw e;}
}
async function ocr(image,status){
 status('Загружаю модуль распознавания русского текста…');
 const t=await script('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js','Tesseract');
 let worker;
 try{worker=await t.createWorker('rus+eng',1,{logger:m=>{if(m.status==='recognizing text')status('Распознавание: '+Math.round(m.progress*100)+'%');}});const res=await worker.recognize(image);return String(res?.data?.text||'');}
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
  const pdf=await script('https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js','pdfjsLib');
  pdf.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
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