/* Домашние запасы — v1.0 подготовка приватной синхронизации.
   Ничего не передаёт, пока пользователь не подключит собственный Apps Script.
   Данные не публикуются в GitHub. Ключ хранится только в этом браузере. */
(()=>{
'use strict';
const CKEY='pantry.sync.config.v1', SKEY='pantry.sync.state.v1', DKEY='pantry.sync.device.v1';
const randid=()=>globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36);
const deviceId=localStorage.getItem(DKEY)||randid();
localStorage.setItem(DKEY,deviceId);
const pending=new Map();
let hooks=null,applying=false,checking=false,checkAt=0;
const jsonRead=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))||fallback}catch(_){return fallback}};
const config=()=>jsonRead(CKEY,null);
const state=()=>jsonRead(SKEY,{rev:null,dirty:false,changes:0,lastSync:null,conflict:false,pendingOp:null});
const stateWrite=s=>localStorage.setItem(SKEY,JSON.stringify(s));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const shortError=e=>e instanceof Error?e.message:String(e);
function saveConfig(url,token){
 url=String(url||'').trim();
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[-a-zA-Z0-9_]+\/exec(?:\?.*)?$/.test(url))throw Error('Нужен адрес развёрнутого Apps Script, заканчивающийся на /exec');
 token=String(token||'').trim();
 if(token.length<70)throw Error('Недействительный секретный ключ. Запустите setupPantrySync() в Google Apps Script.');
 const prior=config();
 localStorage.setItem(CKEY,JSON.stringify({url:url.split('?')[0],token}));
 if(!prior||prior.url!==url.split('?')[0]||prior.token!==token)
  stateWrite({rev:null,dirty:true,changes:0,lastSync:null,conflict:false,pendingOp:null});
}
function disconnect(){
 localStorage.removeItem(CKEY);
 // Never erase local inventory while disconnecting.
}
function markDirty(){
 if(applying)return;
 const s=state();s.dirty=true;s.changes=(Number(s.changes)||0)+1;if(s.pendingOp)s.uncertainOp=s.pendingOp;stateWrite(s);
}
function _receive(result){
 const nonce=String(result?.nonce||'');
 const p=pending.get(nonce);if(!p)return;
 pending.delete(nonce);clearTimeout(p.timer);p.script.remove();
 result.ok?p.resolve(result):p.reject(Error(result.error||'Облачный сервер не ответил'));
}
function request(action,query={}){
 const c=config();if(!c)throw Error('Облачная синхронизация ещё не подключена');
 if(!navigator.onLine)throw Error('Сейчас нет интернета. Данные остаются на устройстве.');
 const nonce=randid().replace(/[^a-zA-Z0-9_-]/g,'');
 return new Promise((resolve,reject)=>{
  const script=document.createElement('script');
  const params=new URLSearchParams({action,nonce,token:c.token,...query});
  script.src=c.url+'?'+params.toString();
  const timer=setTimeout(()=>{
   pending.delete(nonce);script.remove();
   reject(Error('Не удалось связаться с облаком. Проверьте Apps Script и подключение к интернету.'));
  },18000);
  pending.set(nonce,{resolve,reject,script,timer});
  script.onerror=()=>{const p=pending.get(nonce);if(!p)return;pending.delete(nonce);clearTimeout(timer);script.remove();reject(Error('Сервис синхронизации недоступен'));};
  document.head.appendChild(script);
 });
}
async function status(){return request('status');}
function hasLocalData(data){
 return ['products','batches','shopping','movements'].some(k=>(data[k]||[]).length>0);
}
async function applyRemote(server){
 if(!hooks)throw Error('Система хранения ещё не готова');
 applying=true;
 try{await hooks.apply(server.data);}
 finally{applying=false;}
 const s=state();s.rev=server.rev;s.dirty=false;s.pendingOp=null;s.conflict=false;s.lastSync=new Date().toISOString();stateWrite(s);
 if(hooks.updated)await hooks.updated();
}
async function synchronize(options={}){
 if(checking)return {status:'busy'};
 const c=config();if(!c)return {status:'disabled'};
 if(!hooks)throw Error('База приложения ещё не готова');
 if(!navigator.onLine)return {status:'offline'};
 if(hooks.idle&&!hooks.idle()&&!options.force)return {status:'editing'};
 checking=true;checkAt=Date.now();
 try{
  const remote=await status(),local=state(),data=await hooks.take();
  if(local.uncertainOp){
   const previous=await request('ack',{opId:local.uncertainOp});
   if(previous.ack?.status==='ok'||previous.lastOperationId===local.uncertainOp){
    stateWrite({...local,rev:previous.ack?.revision??previous.rev,dirty:true,pendingOp:null,uncertainOp:null});
    return {status:'needs-another-pass',message:'Предыдущая отправка подтверждена. Новые локальные изменения отправятся следующим проходом.'};
   }
   if(previous.ack?.status==='conflict'||previous.ack?.status==='error'){
    stateWrite({...local,pendingOp:null,uncertainOp:null,conflict:previous.ack.status==='conflict'});
   }else return {status:'uncertain',message:'Идёт проверка предыдущей отправки. Локальные изменения сохранены.'};
  }
  if(local.rev===null){
   if(remote.rev===0){
    if(hasLocalData(data)&&!options.initialize){
     return {status:'initial-local',message:'В этом браузере есть запасы. Для первого переноса нажмите «Отправить локальную базу».'};
    }
    if(!hasLocalData(data)){stateWrite({...local,rev:0,dirty:false,conflict:false});return {status:'empty'};}
   }else{
    if(hasLocalData(data))return {status:'initial-conflict',message:'На устройстве и в облаке есть разные данные. Сначала создайте JSON-копию и разберите конфликт.'};
    const fresh=await request('pull');await applyRemote(fresh);return {status:'pulled',rev:fresh.rev};
   }
  }
  const actual=state();
  if(actual.rev!==remote.rev){
   if(actual.dirty){
    stateWrite({...actual,conflict:true});
    return {status:'conflict',message:'Облако изменилось после последней синхронизации. Локальные данные не перезаписаны.'};
   }
   const fresh=await request('pull');await applyRemote(fresh);return {status:'pulled',rev:fresh.rev};
  }
  if(!actual.dirty)return {status:'up-to-date',rev:actual.rev};
  const initialChanges=actual.changes;
  const opId=actual.pendingOp||randid().replace(/[^a-zA-Z0-9_-]/g,'');
  stateWrite({...actual,pendingOp:opId});
  const body=JSON.stringify({action:'push',token:c.token,deviceId,opId,baseRev:actual.rev,data});
  if(body.length>1350000)throw Error('База слишком большая для одной синхронизации');
  // Cross-site POST in no-cors mode avoids dependence on CORS response headers.
  // We accept no opaque response as proof: acknowledgement is retrieved separately.
  await fetch(c.url,{method:'POST',mode:'no-cors',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body});
  let result=null;
  for(let i=0;i<20;i++){
   const ack=await request('ack',{opId});
   if(ack.ack){result=ack.ack;break;}
   if(ack.lastOperationId===opId){result={status:'ok',revision:ack.rev};break;}
   await sleep(600);
  }
  if(!result)throw Error('Нет подтверждения записи. Не загружайте базу повторно вручную — операция будет проверена по ID при следующей попытке.');
  if(result.status==='conflict'){
   const s=state();stateWrite({...s,conflict:true,pendingOp:null});
   return {status:'conflict',message:result.error};
  }
  if(result.status!=='ok')throw Error(result.error||'Облако отклонило запись');
  const s=state();
  const changedDuringUpload=s.changes!==initialChanges;
  stateWrite({...s,rev:result.revision,dirty:changedDuringUpload,conflict:false,pendingOp:null,lastSync:new Date().toISOString()});
  return {status:changedDuringUpload?'needs-another-pass':'uploaded',rev:result.revision};
 }finally{checking=false;}
}
function connect(h){
 hooks=h;
 const trySync=()=>{if(config()&&hooks?.idle?.()&&Date.now()-checkAt>30000)synchronize().catch(err=>console.warn('Sync:',shortError(err)));};
 window.addEventListener('online',trySync);
 window.addEventListener('focus',trySync);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')trySync();});
}
window.PantryCloud={_receive,saveConfig,disconnect,markDirty,synchronize,connect,config:()=>{const c=config();return c?{url:c.url,connected:true}:null},state,status,get applying(){return applying}};
})();