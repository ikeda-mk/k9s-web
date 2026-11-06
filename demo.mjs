import { ApiError, configuration, resourcePath, segment, summarize } from './kubernetes.mjs';
export function demoObjects(kind, namespace='default') {
  const meta=name=>({name,namespace,labels:{app:name},annotations:{'demo.example/description':'架空のデモデータ'},creationTimestamp:'2026-11-06T10:00:00Z'});
  const container={name:'web',image:'nginx:1.27',env:[{name:'MODE',value:'demo'},{name:'TOKEN',valueFrom:{secretKeyRef:{name:'web-secret',key:'token'}}}],resources:{limits:{cpu:'500m',memory:'128Mi'}},readinessProbe:{httpGet:{path:'/',port:80}}};
  if(kind==='pods') return ['web-7d8f6-abc12','worker-9c6d4-def34'].map((name,i)=>({apiVersion:'v1',kind:'Pod',metadata:meta(name),spec:{nodeName:'demo-node-01',containers:[container,{name:'sidecar',image:'busybox:1.37'}]},status:{phase:i?'Pending':'Running',containerStatuses:[{name:'web',ready:!i,restartCount:i?2:0}]}}));
  if(kind==='deployments') return ['web','worker'].map(name=>({apiVersion:'apps/v1',kind:'Deployment',metadata:meta(name),spec:{replicas:3,selector:{matchLabels:{app:name}},template:{metadata:{labels:{app:name}},spec:{containers:[container]}}},status:{availableReplicas:3,readyReplicas:3}}));
  if(kind==='services') return ['web','api'].map(name=>({apiVersion:'v1',kind:'Service',metadata:meta(name),spec:{type:'ClusterIP',clusterIP:'10.96.0.10',selector:{app:name},ports:[{name:'http',port:80,targetPort:8080}]}}));
  return ['web','api'].map((name,i)=>({apiVersion:'networking.k8s.io/v1',kind:'Ingress',metadata:meta(name),spec:{ingressClassName:'nginx',rules:[{host:`${name}.demo.example`,http:{paths:[{path:'/',pathType:'Prefix',backend:{service:{name,port:{number:80}}}}]}}],tls:[{hosts:[`${name}.demo.example`],secretName:'demo-tls'}]},status:{loadBalancer:{ingress:i?[]:[{ip:'192.0.2.10'}]}}}));
}
export class Demo {
  async contexts(){return {contexts:[{name:'demo-development',namespace:'default'},{name:'demo-staging',namespace:'staging'}],currentContext:'demo-development'};}
  async check(p,signal){ if(!(await this.contexts()).contexts.some(c=>c.name===p.context)) throw new ApiError(400,'Contextが見つかりません'); signal?.throwIfAborted(); }
  async namespaces(p,{signal}={}) {await this.check(p,signal); return {items:['default','staging','kube-system']};}
  async resources(p,{signal}={}) {await this.check(p,signal); resourcePath(p.kind,p.namespace); return {items:(p.namespace?[p.namespace]:['default','staging']).flatMap(ns=>demoObjects(p.kind,ns).map(i=>summarize(i,p.kind))),continuation:''};}
  async config(p,{signal}={}) {await this.check(p,signal); if(!['deployments','services','ingresses'].includes(p.kind)) throw new ApiError(400,'未対応のリソースです'); segment(p.namespace); segment(p.name); const obj=demoObjects(p.kind,p.namespace).find(i=>i.metadata.name===p.name); if(!obj) throw new ApiError(404,'リソースが見つかりません'); return configuration(obj);}
  async logs(p,{signal}={}) {await this.check(p,signal); segment(p.namespace); segment(p.pod); segment(p.container); if(!demoObjects('pods',p.namespace).some(i=>i.metadata.name===p.pod && i.spec.containers.some(c=>c.name===p.container))) throw new ApiError(404,'Podまたはコンテナが見つかりません'); return {text:`[デモ / ${p.context} / ${p.namespace}]\n${p.container}: ${p.previous==='true'?'前回起動時のログ':'現在のログ'}\n2026-11-06T10:00:00Z server ready\n2026-11-06T10:00:01Z GET /health 200\n<script>ログは文字列として表示されます</script>`};}
}
