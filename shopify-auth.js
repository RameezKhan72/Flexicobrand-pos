'use strict';
// Server-only Shopify Admin API authentication for one merchant-owned store.
// Client-credentials grants require the app and store to be in the same Shopify organization.
function createAuth({shop, clientId, clientSecret, legacyToken, request, clock}={}) {
  shop=String(shop||'').trim().toLowerCase();
  clientId=String(clientId||'').trim();clientSecret=String(clientSecret||'').trim();legacyToken=String(legacyToken||'').trim();
  const getFetch=request||((...args)=>globalThis.fetch(...args));
  const now=clock||(()=>Date.now());
  const validShop=/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
  const ready=validShop && (Boolean(legacyToken)||Boolean(clientId && clientSecret));
  let current='',expires=0,pending=null;
  async function accessToken(){
    if(!validShop)throw Error('Set SHOPIFY_STORE_DOMAIN to the official shop.myshopify.com domain.');
    if(clientId||clientSecret){
      if(!clientId||!clientSecret)throw Error('Both SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET are required.');
      if(current&&expires>now())return current;
      if(pending)return pending;
      pending=(async()=>{
        const body=new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret});
        let r;
        try{r=await getFetch(`https://${shop}/admin/oauth/access_token`,{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
          body:body.toString(),redirect:'error',signal:AbortSignal.timeout(20000)
        });}catch{throw Error('Shopify token endpoint unavailable. Check Internet and your Shopify store domain.');}
        if(!r.ok)throw Error(`Shopify authentication failed (HTTP ${r.status}). Confirm app installation and same Shopify organization.`);
        let data;try{data=await r.json();}catch{throw Error('Shopify returned an invalid token response.');}
        if(!data||typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)
          throw Error('Shopify did not issue a valid access token.');
        const scopes=String(data.scope||'').split(',').map(x=>x.trim());
        if(!scopes.includes('read_products'))throw Error('The installed Shopify app lacks read_products access.');
        current=data.access_token;
        const seconds=Number(data.expires_in);
        expires=now()+Math.max(1,seconds-Math.min(300,Math.floor(seconds/10)))*1000;
        return current;
      })();
      try{return await pending;}finally{pending=null;}
    }
    if(legacyToken)return legacyToken;
    throw Error('Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (new app), or SHOPIFY_ADMIN_TOKEN (existing legacy app).');
  }
  function invalidate(){current='';expires=0;}
  return {ready,accessToken,invalidate,isAutomatic:Boolean(clientId||clientSecret)};
}
module.exports={createAuth};
