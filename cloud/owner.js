'use strict';
// Separate read-only cloud owner portal. No bearer sync token in the browser.
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
function install({pool,storeId}){
  const user=process.env.CLOUD_OWNER_USERNAME||'';
  const secret=process.env.CLOUD_OWNER_PASSWORD||'';
  const configured=user.length>=3 && secret.length>=12;
  const digest=crypto.scryptSync(secret||'disabled-login', 'flexico-owner-v1-login', 64);
  const attempts=new Map();
  function send(res,code,obj){res.writeHead(code,{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-frame-options':'DENY',
    'referrer-policy':'no-referrer','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  });res.end(JSON.stringify(obj));}
  function limit(req){
    const ip=req.socket.remoteAddress||'unknown',now=Date.now();
    const record=attempts.get(ip)||{count:0,until:now+900000};
    if(now>record.until){record.count=0;record.until=now+900000;}
    if(record.count>=8)return false;
    record.count++;attempts.set(ip,record);
    if(attempts.size>1000){for(const [k,v] of attempts)if(now>v.until)attempts.delete(k);}
    return true;
  }
  async function body(req){let s='';for await(const c of req){s+=c;if(s.length>10000)throw Error('Body too large');}return JSON.parse(s||'{}');}
  function token(req){return /(?:^|;\s*)flexico_owner=([0-9a-f]{64})/.exec(req.headers.cookie||'')?.[1]||'';}
  function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
  function setSessionCookie(res,value,clear=false){const secure=process.env.NODE_ENV==='production';
    res.setHeader('Set-Cookie',`flexico_owner=${clear?'':value}; HttpOnly; SameSite=Strict; Path=/owner; Max-Age=${clear?0:28800}${secure?'; Secure':''}`);
  }
  async function authenticated(req){const raw=token(req);if(!raw)return false;
    const result=await pool.query('SELECT 1 FROM owner_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(raw)]);
    return result.rowCount>0;
  }
  async function handle(req,res,route){
    if(!route.startsWith('/owner'))return false;
    if(req.method!=='GET'&&req.method!=='HEAD'&&req.method!=='POST')return send(res,405,{error:'Method not allowed'}),true;
    if(req.method==='POST'&&(req.headers['sec-fetch-site']==='cross-site'||req.headers['sec-fetch-site']==='same-site'))return send(res,403,{error:'Cross-site request blocked'}),true;
    const type=req.headers['content-type']||'';
    if(req.method==='POST'&&!type.startsWith('application/json'))return send(res,415,{error:'JSON required'}),true;
    if(route==='/owner/api/login'&&req.method==='POST'){
      if(!limit(req))return send(res,429,{error:'Too many attempts; try later'}),true;
      let data;try{data=await body(req);}catch{return send(res,400,{error:'Invalid login request'}),true;}
      const candidate=crypto.scryptSync(String(data.password||'').slice(0,256),'flexico-owner-v1-login',64);
      if(!configured||data.username!==user||!crypto.timingSafeEqual(candidate,digest))return send(res,401,{error:'Invalid credentials'}),true;
      const raw=crypto.randomBytes(32).toString('hex');
      await pool.query('INSERT INTO owner_sessions(token_hash,expires_at) VALUES($1,now()+interval \'8 hours\')',[hash(raw)]);
      setSessionCookie(res,raw);return send(res,200,{ok:true,username:user}),true;
    }
    if(route==='/owner' || route==='/owner/' || route==='/owner/index.html'){
      const file=fs.readFileSync(path.join(__dirname,'public','owner.html'));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY',
       'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});
      res.end(req.method==='HEAD'?undefined:file);return true;
    }
    if(route==='/owner/owner.css'||route==='/owner/owner.js'){
      res.writeHead(200,{'content-type':route.endsWith('css')?'text/css':'text/javascript','cache-control':'no-cache','x-content-type-options':'nosniff'});
      res.end(fs.readFileSync(path.join(__dirname,'public',route.split('/').pop())));return true;
    }
    if(!await authenticated(req))return send(res,401,{error:'Owner login required'}),true;
    if(route==='/owner/api/me')return send(res,200,{username:user}),true;
    if(route==='/owner/api/logout'&&req.method==='POST'){
      await pool.query('DELETE FROM owner_sessions WHERE token_hash=$1',[hash(token(req))]);setSessionCookie(res,'',true);return send(res,200,{ok:true}),true;
    }
    if(route==='/owner/api/dashboard'){
      const ops=await pool.query('SELECT payload,version,updated_at FROM mirror_ops WHERE store_id=$1 ORDER BY updated_at DESC LIMIT 1',[storeId]);
      const sales=await pool.query(`SELECT receipt_no,created_at,total_paisa::text,paid_paisa::text,due_paisa::text,
        cashier,customer_name,status FROM mirror_sales WHERE store_id=$1 ORDER BY created_at DESC,event_id DESC LIMIT 30`,[storeId]);
      const mirrored=await pool.query(`SELECT COUNT(*)::int n,MAX(mirrored_at) AS last_uploaded FROM mirror_sales WHERE store_id=$1`,[storeId]);
      return send(res,200,{mode:'read-only-single-store',snapshot:ops.rows[0]?.payload||null,
        last_uploaded_at:ops.rows[0]?.updated_at||null,latest_sales:sales.rows,mirrored_sales:mirrored.rows[0]}),true;
    }
    return send(res,404,{error:'Not found'}),true;
  }
  return {handle};
}
module.exports={install};
