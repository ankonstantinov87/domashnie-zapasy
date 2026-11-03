/**
 * Домашние запасы — приватный Google Sheets backend.
 * Файл для привязанного к Google Таблице проекта Apps Script.
 * Синхронизация OFF до setupPantrySync() и публикации веб-приложения.
 *
 * Выполнение: от имени владельца; доступ: «Все» только с секретным токеном.
 * Публичный репозиторий содержит КОД, но не токен и не семейные данные.
 */
const PANTRY_COLUMNS={
 products:{sheet:'Товары'},batches:{sheet:'Партии'},
 shopping:{sheet:'Закупка'},movements:{sheet:'Операции'},meta:{sheet:'Мета'}
};
const PANTRY_MAX_ROWS=1000;
const PANTRY_MAX_BYTES=1500000;
const PANTRY_REV_KEY='cloudRevision';
const PANTRY_TOKEN_KEY='PANTRY_SYNC_TOKEN';

function setupPantrySync(){
 const ss=SpreadsheetApp.getActiveSpreadsheet();
 if(!ss)throw Error('Создайте Apps Script через «Расширения» внутри общей Google Таблицы.');
 const p=PropertiesService.getScriptProperties();
 p.setProperty('PANTRY_SHEET_ID',ss.getId());
 if(!p.getProperty(PANTRY_TOKEN_KEY)){
  p.setProperty(PANTRY_TOKEN_KEY,[Utilities.getUuid(),Utilities.getUuid(),Utilities.getUuid()].join('-'));
 }
 Logger.log('Настройка сохранена. СЕКРЕТНЫЙ КЛЮЧ (не присылать в чат): '+p.getProperty(PANTRY_TOKEN_KEY));
 Logger.log('Этот ключ вводится только в настройках вашего приложения.');
 return 'Настройка завершена';
}
function pantrySS(){
 const id=PropertiesService.getScriptProperties().getProperty('PANTRY_SHEET_ID');
 if(!id)throw Error('Сначала запустите setupPantrySync().');
 return SpreadsheetApp.openById(id);
}
function pantrySetting(ss,key,write){
 const sh=ss.getSheetByName('Настройки');if(!sh)throw Error('Нет листа Настройки');
 const data=sh.getRange(1,1,Math.max(sh.getLastRow(),1),2).getValues();
 let row=data.findIndex((x,i)=>i>0&&String(x[0])===key)+1;
 if(!row){
  if(write===undefined)return '';
  row=sh.getLastRow()+1;sh.getRange(row,1).setValue(key);
 }
 if(write!==undefined)sh.getRange(row,2).setValue(String(write));
 return write===undefined?String(sh.getRange(row,2).getValue()||''):String(write);
}
function pantryAuth(input){
 const expected=PropertiesService.getScriptProperties().getProperty(PANTRY_TOKEN_KEY);
 if(!expected||!input||String(input)!==expected)throw Error('Неверный ключ синхронизации');
}
function pantryRead(ss){
 const data={};
 for(const [store,info] of Object.entries(PANTRY_COLUMNS)){
  const sh=ss.getSheetByName(info.sheet);if(!sh)throw Error('Нет листа '+info.sheet);
  const width=sh.getLastColumn(),height=sh.getLastRow();
  const all=sh.getRange(1,1,Math.max(height,1),width).getValues();
  const headers=all[0].map(x=>String(x||''));
  const jsonIndex=headers.indexOf('_json');
  const records=[];
  for(let i=1;i<all.length;i++){
   const values=all[i],identifier=values[headers.indexOf('id')];
   if(!identifier)continue;
   let row={};
   if(jsonIndex>=0&&values[jsonIndex]){
    try{row=JSON.parse(String(values[jsonIndex]));}catch(e){throw Error('Повреждён JSON в листе '+info.sheet+', строка '+(i+1));}
   }
   for(let col=0;col<headers.length;col++){
    const key=headers[col];if(!key||key==='_json')continue;
    const value=values[col];
    if(value===null||value===undefined)continue;
    if(key==='value'){
      if(typeof row.value==='object'&&row.value!==null)continue;
      row.value=value;
    }else if(['qty','delta','minQty','targetQty','amount','rev'].includes(key)){
      row[key]=value===''?null:Number(value);
    }else if(value instanceof Date){
      row[key]=Utilities.formatDate(value,'Etc/GMT','yyyy-MM-dd');
    }else row[key]=String(value);
   }
   records.push(row);
  }
  data[store]=records;
 }
 return data;
}
function pantryValidate(data){
 if(!data||typeof data!=='object')throw Error('Ожидаются данные приложения');
 for(const store of Object.keys(PANTRY_COLUMNS)){
  if(!Array.isArray(data[store])||data[store].length>PANTRY_MAX_ROWS)throw Error('Некорректный раздел '+store);
  const seen=new Set();
  for(const row of data[store]){
   if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||seen.has(row.id))throw Error('Некорректные ID в '+store);
   seen.add(row.id);
  }
 }
 const productIds=new Set(data.products.map(x=>x.id));
 for(const row of data.batches)if(!productIds.has(row.productId)||!(Number(row.qty)>0))throw Error('Некорректная партия');
 const safeMeta=data.meta.filter(row=>!/^sync(Config|Secret|Token)/i.test(row.id));
 return {...data,meta:safeMeta};
}
function pantryWrite(ss,data){
 for(const [store,info] of Object.entries(PANTRY_COLUMNS)){
  const sh=ss.getSheetByName(info.sheet);
  const headers=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  const rows=data[store].map(record=>headers.map(key=>{
   if(key==='_json')return JSON.stringify(record);
   const value=record[key];
   if(value===undefined||value===null)return '';
   const clean=typeof value==='object'?JSON.stringify(value):typeof value==='boolean'?String(value):value;
   // Keep user-provided text as text, not executable Sheets formulas.
   return typeof clean==='string'&&/^[=+@-]/.test(clean)?"'"+clean:clean;
  }));
  const toClear=sh.getLastRow()-1;
  if(toClear>0)sh.getRange(2,1,toClear,headers.length).clearContent();
  if(rows.length)sh.getRange(2,1,rows.length,headers.length).setValues(rows);
 }
}
function pantryAck(opId,status,error,revision){
 const key='pantry-ack-'+String(opId).slice(0,75);
 CacheService.getScriptCache().put(key,JSON.stringify({opId,status,error:error||'',revision}),1200);
}
function doPost(event){
 let opId='';
 try{
  const raw=event?.postData?.contents||'';
  if(raw.length>PANTRY_MAX_BYTES)throw Error('Пакет данных слишком большой');
  const body=JSON.parse(raw);opId=String(body.opId||'').slice(0,75);
  pantryAuth(body.token);
  if(body.action!=='push'||!opId||!/^[-a-zA-Z0-9_]{8,75}$/.test(opId))throw Error('Неверная операция');
  const lock=LockService.getScriptLock();lock.waitLock(24000);
  try{
   const ss=pantrySS();
   const current=Number(pantrySetting(ss,PANTRY_REV_KEY)||0);
   const lastOperation=pantrySetting(ss,'lastOperationId');
   if(lastOperation===opId){pantryAck(opId,'ok','',current);return ContentService.createTextOutput('ok');}
   if(Number(body.baseRev)!==current){
    pantryAck(opId,'conflict','Изменения в облаке. Данные не перезаписаны.',current);
    return ContentService.createTextOutput('conflict');
   }
   const content=pantryValidate(body.data);
   pantryWrite(ss,content);
   pantrySetting(ss,PANTRY_REV_KEY,current+1);
   pantrySetting(ss,'lastOperationId',opId);
   pantrySetting(ss,'dataStatus','active');
   const log=ss.getSheetByName('Синхронизация');
   if(log)log.appendRow([opId,String(body.deviceId||'').slice(0,80),'snapshot','','push','','',new Date().toISOString(),current,current+1,'ok']);
   SpreadsheetApp.flush();
   pantryAck(opId,'ok','',current+1);
  }finally{lock.releaseLock();}
 }catch(error){
  if(opId)pantryAck(opId,'error',String(error.message||error).slice(0,250),-1);
 }
 return ContentService.createTextOutput('accepted').setMimeType(ContentService.MimeType.TEXT);
}
function doGet(event){
 const query=event?.parameter||{};
 const nonce=String(query.nonce||'');
 const answer={nonce,ok:false,serverTime:new Date().toISOString()};
 try{
  pantryAuth(query.token);
  const ss=pantrySS();
  const rev=Number(pantrySetting(ss,PANTRY_REV_KEY)||0);
  answer.ok=true;answer.rev=rev;answer.lastOperationId=pantrySetting(ss,'lastOperationId');
  if(query.action==='pull')answer.data=pantryRead(ss);
  else if(query.action==='ack'){
   const opId=String(query.opId||'');
   const value=CacheService.getScriptCache().get('pantry-ack-'+opId.slice(0,75));
   answer.ack=value?JSON.parse(value):null;
  }else if(query.action!=='status')throw Error('Неизвестная операция');
 }catch(error){answer.error=String(error.message||error).slice(0,250);answer.ok=false;}
 const js='window.PantryCloud._receive('+JSON.stringify(answer)+');';
 return ContentService.createTextOutput(js).setMimeType(ContentService.MimeType.JAVASCRIPT);
}
