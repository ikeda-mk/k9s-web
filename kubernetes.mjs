import http from 'node:http';
import https from 'node:https';
import { KubeConfig } from '@kubernetes/client-node';
import { dump } from 'js-yaml';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const bases = { pods: '/api/v1', services: '/api/v1', deployments: '/apis/apps/v1', ingresses: '/apis/networking.k8s.io/v1' };
export function segment(value, label = '名前') {
  if (typeof value !== 'string' || value.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) || value.includes('..')) throw new ApiError(400, `${label}が不正です`);
  return value;
}
export function resourcePath(kind, namespace, name) {
  if (!Object.hasOwn(bases, kind)) throw new ApiError(400, '未対応のリソースです');
  return bases[kind] + (namespace ? `/namespaces/${segment(namespace, 'Namespace')}` : '') + `/${kind}` + (name ? `/${segment(name)}` : '');
}
export function cleanConfig(object) {
  const walk = (value) => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (['status', 'managedFields', 'resourceVersion', 'kubectl.kubernetes.io/last-applied-configuration'].includes(key)) continue;
      Object.defineProperty(out, key, {value: walk(val), enumerable:true, writable:true, configurable:true});
    }
    for (const key of ['containers', 'initContainers', 'ephemeralContainers']) {
      if (Array.isArray(out[key])) for (const container of out[key]) for (const env of container.env || []) if (Object.hasOwn(env, 'value')) env.value = '[REDACTED]';
    }
    return out;
  };
  const cleaned = walk(object);
  return {apiVersion: cleaned.apiVersion, kind: cleaned.kind, metadata: Object.fromEntries(['name','namespace','labels','annotations'].filter(k => cleaned.metadata?.[k] !== undefined).map(k => [k, cleaned.metadata[k]])), spec: cleaned.spec};
}
export function configuration(object) {
  const config = cleanConfig(object);
  return {config, yaml: dump(config, {noRefs:true, lineWidth:120}), fetchedAt: new Date().toISOString()};
}
export function summarize(item, kind) {
  const m = item.metadata || {}, s = item.spec || {}, st = item.status || {};
  const base = {name:m.name, namespace:m.namespace, labels:m.labels || {}, createdAt:m.creationTimestamp};
  if (kind === 'pods') return {...base, status: st.containerStatuses?.find(c=>c.state?.waiting)?.state.waiting.reason || st.phase || 'Unknown', ready: `${(st.containerStatuses || []).filter(c=>c.ready).length}/${(s.containers || []).length}`, restarts:(st.containerStatuses || []).reduce((n,c)=>n+(c.restartCount || 0),0), node:s.nodeName || '', containers:[...(s.containers || []), ...(s.initContainers || []), ...(s.ephemeralContainers || [])].map(c=>({name:c.name, image:c.image}))};
  if (kind === 'deployments') return {...base, status:`${st.availableReplicas || 0}/${s.replicas ?? 1} Available`, ready:`${st.readyReplicas || 0}/${s.replicas ?? 1}`, images:s.template?.spec?.containers?.map(c=>c.image) || []};
  if (kind === 'services') return {...base, status:s.type || 'ClusterIP', address:s.clusterIP || '', ports:(s.ports || []).map(p=>`${p.port}/${p.protocol || 'TCP'}`)};
  const addresses=(st.loadBalancer?.ingress || []).map(a=>a.ip || a.hostname).filter(Boolean);
  return {...base, status:addresses.length ? '接続先あり（正常性未確認）':'接続先未割当', ingressClass:s.ingressClassName || m.annotations?.['kubernetes.io/ingress.class'] || '', hosts:(s.rules || []).map(r=>r.host || '*'), addresses};
}
export class Kubernetes {
  constructor({kubeConfig, timeout=15000}={}) { this.source=kubeConfig; this.timeout=timeout; }
  load() { if (this.source) return this.source; const kc=new KubeConfig(); kc.loadFromDefault(); return kc; }
  async contexts() {
    try { const kc=this.load(); return {contexts:kc.getContexts().map(c=>({name:c.name, namespace:c.namespace || 'default'})), currentContext:kc.getCurrentContext()}; }
    catch { throw new ApiError(500,'接続設定を読み込めません。kubeconfigを確認してください'); }
  }
  selected(name) {
    const source=this.load(), ctx=source.getContexts().find(c=>c.name===name);
    if (!ctx) throw new ApiError(400,'Contextが見つかりません');
    const kc=new KubeConfig();
    kc.loadFromOptions({clusters:source.getClusters(), users:source.getUsers(), contexts:[ctx], currentContext:name});
    return kc;
  }
  async get(context, path, {signal, text=false, maxBytes=8*1024*1024}={}) {
    const controller=new AbortController();
    const abort=()=>controller.abort(signal?.reason);
    if(signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(new ApiError(504,'Kubernetes APIがタイムアウトしました')),this.timeout);
    let agent;
    try {
      controller.signal.throwIfAborted();
      const kc=this.selected(context), cluster=kc.getCurrentCluster();
      if (!cluster) throw new ApiError(400,'Contextの接続先が見つかりません');
      const url=new URL(cluster.server.replace(/\/$/,'')+path);
      const opts={method:'GET', headers:{Accept:'application/json, */*;q=0.8'}};
      const authentication=kc.applyToHTTPSOptions(opts).then(()=>{agent=opts.agent;if(controller.signal.aborted) agent?.destroy();});
      await Promise.race([authentication, new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}))]);
      controller.signal.throwIfAborted();
      return await new Promise((resolve,reject)=>{
        const req=(url.protocol==='https:'?https:http).request(url,{...opts,signal:controller.signal},res=>{
          if(res.statusCode<200 || res.statusCode>=300) { res.resume(); reject(new ApiError(res.statusCode,`Kubernetes API: HTTP ${res.statusCode}${res.statusCode===403?'（権限不足）':''}`)); return; }
          let size=0; const chunks=[];
          res.on('data',chunk=>{size+=chunk.length; if(size>maxBytes) {req.destroy(new ApiError(502,'応答サイズが上限を超えました')); return;} chunks.push(chunk);});
          res.on('end',()=>{try {const body=Buffer.concat(chunks).toString('utf8'); resolve(text?body:JSON.parse(body));} catch {reject(new ApiError(502,'API応答の形式が不正です'));}});
          res.on('error',reject);
        }); req.on('error',reject); req.end();
      });
    } catch(e) {
      if(controller.signal.aborted) throw controller.signal.reason instanceof ApiError ? controller.signal.reason : new ApiError(499,'通信を中断しました');
      if(e instanceof ApiError) throw e;
      throw new ApiError(502,'Kubernetes APIへの接続または認証に失敗しました');
    } finally {clearTimeout(timer); signal?.removeEventListener('abort',abort);agent?.destroy();}
  }
  async namespaces(p, options) {
    let continuation='', items=[];
    do {const q=new URLSearchParams({limit:'500'}); if(continuation) q.set('continue',continuation); const data=await this.get(p.context,`/api/v1/namespaces?${q}`,options); items.push(...data.items.map(i=>i.metadata.name)); continuation=data.metadata?.continue || '';} while(continuation);
    return {items};
  }
  async resources(p, options) { const path=resourcePath(p.kind,p.namespace); const q=new URLSearchParams({limit:'500'}); if(p.continuation) q.set('continue',p.continuation); const data=await this.get(p.context,`${path}?${q}`,options); return {items:data.items.map(i=>summarize(i,p.kind)), continuation:data.metadata?.continue || ''}; }
  async config(p, options) { if(!['deployments','services','ingresses'].includes(p.kind)) throw new ApiError(400,'設定参照はDeployment・Service・Ingressのみ対応しています'); segment(p.namespace,'Namespace'); segment(p.name); return configuration(await this.get(p.context,resourcePath(p.kind,p.namespace,p.name),options)); }
  async logs(p, options) { segment(p.namespace,'Namespace'); segment(p.pod,'Pod'); segment(p.container,'コンテナ'); if(p.previous && !['true','false'].includes(p.previous)) throw new ApiError(400,'previousが不正です'); const q=new URLSearchParams({container:p.container,previous:p.previous || 'false',tailLines:'300',limitBytes:String(1024*1024)}); return {text:await this.get(p.context,`${resourcePath('pods',p.namespace,p.pod)}/log?${q}`,{...options,text:true,maxBytes:1024*1024})}; }
}
