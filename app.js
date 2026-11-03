/* Домашние запасы · v0.3 — локальные данные, обновление через service worker. */
(() => {
'use strict';
const DB_NAME='home-pantry-family-v1';
const DB_VERSION=1;
const STORES=['products','batches','movements','shopping','meta'];
const LOCATIONS=['Холодильник','Морозилка','Кухонный шкаф','Кладовая','Комната','Другое'];
const CATEGORIES=['Молочные продукты','Овощи','Фрукты','Крупы и бобовые','Хлеб','Напитки','Бакалея','Заморозка','Бытовые товары','Другое'];
const UNITS=['уп.','шт.','кг','г','л','мл'];
const ICONS={'Молочные продукты':'🥛','Овощи':'🥕','Фрукты':'🍎','Крупы и бобовые':'🌾','Хлеб':'🍞','Напитки':'🫖','Бакалея':'🧂','Заморозка':'❄️','Бытовые товары':'🧻','Другое':'📦'};
const $=sel=>document.querySelector(sel);
const main=$('#view');
let db, page='home', stockQuery='', stockCategory='Все', stockView='all', shoppingInput='', sortStock='name', importDraft=null, busy=false;
const E=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const format=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:3}).format(Number(n)||0);
const formatMoney=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2,style:'currency',currency:'RUB'}).format(Number(n)||0);
const uid=()=>globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const now=()=>new Date().toISOString();
const localDate=(d=new Date())=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`;};
const dayDiff=date=>{const a=new Date(`${date}T12:00:00`),b=new Date(`${localDate()}T12:00:00`);return Math.round((a-b)/86400000);};
const dateDisplay=date=>date?new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'}):'Срок не указан';
const toNumber=v=>Number(String(v||'').replace(',','.'));
function positive(v,name='Количество',allowZero=false){const n=toNumber(v);if(!Number.isFinite(n)|| (allowZero?n<0:n<=0))throw Error(`${name}: укажите корректное ${allowZero?'неотрицательное':'положительное'} число`);return Math.round(n*1000)/1000;}
function validateQty(q,unit){if(['уп.','шт.'].includes(unit)&&!Number.isInteger(q))throw Error('Упаковки и штуки учитываются целыми числами');return q;}
function pickOptions(arr,sel='',empty=false){return `${empty?'<option value="">Не указано</option>':''}${arr.map(x=>`<option value="${E(x)}" ${sel===x?'selected':''}>${E(x)}</option>`).join('')}`;}
function transaction(names,mode='readonly'){return db.transaction(names,mode);}
function request(req){return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});}
function txnComplete(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error||Error('Ошибка базы'));tx.onabort=()=>rej(tx.error||Error('Операция отменена'));});}
function writeMany(names,fn){const tx=transaction(names,'readwrite'),done=txnComplete(tx);fn(tx);return done;}
const all=name=>request(transaction([name]).objectStore(name).getAll());
const get=(name,key)=>request(transaction([name]).objectStore(name).get(key));
const put=(name,value)=>writeMany([name],tx=>tx.objectStore(name).put(value));
const del=(name,key)=>writeMany([name],tx=>tx.objectStore(name).delete(key));
async function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);
  r.onupgradeneeded=()=>{const d=r.result;for(const name of STORES)if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:'id'});};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('База заблокирована другой вкладкой'));
});}
async function snapshot(){const [products,batches,movements,shopping,meta]=await Promise.all(STORES.map(all));return {products,batches,movements,shopping,meta};}
function totals(s){const grouped=new Map();for(const b of s.batches){grouped.set(b.productId,(grouped.get(b.productId)||0)+Number(b.qty));}return grouped;}
const amountText=(num,unit)=>`${format(num)} ${unit}`;
function locationOptions(selected){return pickOptions(LOCATIONS,selected);}
function statusOfBatch(b){if(!b.expiry)return {text:'Без даты',css:'',days:null};const days=dayDiff(b.expiry);if(days<0)return {text:`Истёк ${dateDisplay(b.expiry)}`,css:'bad',days};if(days===0)return {text:'До сегодня',css:'warn',days};if(days<=3)return {text:`Осталось ${days} дн.`,css:'warn',days};return {text:`До ${dateDisplay(b.expiry)}`,css:'ok',days};}
function stockRows(s){const tot=totals(s);return s.products.map(p=>({...p,qty:tot.get(p.id)||0,parties:s.batches.filter(b=>b.productId===p.id)}));}
function safePercent(n){return Math.max(0,Math.min(100,n));}
let toastTimeout;
function toast(msg){const el=$('#toast');el.textContent=msg;el.style.display='block';clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.style.display='none',3800);}
function showModal(html){$('#modalInner').innerHTML=html;$('#modal').showModal();$('#modal').scrollTop=0;}
function closeModal(){if($('#modal').open)$('#modal').close();$('#modalInner').innerHTML='';}
function modalFoot(submit='Сохранить',cancel=true){return `<div class="modal-actions">${cancel?'<button type="button" class="btn secondary" data-act="close">Отмена</button>':''}<button type="submit" class="btn primary">${E(submit)}</button></div>`;}
function sectionTitle(title,right=''){return `<div class="section-header"><h2>${title}</h2>${right}</div>`;}
function empty(icon,title,descr,btn=''){return `<div class="empty"><div class="glyph">${icon}</div><h3>${title}</h3><p>${descr}</p>${btn}</div>`;}
function stockItem(row,{compact=false}={}){
  const urgent=row.parties.filter(b=>b.expiry&&dayDiff(b.expiry)<=3).length;
  const below=row.minQty!=null&&row.qty<row.minQty;
  const zero=row.qty===0;
  return `<div class="stockrow"><div class="product-emoji">${ICONS[row.category]||'📦'}</div><div class="grow" style="min-width:0"><div class="name clip">${E(row.name)}</div><div class="meta">${E(row.category)} · ${E(row.locationDefault||'Кухонный шкаф')}${row.store?' · '+E(row.store):''}</div><div class="badgeline">${zero?'<span class="pill bad">Нет дома</span>':below?'<span class="pill warn">Нужно докупить</span>':''}${urgent?`<span class="pill warn">Срок: ${urgent} парт.</span>`:''}</div></div><div style="text-align:right"><div class="amount">${amountText(row.qty,E(row.unit))}</div>${!compact?`<div class="flex" style="justify-content:flex-end;margin-top:7px"><button class="mini-button" data-act="consume" data-id="${row.id}" title="Списать">−</button><button class="mini-button" data-act="addBatch" data-id="${row.id}" title="Пополнить">+</button><button class="mini-button" data-act="renameProduct" data-id="${row.id}" title="Переименовать">✎</button><button class="mini-button" data-act="detail" data-id="${row.id}" title="Детали">›</button></div>`:`<button class="minor" data-act="detail" data-id="${row.id}">Подробнее</button>`}</div></div>`;
}
function importantExpiry(s){return s.batches.filter(b=>b.qty>0&&b.expiry&&dayDiff(b.expiry)<=3).sort((a,b)=>a.expiry.localeCompare(b.expiry));}
function needRestock(rows){return rows.filter(r=>r.minQty!=null&&r.qty<r.minQty);}
function warningBackup(meta){const backup=meta.find(x=>x.id==='lastBackup');return !backup?.value || (Date.now()-new Date(backup.value).getTime())>7*86400000;}
async function render(){if(!db)return;const s=await snapshot();const rows=stockRows(s);document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  let html='';switch(page){case 'home':html=renderHome(s,rows);break;case 'stock':html=renderStock(s,rows);break;case 'audit':html=renderAudit(s,rows);break;case 'shopping':html=renderShopping(s,rows);break;case 'settings':html=renderSettings(s);break;}
  main.innerHTML=html;
}
function renderHome(s,rows){const exp=importantExpiry(s),need=needRestock(rows),open=s.shopping.filter(x=>x.status==='open');const totalsCosts=s.movements.filter(x=>x.type==='purchase'&&x.amount>0).reduce((sum,x)=>sum+x.amount,0);
  let h=`<h1>Что есть дома</h1><p class="sub">Запасы, сроки и ближайшие покупки в одном месте.</p><div class="kpi-grid"><button type="button" class="kpi kpi-link" data-go="stock" aria-label="Открыть список домашних запасов для редактирования"><div class="mini-icon" aria-hidden="true">▤</div><strong>${rows.filter(x=>x.qty>0).length}</strong><span>Видов товаров дома</span></button><button type="button" class="kpi kpi-link" data-go="shopping" aria-label="Открыть список покупок"><div class="mini-icon" aria-hidden="true">▣</div><strong>${open.length}</strong><span>Позиций в закупке</span></button><button type="button" class="kpi kpi-link" data-go="stock" data-stock-view="expiry" aria-label="Показать товары с истекающим или истекшим сроком годности"><div class="mini-icon" aria-hidden="true">◷</div><strong>${exp.length}</strong><span>Истекает или просрочено</span></button><button type="button" class="kpi kpi-link" data-go="stock" data-stock-view="restock" aria-label="Показать товары, которые нужно пополнить"><div class="mini-icon" aria-hidden="true">↗</div><strong>${need.length}</strong><span>Нужно пополнить</span></button></div>`;
  if(warningBackup(s.meta)&&rows.length)h+=`<div class="card alert-card spaced"><div class="row"><div class="grow"><div class="title">Резервная копия</div><div class="meta">${s.meta.find(x=>x.id==='lastBackup')?'Прошло более 7 дней с последней копии':'Ещё не создана. Сохраните данные на Google Drive.'}</div></div><button class="btn small secondary" data-act="backup">Создать</button></div></div>`;
  if(!rows.length)h+=empty('📦','Начните с ревизии','Добавьте 5–10 продуктов, чтобы проверить удобство учёта. Данные сохраняются только на этом устройстве.','<div class="actions"><button class="btn primary" data-act="newProduct">Добавить продукт</button><button class="btn secondary" data-act="demo">Пример данных</button></div>');
  else h+=`<div class="actions spaced"><button class="btn primary" data-act="newProduct">＋ Добавить продукт</button><button class="btn secondary" data-go="audit">Быстрая ревизия</button></div>`;
  if(need.length){h+=sectionTitle('Пора пополнить',`<button class="minor" data-go="shopping">К покупкам →</button>`);h+=`<div class="card">${need.slice(0,5).map(r=>`<div class="row"><div class="grow"><div class="title">${E(r.name)}</div><div class="meta">Дома ${amountText(r.qty,E(r.unit))} · минимум ${amountText(r.minQty,E(r.unit))}</div></div><span class="pill warn">Купить</span></div>`).join('')}</div>`;}
  if(exp.length){h+=sectionTitle('Контроль сроков');h+=`<div class="card">${exp.slice(0,5).map(b=>{const p=s.products.find(x=>x.id===b.productId);const st=statusOfBatch(b);return `<div class="row"><div class="grow"><div class="title">${E(p?.name||'Товар удалён')}</div><div class="meta">${amountText(b.qty,E(p?.unit||''))} · ${E(b.location)}</div></div><span class="pill ${st.css}">${E(st.text)}</span></div>`;}).join('')}</div>`;}
  if(s.movements.length){const recent=[...s.movements].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5);h+=sectionTitle('Последние изменения');h+=`<div class="card">${recent.map(m=>`<div class="row"><div class="grow"><div class="title">${E(m.productName||'Товар')}</div><div class="meta">${E(m.reason||m.type)} · ${new Date(m.at).toLocaleDateString('ru-RU')}</div></div><span class="amount">${m.delta>0?'+':''}${format(m.delta)} ${E(m.unit||'')}</span></div>`).join('')}</div>`;}
  if(totalsCosts>0)h+=`<p class="footer-note">Учтено расходов по подтверждённым покупкам: ${formatMoney(totalsCosts)}. Это сумма только тех покупок, для которых внесена цена.</p>`;
  return h;
}
function renderStock(s,rows){
 const isExpiry=stockView==='expiry',isRestock=stockView==='restock';
 const urgentParties=isExpiry?importantExpiry(s):[];
 const filtered=rows.filter(r=>{
  if(isExpiry&&!r.parties.some(b=>b.qty>0&&b.expiry&&dayDiff(b.expiry)<=3))return false;
  if(isRestock&&!(r.minQty!=null&&r.qty<r.minQty))return false;
  return (stockCategory==='Все'||r.category===stockCategory)&&r.name.toLowerCase().includes(stockQuery.toLowerCase());
 });
 filtered.sort((a,b)=>isExpiry?
  Math.min(...a.parties.filter(x=>x.qty>0&&x.expiry&&dayDiff(x.expiry)<=3).map(x=>dayDiff(x.expiry)))-
  Math.min(...b.parties.filter(x=>x.qty>0&&x.expiry&&dayDiff(x.expiry)<=3).map(x=>dayDiff(x.expiry)))
  :sortStock==='qty'?a.qty-b.qty:a.name.localeCompare(b.name,'ru'));
 const title=isExpiry?'Истекает или просрочено':isRestock?'Нужно пополнить':'Запасы';
 const subtitle=isExpiry?urgentParties.length+' партий · '+filtered.length+' товаров':
  isRestock?filtered.length+' товаров ниже установленного минимума':
  rows.length+' видов товаров · списание целыми упаковками';
 const header=`<div class="row"><div><h1>${title}</h1><p class="sub">${subtitle}</p></div><button class="btn primary" data-act="newProduct">＋ Товар</button></div>`;
 const returnAll=isExpiry||isRestock?'<button type="button" class="btn secondary full spaced" data-go="stock">← Показать все товары</button>':'';
 const itemHtml=filtered.map(r=>{
  const detail=isExpiry?
   '<div class="stock-filter-detail">'+r.parties.filter(b=>b.qty>0&&b.expiry&&dayDiff(b.expiry)<=3).sort((a,b)=>a.expiry.localeCompare(b.expiry))
   .map(b=>'<div class="stock-filter-line">'+E(statusOfBatch(b).text)+' · '+amountText(b.qty,E(r.unit))+' · '+E(b.location)+'</div>').join('')+'</div>':
  isRestock?'<div class="stock-filter-detail">Дома '+amountText(r.qty,E(r.unit))+' · минимум '+amountText(r.minQty,E(r.unit))+(r.targetQty!=null?' · цель '+amountText(r.targetQty,E(r.unit)):'')+'</div>':'';
  return '<div class="stock-filter-item">'+stockItem(r)+detail+'</div>';
 }).join('');
 const placeholder=isExpiry?'Сейчас нет товаров с истёкшим или истекающим в ближайшие три дня сроком годности.':
 isRestock?'Нет товаров ниже минимального остатка. Добавьте минимумы в карточках товаров, если хотите получать рекомендации.':
 'Измените поиск или категорию.';
 return header+returnAll+
 '<button class="btn secondary full spaced" data-act="scanCode">▣ Сканировать штрихкод / Честный знак</button>'+
 `<div class="searchbar"><input id="stockSearch" type="search" placeholder="Поиск по названию" value="${E(stockQuery)}" /></div><div class="tabline">${['Все',...CATEGORIES].map(c=>`<button class="chip ${stockCategory===c?'active':''}" data-category="${E(c)}">${E(c)}</button>`).join('')}</div>`+
 '<div class="card">'+(filtered.length?itemHtml:empty('🔎','Ничего не найдено',placeholder))+'</div>'+
 '<div class="notice">Целая упаковка считается в запасе до полного расходования. Открытые упаковки отдельно не отслеживаются.</div>';
}

function renderAudit(s,rows){const list=[...rows].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  return `<h1>Быстрая ревизия</h1><p class="sub">Впишите, сколько фактически лежит дома, и сохраните только изменения. Сроки и места хранения существующих партий сохраняются при уменьшении остатков.</p>${list.length?`<form data-form="audit"><div class="card">${list.map(r=>`<div class="inline-form" style="padding:11px 0;border-bottom:1px solid var(--line)"><div class="title">${E(r.name)}<div class="meta">Сейчас ${amountText(r.qty,E(r.unit))}</div></div><input type="number" inputmode="decimal" min="0" step="${['уп.','шт.'].includes(r.unit)?1:'any'}" name="audit_${r.id}" data-audit="${r.id}" value="${r.qty}" aria-label="Количество ${E(r.name)}"/><span class="small muted">${E(r.unit)}</span></div>`).join('')}</div><button type="submit" class="btn primary full">Сохранить изменения</button></form>`:empty('📋','Пока нечего проверять','Добавьте товары, чтобы начать ревизию.','<button class="btn primary" data-act="newProduct">＋ Добавить товар</button>')}<div class="spaced"><button class="btn secondary full" data-act="newProduct">Добавить новый товар</button></div>`;
}
function renderShopping(s,rows){const list=s.shopping.filter(x=>x.status==='open').sort((a,b)=>a.createdAt.localeCompare(b.createdAt));const restock=needRestock(rows);return `<h1>Покупки</h1><p class="sub">Сначала формируйте список. Домашние запасы меняются только после подтверждения покупки.</p><div class="actions"><button class="btn primary" data-act="newShopping">＋ Добавить</button><button class="btn secondary" data-act="importText">⇪ Импорт текста</button></div>${restock.length?`<div class="card soft spaced"><div class="row"><div class="grow"><div class="title">Есть товары ниже минимума</div><div class="meta">${restock.length} наименований. Можно добавить в закупку до целевого запаса.</div></div><button class="btn small secondary" data-act="restock">Добавить</button></div></div>`:''}${sectionTitle('Список к покупке',`<span class="pill ok">${list.length} поз.</span>`)}${list.length?`<div class="card">${list.map(item=>`<div class="stockrow"><input class="check" type="checkbox" disabled title="Покупка оформляется кнопкой Куплено"/><div class="grow"><div class="name">${E(item.name)}</div><div class="meta">${amountText(item.qty,E(item.unit))}${item.store?' · '+E(item.store):''}</div>${item.note?`<div class="purchase-hint">${E(item.note)}</div>`:''}</div><div class="stack" style="gap:5px"><button class="btn primary small" data-act="buy" data-id="${item.id}">Куплено</button><button class="btn text small" data-act="editShopping" data-id="${item.id}">Изменить</button><button class="btn text small" data-act="deleteShopping" data-id="${item.id}">Убрать</button></div></div>`).join('')}</div>`:empty('🧺','Список пуст','Добавьте нужное или вставьте сообщение с покупками.')}<div class="notice">Кнопка «Куплено» открывает подтверждение количества, срока годности, места хранения и цены. Частично купленная позиция остаётся в списке.</div>`;}
function renderSettings(s){const backup=s.meta.find(x=>x.id==='lastBackup')?.value;const bytes=JSON.stringify(s).length;const sum=s.movements.filter(x=>x.type==='purchase').reduce((a,x)=>a+(Number(x.amount)||0),0);
  return `<h1>Настройки и данные</h1><p class="sub">Всё хранится локально на этом устройстве. Учёт не синхронизируется между телефонами.</p>${sectionTitle('Резервные копии')}<div class="card"><div class="title">Google Drive — через сохранение файла</div><p class="sub" style="margin:8px 0">Создайте JSON-копию, затем сохраните файл в Google Drive через меню Android или приложение «Файлы».</p><div class="actions"><button class="btn primary" data-act="backup">↓ Экспорт JSON</button><button class="btn secondary" data-act="restore">↑ Восстановить</button></div><div class="meta">${backup?'Последний экспорт: '+new Date(backup).toLocaleString('ru-RU'):'Резервная копия ещё не создавалась'} · Объём данных: ~${format(Math.ceil(bytes/1024))} КБ</div></div>${sectionTitle('Данные')}<div class="card"><div class="row"><div><div class="title">Товары и партии</div><div class="meta">${s.products.length} товаров · ${s.batches.length} партий</div></div></div><div class="row"><div><div class="title">Операции</div><div class="meta">${s.movements.length} записей · расходы ${formatMoney(sum)}</div></div></div><div class="row"><div class="grow"><div class="title">Экспорт таблицы CSV</div><div class="meta">Для Excel или другой программы</div></div><button class="btn small secondary" data-act="csv">Скачать</button></div></div>${sectionTitle('Проверка и обслуживание')}<div class="card"><button class="btn secondary full" data-act="demo">Добавить демонстрационные товары</button><p class="form-help">Демо-данные добавляются к существующим. Для чистого начала доступен сброс.</p><button class="btn danger full spaced" data-act="reset">Удалить все данные</button></div><button class="btn secondary full spaced" data-act="persistent">Попросить браузер сохранить локальные данные</button><p class="form-help">Браузер может отказать; резервная копия всё равно обязательна.</p><div class="notice">Версия 0.6 · Кликабельные карточки главного экрана, умный импорт с каталогом, заметками и выбором названия. Фотоимпорт, полноценные рекомендации по хранению, замены и расширенная аналитика будут добавлены следующими этапами. Не вводите единственную копию важных данных, пока не проверите экспорт и восстановление.</div>`;
}
function formProduct(p={}){const edit=Boolean(p.id);return `<h2>${edit?'Изменить товар':'Новый товар'}</h2><form data-form="product" data-id="${E(p.id||'')}"><div class="form-grid"><div class="span2"><label>Название *</label><input name="name" placeholder="Например, молоко 2,5%" value="${E(p.name||'')}" required maxlength="120" autofocus /></div><div><label>Категория</label><select name="category">${pickOptions(CATEGORIES,p.category||'Другое')}</select></div><div><label>Единица учёта</label><select name="unit" ${edit?'disabled':''}>${pickOptions(UNITS,p.unit||'уп.')}</select>${edit?'<div class="form-help">Для сохранения остатков единица существующего товара пока не меняется.</div>':''}</div><div><label>Минимум</label><input name="minQty" type="number" inputmode="decimal" min="0" step="any" placeholder="Например, 1" value="${p.minQty!=null?E(p.minQty):''}" /></div><div><label>Целевой запас</label><input name="targetQty" type="number" inputmode="decimal" min="0" step="any" placeholder="Например, 3" value="${p.targetQty!=null?E(p.targetQty):''}" /></div><div><label>Место по умолчанию</label><select name="locationDefault">${locationOptions(p.locationDefault||'Кухонный шкаф')}</select></div><div><label>Предпочтительный магазин</label><select name="store">${pickOptions(['Магнит','ВкусВилл','Другой'],p.store||'',true)}</select></div><div class="span2"><label>Допустимые замены (необязательно)</label><input name="substitutes" placeholder="Например, другой бренд" value="${E(p.substitutes||'')}" /></div>${!edit?`<div><label>Сейчас дома</label><input name="initialQty" type="number" inputmode="decimal" min="0" step="any" value="0" /></div><div><label>Годен до</label><input name="expiry" type="date" /></div>`:''}</div><div class="spaced"><label>Штрихкод / GTIN (необязательно)</label><input name="barcode" inputmode="numeric" pattern="[0-9]{8,14}" placeholder="8–14 цифр" value="${E(p.barcode||'')}" /></div><p class="form-help">Для молока можно выбрать «уп.»: учитываем пакет целиком, даже если его уже открыли. Партию с другой датой добавляйте через «Пополнить».</p>${modalFoot(edit?'Сохранить':'Добавить товар')}</form>`;}

function formRename(p, suggested, codeValue){
 const title=suggested===undefined?p.name:suggested,barcode=codeValue===undefined?(p.barcode||''):codeValue;
 const inferred=window.PantryCatalog?.parseMessage(p.name)?.[0]?.name||p.name;
 const suggestions=window.PantryCatalog?.suggest(inferred)||[];
 const chips=suggestions.filter(x=>x!==title).map(x=>'<button class="suggestion-chip" data-rename-choice="'+E(x)+'" type="button">'+E(x)+'</button>').join('');
 return '<h2>Исправить название</h2><p class="sub">Остатки и даты годности сохранятся.</p><form data-form="rename" data-id="'+E(p.id)+'"><label>Название товара *</label><input name="name" value="'+E(title)+'" maxlength="120" required autofocus />'+
 (chips?'<div class="suggestion-section"><div class="meta">Возможные названия из каталога:</div><div class="suggestion-chips">'+chips+'</div></div>':'')+
 '<input type="hidden" name="barcode" value="'+E(barcode)+'" /><div class="actions spaced"><button type="button" class="btn secondary full" data-act="scanCode" data-id="'+E(p.id)+'">▣ Найти название по штрихкоду</button></div>'+modalFoot('Сохранить название')+'</form>';
}
async function renameProduct(id,name,barcode){
 const p=await get('products',id);if(!p)throw Error('Товар не найден');
 name=String(name||'').trim();if(!name)throw Error('Введите название товара');
 if(name.length>120)throw Error('Слишком длинное название');
 barcode=String(barcode||'').trim();if(barcode&&!/^\d{8,14}$/.test(barcode))throw Error('Некорректный GTIN');
 const [products,movements,shopping]=await Promise.all(['products','movements','shopping'].map(all));
 if(products.some(x=>x.id!==id&&x.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru')&&x.unit===p.unit))throw Error('Товар с таким названием и единицей уже есть. Проверьте дубликат.');
 await writeMany(['products','movements','shopping'],tx=>{
  tx.objectStore('products').put({...p,name,barcode,updatedAt:now()});
  for(const m of movements.filter(x=>x.productId===id))tx.objectStore('movements').put({...m,productName:name});
  for(const item of shopping.filter(x=>x.productId===id))tx.objectStore('shopping').put({...item,name,updatedAt:now()});
 });
}
// Parse GS1 AI 01 from Data Matrix; do not store or transmit the individual serial number.
function codeFromScan(raw){
 const value=String(raw||'').trim().replace(/^\]d2/,'').replace(/^\u001d/,'');
 const match=value.match(/^(?:\(01\)|01)(\d{14})/);
 if(match)return match[1];
 if(/^\d{8,14}$/.test(value))return value;
 throw Error('Не найден GTIN. Нужен обычный штрихкод или Data Matrix с идентификатором 01.');
}
const equalCode=(a,b)=>String(a||'').replace(/^0+/,'')===String(b||'').replace(/^0+/,'');
async function findCodeName(code){
 const candidates=[code];
 if(code.length===14&&code.startsWith('0'))candidates.unshift(code.slice(1));
 for(const value of candidates){
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),7000);
  try {
   const url='https://world.openfoodfacts.org/api/v2/product/'+encodeURIComponent(value)+'?fields=product_name,product_name_ru,brands,quantity';
   const res=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
   if(!res.ok)continue;
   const data=await res.json();
   if(data.status!==1||!data.product)continue;
   const p=data.product,base=String(p.product_name_ru||p.product_name||'').trim();
   if(base){
    const brand=String(p.brands||'').split(',')[0].trim();
    return brand&&!base.toLocaleLowerCase('ru').includes(brand.toLocaleLowerCase('ru'))?base+' — '+brand:base;
   }
  }catch(_){ /* Offline, blocked request, or missing product: allow manual entry. */ }
  finally{clearTimeout(timeout);}
 }
 return '';
}
async function handleCodeScan(id){
 if(!window.PantryScanner?.scan)throw Error('Сканер не загружен. Перезагрузите приложение.');
 closeModal();
 const raw=await window.PantryScanner.scan();if(!raw)return;
 const barcode=codeFromScan(raw);
 const products=await all('products'),known=products.find(x=>x.barcode&&equalCode(x.barcode,barcode));
 if(!id&&known){
  const batches=(await all('batches')).filter(b=>b.productId===known.id);
  showModal(renderDetail(known,batches));toast('Этот товар уже есть в запасах');return;
 }
 const suggestion=known?.name||await findCodeName(barcode);
 if(id){
  const p=await get('products',id);if(!p)throw Error('Товар не найден');
  showModal(formRename(p,suggestion||p.name,barcode));
 }else showModal(formProduct({name:suggestion,barcode}));
 toast(suggestion?'Проверьте найденное название и сохраните товар':'Название не найдено. Введите его вручную.');
}

function formBatch(p){return `<h2>Пополнить: ${E(p.name)}</h2><form data-form="batch" data-id="${p.id}"><div class="form-grid"><div><label>Сколько добавить (${E(p.unit)}) *</label><input name="qty" type="number" inputmode="decimal" min="${['уп.','шт.'].includes(p.unit)?1:'.001'}" step="${['уп.','шт.'].includes(p.unit)?1:'any'}" value="1" required autofocus /></div><div><label>Годен до</label><input name="expiry" type="date" /></div><div class="span2"><label>Место хранения</label><select name="location">${locationOptions(p.locationDefault)}</select></div></div><p class="form-help">Если дата неизвестна, оставьте её пустой. Она не будет выдумана автоматически.</p>${modalFoot('Добавить в запасы')}</form>`;}
function formConsume(p,qty){return `<h2>Списать: ${E(p.name)}</h2><form data-form="consume" data-id="${p.id}"><div class="form-grid"><div><label>Количество (${E(p.unit)})</label><input name="qty" type="number" inputmode="decimal" min="${['уп.','шт.'].includes(p.unit)?1:'.001'}" step="${['уп.','шт.'].includes(p.unit)?1:'any'}" max="${qty}" value="${Math.min(1,qty)}" required /></div><div><label>Причина</label><select name="reason"><option>Использовано</option><option>Испорчено</option><option>Передано</option><option>Другое</option></select></div></div><p class="form-help">В первую очередь списывается партия с ближайшим сроком годности. Открытие упаковки не требует отдельной отметки.</p>${modalFoot('Списать')}</form>`;}
function formShopping(item={},products=[]){const selected=item.productId||'';return `<h2>${item.id?'Изменить покупку':'Добавить в закупку'}</h2><form data-form="shopping" data-id="${E(item.id||'')}"><div class="form-grid"><div class="span2"><label>Товар из каталога (необязательно)</label><select name="productId"><option value="">Новый / не выбран</option>${products.sort((a,b)=>a.name.localeCompare(b.name,'ru')).map(p=>`<option value="${p.id}" ${selected===p.id?'selected':''}>${E(p.name)} (${E(p.unit)})</option>`).join('')}</select></div><div class="span2"><label>Название *</label><input name="name" value="${E(item.name||'')}" required /></div><div><label>Количество *</label><input name="qty" type="number" min="0.001" step="any" value="${E(item.qty??1)}" required /></div><div><label>Единица</label><select name="unit">${pickOptions(UNITS,item.unit||'уп.')}</select></div><div class="span2"><label>Магазин</label><select name="store">${pickOptions(['Магнит','ВкусВилл','Другой'],item.store||'',true)}</select></div><div class="span2"><label>Пожелания (необязательно)</label><textarea name="note" rows="2" maxlength="500">${E(item.note||'')}</textarea></div></div><p class="form-help">Если единица из сообщения отличается от единицы товара в каталоге, уточните её перед поступлением.</p>${modalFoot(item.id?'Сохранить':'В список покупок')}</form>`;}
function formBuy(item,p){const unit=p?.unit||item.unit;const mismatch=p&&p.unit!==item.unit;return `<h2>Подтвердить покупку</h2><p class="sub">${E(item.name)} · запланировано ${amountText(item.qty,E(item.unit))}</p>${item.note?`<div class="notice">${E(item.note)}</div>`:'' }<form data-form="buy" data-id="${item.id}"><div class="form-grid"><div class="span2"><label>Фактически куплено (${E(unit)}) *</label><input name="qty" type="number" inputmode="decimal" min="${['уп.','шт.'].includes(unit)?1:0.001}" step="${['уп.','шт.'].includes(unit)?'1':'any'}" value="${mismatch?'':item.qty}" placeholder="Введите количество" required /></div><div><label>Годен до</label><input name="expiry" type="date" /></div><div><label>Место хранения</label><select name="location">${locationOptions(p?.locationDefault||'Кухонный шкаф')}</select></div><div class="span2"><label>Сумма покупки, ₽ (необязательно)</label><input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Например, 189.90" /></div>${!p?`<div class="span2"><label>Категория нового товара</label><select name="category">${pickOptions(CATEGORIES,window.PantryCatalog?.categoryForName(item.name)||'Другое')}</select></div>`:''}</div>${mismatch?`<div class="notice warn">В закупке указано «${E(item.unit)}», в каталоге — «${E(p.unit)}». Количество не пересчитано автоматически. Укажите купленное в единицах каталога.</div>`:''}${!p?'<p class="form-help">Товар ещё не заведен. При подтверждении он появится в каталоге.</p>':''}${modalFoot('Подтвердить поступление')}</form>`;}
function renderDetail(p,batches){const qty=batches.reduce((sum,b)=>sum+b.qty,0);const sorted=[...batches].sort((a,b)=>(a.expiry||'9999').localeCompare(b.expiry||'9999'));
return `<h2>${E(p.name)}</h2><div class="row"><div><div class="title">Дома ${amountText(qty,E(p.unit))}</div><div class="meta">${E(p.category)} · ${E(p.store||'Магазин не выбран')}</div></div><span class="pill ${p.minQty!=null&&qty<p.minQty?'warn':'ok'}">${p.minQty!=null?'Мин. '+amountText(p.minQty,E(p.unit)):'Без минимума'}</span></div>${sectionTitle('Партии')}${sorted.length?sorted.map(b=>{const st=statusOfBatch(b);return `<div class="item-card"><div class="row"><div><div class="title">${amountText(b.qty,E(p.unit))} · ${E(b.location)}</div><div class="meta">${b.expiry?'Годен до '+dateDisplay(b.expiry):'Дата годности не указана'}</div></div>${st.css?`<span class="pill ${st.css}">${E(st.text)}</span>`:''}</div></div>`;}).join(''):'<div class="notice">Партии пока отсутствуют.</div>'}<div class="actions spaced"><button class="btn primary" data-act="addBatch" data-id="${p.id}">＋ Пополнить</button><button class="btn secondary" data-act="consume" data-id="${p.id}" ${qty===0?'disabled':''}>− Списать</button></div><div class="actions spaced"><button class="btn secondary" data-act="renameProduct" data-id="${p.id}">Переименовать</button><button class="btn secondary" data-act="editProduct" data-id="${p.id}">Изменить товар</button><button class="btn danger" data-act="deleteProduct" data-id="${p.id}">Удалить</button></div><div class="spaced"><button class="btn text full" data-act="close">Закрыть</button></div>`;}
async function saveProduct(fd,productId){
  const previous=productId?await get('products',productId):null;
  if(productId&&!previous)throw Error('Товар не найден');
  const name=String(fd.get('name')||'').trim();if(!name)throw Error('Введите название');
  const category=String(fd.get('category'));
  const unit=previous?.unit||String(fd.get('unit'));
  if(!UNITS.includes(unit))throw Error('Неизвестная единица измерения');
  const minRaw=String(fd.get('minQty')||'').trim(),targetRaw=String(fd.get('targetQty')||'').trim();
  const minQty=minRaw?validateQty(positive(minRaw,'Минимум',true),unit):null;
  const targetQty=targetRaw?validateQty(positive(targetRaw,'Цель',true),unit):null;
  if(minQty!=null&&targetQty!=null&&targetQty<minQty)throw Error('Целевой запас не должен быть меньше минимального');
  const barcode=String(fd.get('barcode')||'').trim();
  if(barcode&&!/^\d{8,14}$/.test(barcode))throw Error('Штрихкод должен содержать 8–14 цифр');
  const product={...(previous||{}),id:previous?.id||uid(),name,barcode,category,unit,minQty,targetQty,locationDefault:String(fd.get('locationDefault')),store:String(fd.get('store')||''),substitutes:String(fd.get('substitutes')||'').trim(),updatedAt:now(),createdAt:previous?.createdAt||now()};
  const initial=previous?0:validateQty(positive(fd.get('initialQty')||'0','Остаток',true),unit);
  const expiry=previous?'':String(fd.get('expiry')||'');
  await writeMany(['products','batches','movements'],tx=>{
    tx.objectStore('products').put(product);
    if(initial>0){const b={id:uid(),productId:product.id,qty:initial,location:product.locationDefault,expiry,receivedAt:now()};tx.objectStore('batches').put(b);tx.objectStore('movements').put({id:uid(),type:'initial',productId:product.id,productName:name,unit,delta:initial,at:now(),reason:'Первоначальная ревизия',batchId:b.id});}
  });
  return product;
}
async function addBatch(product,qty,expiry='',location='',reason='Пополнение',type='add',amount=null){
  const n=validateQty(positive(qty),product.unit);
  const b={id:uid(),productId:product.id,qty:n,location:location||product.locationDefault,expiry,receivedAt:now()};
  await writeMany(['batches','movements'],tx=>{
    tx.objectStore('batches').put(b);
    tx.objectStore('movements').put({id:uid(),productId:product.id,productName:product.name,unit:product.unit,batchId:b.id,type,delta:n,amount:amount===null?undefined:amount,reason,at:now()});
  });
}
async function spend(product,qty,reason='Использовано',type='consume'){
  const n=validateQty(positive(qty),product.unit);
  const batches=(await all('batches')).filter(b=>b.productId===product.id&&b.qty>0).sort((a,b)=>(a.expiry||'9999-12-31').localeCompare(b.expiry||'9999-12-31')||a.receivedAt.localeCompare(b.receivedAt));
  const total=batches.reduce((v,b)=>v+b.qty,0);
  if(n-total>0.00001)throw Error(`В запасах только ${amountText(total,product.unit)}`);
  let remain=n;
  await writeMany(['batches','movements'],tx=>{
    const bs=tx.objectStore('batches'),ms=tx.objectStore('movements');
    for(const b of batches){if(remain<.000001)break;
      const taken=Math.min(remain,b.qty);remain=Math.round((remain-taken)*1000)/1000;
      const rest=Math.round((b.qty-taken)*1000)/1000;
      if(rest<=.000001)bs.delete(b.id);else bs.put({...b,qty:rest});
      ms.put({id:uid(),productId:product.id,productName:product.name,unit:product.unit,batchId:b.id,delta:-taken,at:now(),type,reason});
    }
  });
}
async function auditProduct(product,actual){
  const qty=validateQty(positive(actual,'Фактическое количество',true),product.unit);
  const batches=(await all('batches')).filter(b=>b.productId===product.id);
  const current=Math.round(batches.reduce((v,b)=>v+b.qty,0)*1000)/1000;
  const diff=Math.round((qty-current)*1000)/1000;
  if(diff>0)await addBatch(product,diff,'',product.locationDefault,'Корректировка ревизии','audit');
  else if(diff<0)await spend(product,-diff,'Корректировка ревизии','audit');
  return diff;
}
async function addShopping(item){await put('shopping',{id:item.id||uid(),name:String(item.name).trim(),productId:item.productId||null,qty:item.qty,unit:item.unit,store:item.store||'',note:String(item.note||'').trim().slice(0,500),status:'open',createdAt:item.createdAt||now(),updatedAt:now()});}
async function saveShopping(fd,itemId){const original=itemId?await get('shopping',itemId):null;const productId=String(fd.get('productId')||'');const p=productId?await get('products',productId):null;
  const name=p?.name||String(fd.get('name')||'').trim(),unit=p?.unit||String(fd.get('unit'));
  if(!name)throw Error('Укажите название');const qty=validateQty(positive(fd.get('qty')),unit);
  await addShopping({...original,id:original?.id,productId:p?.id||null,name,unit,qty,store:String(fd.get('store')||p?.store||''),note:String(fd.get('note')||'')});
}
async function addNeeds(s){const rows=stockRows(s);const needs=needRestock(rows);let n=0;
  for(const p of needs){const target=Math.max(p.minQty,p.targetQty??p.minQty);const proposed=target-p.qty;let qty=['уп.','шт.'].includes(p.unit)?Math.ceil(proposed):Math.round(proposed*1000)/1000;
    if(qty<=0)continue;
    const existing=s.shopping.find(x=>x.status==='open'&&x.productId===p.id);
    if(existing){if(existing.qty<qty){await put('shopping',{...existing,qty,updatedAt:now()});n++;}}
    else {await addShopping({name:p.name,unit:p.unit,qty,productId:p.id,store:p.store});n++;}
  }
  return n;
}
function normName(name){return String(name).toLocaleLowerCase('ru-RU').replace(/[ё]/g,'е').replace(/["'«»()]/g,'').replace(/\s+/g,' ').trim();}
function parseList(input){
 const lines=input.replace(/\r/g,'\n').split(/\n|;|,\s*(?=[А-ЯЁа-яёA-Za-z])/).map(x=>x.trim().replace(/^[•*\-\d.)\s]+/,'').trim()).filter(Boolean);
 const result=[];
 const unitPattern='упаков(?:ка|ки|ок)|уп\\.?|пач(?:ка|ки|ек)|пакет(?:а|ов)?|шт\\.?|штук[иа]?|кг|килограмм(?:а|ов)?|г\\.?|грамм(?:а|ов)?|л\\.?|литр(?:а|ов)?|мл';
 const regex=new RegExp(`^(.+?)\\s+(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern})(?:\\s+по\\s+(\\d+(?:[.,]\\d+)?)\\s*(${unitPattern}))?\\s*$`,'i');
 function cleanUnit(v){const u=v.toLowerCase().replace('.','');if(/^(уп|пач|пакет)/.test(u))return 'уп.';if(/^(шт|штук)/.test(u))return 'шт.';if(u==='кг'||u.startsWith('килограмм'))return 'кг';if(u==='г'||u.startsWith('грамм'))return 'г';if(u==='мл')return 'мл';return 'л';}
 for(const line of lines){let match=line.match(regex);let name,qty,unit,note='';
  if(match){name=match[1].trim();qty=toNumber(match[2]);unit=cleanUnit(match[3]);if(match[4])note=`По ${match[4]} ${match[5]}`;}
  else {const trailing=line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);if(trailing){name=trailing[1].trim();qty=toNumber(trailing[2]);unit='шт.';note='Единица предположена: штуки';}else {name=line;qty=null;unit='уп.';note='Уточните количество';}}
  if(!name)continue;
  const prev=result.find(x=>normName(x.name)===normName(name)&&x.unit===unit&&x.qty!=null&&qty!=null&&!x.note&&!note);
  if(prev)prev.qty=Math.round((prev.qty+qty)*1000)/1000;
  else result.push({name,qty,unit,note});
 }
 return result;
}
async function submitImport(rows,originalText){
 const s=await snapshot();let count=0;
 const token=normName(originalText),hash=String([...token].reduce((n,c)=>((n*31)>>>0)+c.codePointAt(0)>>>0,0));
 const hist=s.meta.find(x=>x.id==='importHashes')?.value||[];
 if(hist.includes(hash)&&!confirm('Этот текст уже импортировался. Продолжить повторное добавление?'))return 0;
 const learned={...(s.meta.find(x=>x.id==='importAliases')?.value||{})};
 for(const r of rows){
  if(!r.include)continue;
  const name=String(r.name||'').trim().slice(0,120);
  if(!name)throw Error('В одной из строк отсутствует название');
  if(!UNITS.includes(r.unit))throw Error('Неизвестная единица товара');
  const qty=validateQty(positive(r.qty,'Количество для «'+name+'»'),r.unit);
  const note=String(r.note||'').trim().slice(0,500);
  const p=s.products.find(p=>normName(p.name)===normName(name)&&p.unit===r.unit);
  const existing=s.shopping.find(x=>x.status==='open'&&(p?x.productId===p.id:!x.productId&&normName(x.name)===normName(name)&&x.unit===r.unit));
  const shop=r.store||p?.store||'';
  if(existing){
   // Repeated imports do not double requested quantity.
   const next={...existing,qty:Math.max(Number(existing.qty),qty),
     note:note||existing.note||'',store:shop||existing.store||'',updatedAt:now()};
   if(next.qty!==existing.qty||next.note!==existing.note||next.store!==existing.store){await put('shopping',next);count++;}
  }else{
   await addShopping({name:p?.name||name,unit:r.unit,qty,productId:p?.id,store:shop,note});
   count++;
  }
  if(r.originalName&&normName(r.originalName)!==normName(name)){
   learned[window.PantryCatalog?.normalize(r.originalName)||normName(r.originalName)]=p?.name||name;
  }
 }
 await put('meta',{id:'importAliases',value:learned});
 await put('meta',{id:'importHashes',value:[...hist,hash].slice(-100)});
 return count;
}
async function buyShopping(item,fd){
 let product=item.productId?await get('products',item.productId):null;
 const qty=validateQty(positive(fd.get('qty')),product?.unit||item.unit);
 const expiry=String(fd.get('expiry')||''),location=String(fd.get('location')||'Кухонный шкаф');
 const amountRaw=String(fd.get('amount')||'').trim(),amount=amountRaw?positive(amountRaw,'Стоимость',true):null;
 const isNew=!product;
 if(isNew){const matches=(await all('products')).filter(p=>normName(p.name)===normName(item.name)&&p.unit===item.unit);if(matches.length)product=matches[0];}
 if(!product)product={id:uid(),name:item.name,unit:item.unit,category:String(fd.get('category')||'Другое'),minQty:null,targetQty:null,locationDefault:location,store:item.store||'',substitutes:'',createdAt:now(),updatedAt:now()};
 const batch={id:uid(),productId:product.id,qty,expiry,location,receivedAt:now()};
 const remain=Math.round((item.qty-qty)*1000)/1000;
 // Несовместимые единицы нельзя вычитать друг из друга.
 const compatible=item.unit===product.unit;
 await writeMany(['products','batches','movements','shopping'],tx=>{
  if(isNew)tx.objectStore('products').put(product);
  tx.objectStore('batches').put(batch);
  tx.objectStore('movements').put({id:uid(),productId:product.id,productName:product.name,unit:product.unit,batchId:batch.id,type:'purchase',delta:qty,reason:'Покупка',note:item.note||'',amount:amount===null?undefined:amount,at:now(),store:item.store||''});
  if(compatible&&remain>0.00001)tx.objectStore('shopping').put({...item,qty:remain,updatedAt:now()});
  else tx.objectStore('shopping').delete(item.id);
 });
}
function download(content,name,type='application/json;charset=utf-8'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function backup(){const s=await snapshot();const data={app:'domashnie-zapasy',schema:1,exportedAt:now(),data:s};download(JSON.stringify(data,null,2),`domashnie-zapasy-${localDate()}.json`);await put('meta',{id:'lastBackup',value:now()});toast('Файл создан. Сохраните его в Google Drive через «Файлы» или меню Android.');}
function validateBackup(obj){if(!obj||obj.app!=='domashnie-zapasy'||obj.schema!==1||!obj.data)throw Error('Это не резервная копия приложения версии 1');
 for(const name of STORES)if(!Array.isArray(obj.data[name]))throw Error(`В файле отсутствует раздел ${name}`);
 for(const p of obj.data.products)if(!p||typeof p.id!=='string'||typeof p.name!=='string'||!UNITS.includes(p.unit))throw Error('Повреждена запись товара');
 const ids=new Set(obj.data.products.map(x=>x.id));if(ids.size!==obj.data.products.length)throw Error('Повторяющиеся идентификаторы товаров');
 for(const b of obj.data.batches)if(!b||typeof b.id!=='string'||!ids.has(b.productId)||!Number.isFinite(b.qty)||b.qty<=0)throw Error('Повреждена запись партии');
 for(const name of STORES)for(const row of obj.data[name])if(!row||typeof row.id!=='string')throw Error(`Повреждена запись ${name}`);
 return obj.data;
}
async function restoreFile(file){const raw=await file.text();let data;try{data=validateBackup(JSON.parse(raw));}catch(e){throw Error(`Не удалось прочитать резервную копию: ${e.message}`);}
 if(!confirm(`В копии ${data.products.length} товаров и ${data.batches.length} партий. ЗАМЕНИТЬ все текущие данные? Отменить операцию после восстановления нельзя.`))return;
 if(!confirm('Вы уверены? Перед заменой рекомендуется экспортировать текущие данные.'))return;
 await writeMany(STORES,tx=>{for(const name of STORES){const store=tx.objectStore(name);store.clear();for(const row of data[name])store.put(row);}});
 toast(`Восстановлено товаров: ${data.products.length}`);
 await render();
}
function exportCsv(s){const batches=s.batches;const records=s.products.map(p=>{const bs=batches.filter(b=>b.productId===p.id);return [p.name,p.category,p.unit,bs.reduce((a,b)=>a+b.qty,0),p.minQty??'',p.targetQty??'',p.store||'',bs.map(b=>`${b.qty} ${p.unit} (${b.location}, до ${b.expiry||'не указан'})`).join('; ')];});
 const csv=[['Наименование','Категория','Единица','Остаток','Минимум','Цель','Магазин','Партии'],...records].map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');download('\uFEFF'+csv,`domashnie-zapasy-${localDate()}.csv`,'text/csv;charset=utf-8');toast('CSV-файл создан');}
function modalImportInput(){showModal(`<h2>Импорт списка из текста</h2><p class="sub">Скопируйте сообщение из Telegram или другого мессенджера. Каждый товар — с новой строки.</p><form data-form="importInput"><label>Сообщение</label><textarea name="text" rows="8" placeholder="Молоко 2 уп.\nГречка 1 уп.\nБананы 5 шт.\nТворог 3 уп." required></textarea><p class="form-help">Пока поддерживается текст. Импорт фотографий появится в следующем этапе разработки.</p>${modalFoot('Распознать')}</form>`);}
function modalImportReview(entries,source){
 importDraft={entries,source};
 const html='<h2>Проверка списка</h2><p class="sub">Сначала выделены названия и пожелания. Выберите подходящее название одним нажатием или оставьте своё. Ничего не заменяется автоматически.</p>'+
 '<form data-form="importReview"><div class="stack">'+
 entries.map((row,i)=>'<div class="candidate" data-row="'+i+'">'+
 '<div class="meta"><strong>Из сообщения:</strong> '+E(row.raw||row.name)+'</div>'+
 '<label>Название товара *</label><input name="name_'+i+'" value="'+E(row.name)+'" maxlength="120" required />'+
 (row.suggestions?.length?'<div class="suggestion-section"><div class="meta">Варианты из каталога — нажмите, чтобы выбрать:</div><div class="suggestion-chips">'+
 row.suggestions.filter(v=>v!==row.name).map(v=>'<button class="suggestion-chip" type="button" data-pick-row="'+i+'" data-choice="'+E(v)+'">'+E(v)+'</button>').join('')+
 '<button class="suggestion-chip selected" type="button" data-pick-row="'+i+'" data-choice="'+E(row.name)+'">Оставить как есть</button></div></div>':'')+
 '<div class="form-grid spaced">'+
 '<div><label>Количество *</label><input type="number" inputmode="decimal" min="0.001" step="any" name="qty_'+i+'" value="'+E(row.qty??1)+'" required />'+(row.missingQty?'<div class="form-help">В сообщении не указано — предложена 1 ед.</div>':'')+'</div>'+
 '<div><label>Единица</label><select name="unit_'+i+'">'+pickOptions(UNITS,row.unit||'уп.')+'</select></div>'+
 '<div><label>Магазин</label><select name="store_'+i+'">'+pickOptions(['Магнит','ВкусВилл','Другой'],row.store||'',true)+'</select></div>'+
 '<div><label>Добавить в список</label><input class="check" type="checkbox" name="include_'+i+'" checked aria-label="Включить товар" /></div>'+
 '<div class="span2"><label>Пожелания и альтернативы</label><textarea name="note_'+i+'" maxlength="500" rows="2">'+E(row.note||'')+'</textarea></div>'+
 '</div></div>').join('')+'</div>'+modalFoot('Добавить в закупку')+'</form>';
 showModal(html);
}
async function demoData(){if(!confirm('Добавить 6 ДЕМОНСТРАЦИОННЫХ товаров к вашим данным? Их можно затем удалить.'))return;
 const items=[
  {name:'Молоко 2,5%',category:'Молочные продукты',unit:'уп.',qty:3,minQty:2,targetQty:4,locationDefault:'Холодильник',store:'Магнит',days:6},
  {name:'Яблоки',category:'Фрукты',unit:'шт.',qty:6,minQty:4,targetQty:10,locationDefault:'Холодильник',days:null},
  {name:'Гречка 900 г',category:'Крупы и бобовые',unit:'уп.',qty:1,minQty:2,targetQty:3,locationDefault:'Кухонный шкаф',days:250},
  {name:'Творог 180 г',category:'Молочные продукты',unit:'уп.',qty:2,minQty:1,targetQty:3,locationDefault:'Холодильник',store:'ВкусВилл',days:2},
  {name:'Бананы',category:'Фрукты',unit:'шт.',qty:0,minQty:3,targetQty:6,locationDefault:'Комната',days:null},
  {name:'Туалетная бумага',category:'Бытовые товары',unit:'уп.',qty:1,minQty:2,targetQty:3,locationDefault:'Кладовая',days:null}
 ];
 const existing=(await all('products')).map(p=>normName(p.name));let count=0;
 for(const itm of items){if(existing.includes(normName(itm.name)))continue;
  const expiry=itm.days==null?'':localDate(new Date(Date.now()+itm.days*86400000));
  const p={id:uid(),name:itm.name,category:itm.category,unit:itm.unit,minQty:itm.minQty,targetQty:itm.targetQty,locationDefault:itm.locationDefault,store:itm.store||'',substitutes:'',createdAt:now(),updatedAt:now(),isDemo:true};
  await writeMany(['products','batches','movements'],tx=>{tx.objectStore('products').put(p);if(itm.qty){const b={id:uid(),productId:p.id,qty:itm.qty,location:p.locationDefault,expiry,receivedAt:now()};tx.objectStore('batches').put(b);tx.objectStore('movements').put({id:uid(),productId:p.id,productName:p.name,unit:p.unit,delta:itm.qty,at:now(),type:'initial',reason:'Демонстрационные данные',batchId:b.id});}});
  count++;
 }
 toast(`Добавлено тестовых товаров: ${count}`);
 await render();
}
async function doAction(action,id){switch(action){
 case 'close':closeModal();break;
 case 'newProduct':showModal(formProduct());break;
 case 'editProduct':{const p=await get('products',id);showModal(formProduct(p));break;}
 case 'renameProduct':{const p=await get('products',id);if(!p)throw Error('Товар не найден');showModal(formRename(p));break;}
 case 'scanCode':{await handleCodeScan(id);break;}
 case 'detail':{const p=await get('products',id),bs=(await all('batches')).filter(b=>b.productId===id);showModal(renderDetail(p,bs));break;}
 case 'addBatch':{const p=await get('products',id);showModal(formBatch(p));break;}
 case 'consume':{const p=await get('products',id),qty=(await all('batches')).filter(b=>b.productId===id).reduce((n,b)=>n+b.qty,0);if(!qty){toast('Товара сейчас нет дома');return;}showModal(formConsume(p,qty));break;}
 case 'deleteProduct':{
   const p=await get('products',id);if(!p)return;
   const qty=(await all('batches')).filter(b=>b.productId===id).reduce((n,b)=>n+b.qty,0);
   if(qty>0)throw Error('Перед удалением товара спишите его остатки.');
   if(!confirm(`Удалить карточку «${p.name}»? История операций сохранится.`))return;
   await del('products',id);closeModal();await render();toast('Карточка удалена');break;
 }
 case 'newShopping':showModal(formShopping({},await all('products')));break;
 case 'editShopping':{const item=await get('shopping',id);showModal(formShopping(item,await all('products')));break;}
 case 'deleteShopping':{if(!confirm('Убрать позицию из списка покупок?'))return;await del('shopping',id);await render();break;}
 case 'buy':{const item=await get('shopping',id),p=item.productId?await get('products',item.productId):null;showModal(formBuy(item,p));break;}
 case 'restock':{const n=await addNeeds(await snapshot());toast(n?`Список обновлён: ${n} поз.`:'Не нужно добавлять: товары уже есть в закупке');await render();break;}
 case 'importText':modalImportInput();break;
 case 'backup':await backup();await render();break;
 case 'restore':{
   const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.style.display='none';document.body.append(input);
   input.onchange=async()=>{try{if(input.files?.[0])await restoreFile(input.files[0]);}catch(e){alert(e.message);}finally{input.remove();}};
   input.click();setTimeout(()=>{if(document.body.contains(input)&&!input.files?.length)input.remove();},120000);break;
 }
 case 'persistent':{
   if(!navigator.storage?.persist)throw Error('Этот браузер не поддерживает режим постоянного хранения');
   const granted=await navigator.storage.persist();
   toast(granted?'Браузер разрешил постоянное хранение. Но резервные копии всё равно нужны.':'Браузер не предоставил режим постоянного хранения. Сохраняйте резервные копии регулярно.');
   break;
 }
 case 'csv':exportCsv(await snapshot());break;
 case 'demo':await demoData();break;
 case 'reset':{
   if(!confirm('УДАЛИТЬ все домашние запасы, покупки и историю на этом устройстве? Операция необратима.'))return;
   if(prompt('Для подтверждения введите УДАЛИТЬ')!=='УДАЛИТЬ')return;
   await writeMany(STORES,tx=>STORES.forEach(n=>tx.objectStore(n).clear()));closeModal();page='home';await render();toast('Локальные данные очищены');break;
 }
 }}
async function doForm(form){const fd=new FormData(form),type=form.dataset.form,id=form.dataset.id;
 switch(type){
 case 'product':{const p=await saveProduct(fd,id);closeModal();await render();toast(id?'Карточка изменена':`Добавлен товар: ${p.name}`);break;}
 case 'rename':{await renameProduct(id,fd.get('name'),fd.get('barcode'));closeModal();await render();toast('Название обновлено');break;}
 case 'batch':{const p=await get('products',id);await addBatch(p,fd.get('qty'),String(fd.get('expiry')||''),String(fd.get('location')||''));closeModal();await render();toast('Запас пополнен');break;}
 case 'consume':{const p=await get('products',id);await spend(p,fd.get('qty'),String(fd.get('reason')||'Использовано'));closeModal();await render();toast('Списано из запасов');break;}
 case 'shopping':{await saveShopping(fd,id);closeModal();await render();toast('Список покупок обновлён');break;}
 case 'buy':{const item=await get('shopping',id);if(!item)throw Error('Покупка не найдена');await buyShopping(item,fd);closeModal();await render();toast('Покупка внесена в домашние запасы');break;}
 case 'audit':{
   const products=await all('products');let n=0;
   for(const p of products){const value=fd.get(`audit_${p.id}`);if(value===null)continue;const diff=await auditProduct(p,value);if(diff!==0)n++;}
   await render();toast(n?`Обновлено товаров: ${n}`:'Остатки не изменились');break;
 }
 case 'importInput':{
  const txt=String(fd.get('text')||'').trim();if(!txt)throw Error('Вставьте список');const entries=window.PantryCatalog?.parseMessage(txt)||parseList(txt);
  const existing=await all('products'),learned=(await get('meta','importAliases'))?.value||{};
  for(const row of entries)row.suggestions=window.PantryCatalog?.suggest(row.name,existing,learned)||[];
  if(!entries.length)throw Error('Не удалось найти товары в сообщении');modalImportReview(entries,txt);break;
 }
 case 'importReview':{
   if(!importDraft)throw Error('Список не найден. Вставьте текст заново.');
   const entries=importDraft.entries.map((r,i)=>({name:String(fd.get(`name_${i}`)||''),originalName:r.name,qty:fd.get(`qty_${i}`),unit:String(fd.get(`unit_${i}`)||'уп.'),note:String(fd.get(`note_${i}`)||''),store:String(fd.get(`store_${i}`)||''),include:fd.has(`include_${i}`)}));
   const count=await submitImport(entries,importDraft.source);closeModal();importDraft=null;await render();toast(`Новых или изменённых позиций: ${count}`);break;
 }
 }
}
function setPage(p,view='all'){page=p;stockView=p==='stock'?view:'all';stockQuery='';stockCategory='Все';render();window.scrollTo({top:0,behavior:'instant'});}
function events(){
 document.addEventListener('click',async e=>{
  const nav=e.target.closest('[data-page],[data-go]');if(nav){setPage(nav.dataset.page||nav.dataset.go,nav.dataset.stockView||'all');return;}
  const category=e.target.closest('[data-category]');if(category){stockCategory=category.dataset.category;await render();return;}
  const renamePick=e.target.closest('[data-rename-choice]');
  if(renamePick){
   e.preventDefault();
   const input=renamePick.closest('form')?.querySelector('input[name="name"]');
   if(input){input.value=renamePick.dataset.renameChoice;renamePick.closest('form').querySelectorAll('[data-rename-choice]').forEach(x=>x.classList.toggle('selected',x===renamePick));}
   return;
  }
  const pick=e.target.closest('[data-pick-row]');
  if(pick){
   e.preventDefault();
   const rowId=Number(pick.dataset.pickRow),card=pick.closest('.candidate');
   const input=card?.querySelector('input[name="name_'+rowId+'"]');
   if(input){input.value=pick.dataset.choice;card.querySelectorAll('[data-pick-row]').forEach(x=>x.classList.toggle('selected',x===pick));}
   return;
  }
  const btn=e.target.closest('[data-act]');if(!btn||busy)return;
  e.preventDefault();busy=true;
  try{await doAction(btn.dataset.act,btn.dataset.id);}catch(err){alert(`Не удалось выполнить действие: ${err.message}`);}finally{busy=false;}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target.closest('form[data-form]');if(!form)return;e.preventDefault();if(busy)return;
  busy=true;try{await doForm(form);}catch(err){alert(`Проверьте данные: ${err.message}`);}finally{busy=false;}
 });
 document.addEventListener('input',e=>{if(e.target.id==='stockSearch'){const cursor=e.target.selectionStart;stockQuery=e.target.value;render().then(()=>{const input=$('#stockSearch');if(input){input.focus();input.setSelectionRange(cursor,cursor);}});}});
 $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});
 $('#backupShortcut').addEventListener('click',async()=>{setPage('settings');});
}
async function init(){try{
  if(!('indexedDB' in window))throw Error('Браузер не поддерживает IndexedDB. Используйте актуальный Chrome на Android.');
  db=await openDb();events();await render();
  if('serviceWorker' in navigator && ['https:','http:'].includes(location.protocol)){
    const alreadyControlled=Boolean(navigator.serviceWorker.controller);
    let reloading=false, updatePending=false, lastChecked=0;
    const showUpdatePrompt=()=>{
      if(document.querySelector('#updatePrompt'))return;
      const banner=document.createElement('div');
      banner.id='updatePrompt';banner.className='update-prompt';banner.setAttribute('role','status');
      banner.innerHTML='<span>Доступна новая версия приложения</span><button type="button" class="btn primary small">Обновить</button>';
      banner.querySelector('button').addEventListener('click',()=>{reloading=true;location.reload();});
      document.body.appendChild(banner);
    };
    const applyUpdate=()=>{
      if(!updatePending||reloading)return;
      const focused=document.activeElement;
      const editing=busy||$('#modal')?.open||Boolean(focused?.matches('input, textarea, select, [contenteditable="true"]'));
      if(editing){showUpdatePrompt();return;}
      reloading=true;location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!alreadyControlled)return; // First install, not an update.
      updatePending=true;
      applyUpdate();
    });
    navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>{
      const check=()=>{
        if(Date.now()-lastChecked<30000)return;
        lastChecked=Date.now();reg.update().catch(err=>console.warn('Проверка обновления:',err));
      };
      check();
      window.addEventListener('focus',check);
      document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){check();if(updatePending)applyUpdate();}});
    }).catch(err=>console.warn('Service worker не подключился:',err));
  }
  if(location.protocol==='file:')toast('Для надёжной работы и установки PWA откройте приложение по HTTPS.');
 }catch(err){main.innerHTML=`<div class="card danger-card"><h2>Не удалось открыть приложение</h2><p class="sub">${E(err.message)}</p><p>Откройте его в актуальном Chrome на Android через HTTPS.</p></div>`;}
}
init();
})();
