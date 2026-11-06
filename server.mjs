import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Kubernetes, ApiError } from './kubernetes.mjs';
import { Demo } from './demo.mjs';
const files = {'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8']};
export function createServer({backend=new Kubernetes(),demo=false}={}) {
  return http.createServer(async(req,res)=>{
    const controller=new AbortController();
    req.on('aborted',()=>controller.abort()); res.on('close',()=>{if(!res.writableEnded) controller.abort();});
    const send=(status,data,type='application/json; charset=utf-8')=>{
      if(res.destroyed) return;
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      res.end(type.startsWith('application/json')?JSON.stringify(data):data);
    };
    try {
      const port=req.socket.localPort;
      const allowedHosts=[`127.0.0.1:${port}`,`localhost:${port}`];
      if(!allowedHosts.includes(req.headers.host)) throw new ApiError(403,'Hostが許可されていません');
      const origin=req.headers.origin;
      if(origin && ![`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(origin)) throw new ApiError(403,'Originが許可されていません');
      const site=req.headers['sec-fetch-site'];
      if(site && !['same-origin','none'].includes(site)) throw new ApiError(403,'外部サイトからのアクセスを拒否しました');
      if(req.method!=='GET') throw new ApiError(405,'GETのみ対応しています');
      const url=new URL(req.url,`http://${req.headers.host}`);
      if(url.pathname.startsWith('/api/')) {
        if(req.headers['x-kube-local']!=='1') throw new ApiError(403,'専用ヘッダーが必要です');
        if(url.pathname==='/api/info') return send(200,{mode:demo?'demo':'live'});
        const method={'/api/contexts':'contexts','/api/namespaces':'namespaces','/api/resources':'resources','/api/logs':'logs','/api/config':'config'}[url.pathname];
        if(!method) throw new ApiError(404,'Not found');
        const params=Object.fromEntries(url.searchParams);
        return send(200,await backend[method](params,{signal:controller.signal}));
      }
      const file=files[url.pathname];
      if(!file) throw new ApiError(404,'Not found');
      send(200,await readFile(new URL(`./public/${file[0]}`,import.meta.url)),file[1]);
    } catch(e) {send(e instanceof ApiError?e.status:500,{error:e instanceof ApiError?e.message:'処理に失敗しました'});}
  });
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  const demo=process.argv.includes('--demo'), port=Number(process.env.PORT || 3009);
  const server=createServer({backend:demo?new Demo():new Kubernetes(),demo});
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'指定ポートは使用中です。PORTを変更してください':'サーバーを起動できません');process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`k9s-web (${demo?'demo':'live'}) http://127.0.0.1:${server.address().port}`));
}
