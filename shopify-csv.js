'use strict';
// Shopify Admin Products CSV reader. No external services or packages required.
// Never treats exported inventory quantities as the store's physical stock.
const crypto = require('node:crypto');
const { URL } = require('node:url');
function decode(s){return String(s??'').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();}
function parseCsv(csv){
 if(typeof csv!=='string'||!csv.trim())throw Error('Upload a non-empty Shopify Products CSV file.');
 if(Buffer.byteLength(csv,'utf8')>15_000_000)throw Error('CSV is too large (15 MB limit).');
 const records=[];let row=[],value='',inside=false;const text=csv.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(inside){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else inside=false;}else value+=c;}
  else if(c==='"'){if(value)throw Error('Invalid CSV quoting near row '+(records.length+1));inside=true;}
  else if(c===','){row.push(value);value='';}
  else if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value);value='';if(row.some(v=>v!=='')){records.push(row);if(records.length>50000)throw Error('CSV contains too many rows.');}row=[];}
  else value+=c;
 }
 if(inside)throw Error('Unclosed quotation in Shopify CSV.');
 row.push(value);if(row.some(v=>v!==''))records.push(row);
 if(records.length<2)throw Error('The CSV has no product data.');
 const header=records.shift().map(v=>v.trim().toLowerCase().replace(/\s+/g,' '));
 if(new Set(header).size!==header.length)throw Error('CSV contains duplicate column headings.');
 const map=new Map(header.map((name,i)=>[name,i]));
 function has(...labels){return labels.some(n=>map.has(n.toLowerCase()));}
 function val(row,...labels){for(const n of labels){const i=map.get(n.toLowerCase());if(i!==undefined&&row[i]!==undefined)return String(row[i]).trim();}return '';}
 if(!has('handle','url handle'))throw Error('This is not a Shopify Products CSV: missing Handle column.');
 if(!has('variant price','price'))throw Error('This is not a Shopify Products CSV: missing Variant Price column.');
 return {records,map,val};
}
function minorMoney(v){const s=String(v??'').trim().replace(/(?<=\d),(?=\d{3}(?:\D|$))/g,'');if(!/^\d+(?:\.\d{1,2})?$/.test(s))return null;const [w,f='']=s.split('.');const n=Number(w)*100+Number(f.padEnd(2,'0'));return Number.isSafeInteger(n)?n:null;}
function imageUrl(v){if(!v)return '';try{const u=new URL(v);if(u.protocol!=='https:'||!(/(^|\.)cdn\.shopify\.com$|(^|\.)shopifycdn\.net$|^flexicowatches\.com$/i).test(u.hostname))return '';return u.href.slice(0,1600);}catch{return '';}}
function parseShopifyProductsCsv(csv){
 const {records,val}=parseCsv(csv),products=new Map();let imageRows=0;
 for(const line of records){
  const handle=val(line,'Handle','URL handle').slice(0,180);if(!handle)continue;
  let entry=products.get(handle);
  if(!entry){entry={handle,rows:[],title:'',description:'',vendor:'',type:'',tags:'',published:null,status:'',images:[],optionNames:{}};products.set(handle,entry);}
  const r={line,price:val(line,'Variant Price','Price')};entry.rows.push(r);
  for(let i=1;i<=3;i++){const name=val(line,`Option${i} Name`);if(name&&!entry.optionNames[i])entry.optionNames[i]=decode(name);}
  const title=val(line,'Title');if(title&&!entry.title)entry.title=decode(title);
  const html=val(line,'Body (HTML)','Description');if(html&&!entry.description)entry.description=decode(html);
  const vendor=val(line,'Vendor');if(vendor&&!entry.vendor)entry.vendor=decode(vendor);
  const type=val(line,'Type','Product Type','Product Category');if(type&&!entry.type)entry.type=decode(type);
  const tags=val(line,'Tags');if(tags&&!entry.tags)entry.tags=decode(tags);
  const published=val(line,'Published','Published on online store');if(published)entry.published=/^(true|yes|1)$/i.test(published);
  const status=val(line,'Status');if(status)entry.status=status.toLowerCase();
  const image=imageUrl(val(line,'Image Src','Product Image URL'));
  if(image){entry.images.push(image);if(!r.price)imageRows++;}
 }
 const rows=[];let unpublished=0,skippedImageRows=0,skippedNoPrice=0;
 for(const p of products.values()){
  if(p.status&&p.status!=='active'||p.published===false){unpublished++;continue;}
  if(!p.title){skippedNoPrice++;continue;}
  for(const row of p.rows){
   const line=row.line;
   if(!row.price){skippedImageRows++;continue;}
   const price=minorMoney(row.price);if(price===null)throw Error(`Invalid price for ${p.handle}: ${row.price}`);
   const comp=val(line,'Variant Compare At Price','Compare At Price'),compare=comp?minorMoney(comp):null;
   if(comp&&compare===null)throw Error(`Invalid compare-at price for ${p.handle}`);
   const options=[];
   for(let i=1;i<=3;i++){
    const name=val(line,`Option${i} Name`,`Option${i} name`)||p.optionNames[i],value=val(line,`Option${i} Value`,`Option${i} value`);
    if(name&&value)options.push({name:decode(name).slice(0,80),value:decode(value).slice(0,160)});
   }
   const display=options.map(o=>o.value).filter(v=>v.toLowerCase()!=='default title').join(' / ').slice(0,160);
   const identity=p.handle+'\u0000'+JSON.stringify(options.map(o=>[o.name.toLowerCase(),o.value.toLowerCase()]));
   const externalId=val(line,'Variant ID','Variant Id')||'CSV-'+crypto.createHash('sha256').update(identity).digest('hex').slice(0,24);
   const image=imageUrl(val(line,'Variant Image','Variant Image URL','Variant Image Src'))||p.images[0]||'';
   rows.push({external_id:externalId,shopify_product_id:val(line,'Product ID')||'',sku:decode(val(line,'Variant SKU','SKU')).slice(0,45),barcode:decode(val(line,'Variant Barcode','Barcode')).slice(0,80),
    name:p.title.slice(0,180),brand:(p.vendor||'FLEXICO').slice(0,80),category:(p.type||'Uncategorized').slice(0,80),variant:display,
    price_paisa:price,compare_paisa:compare,description:p.description.slice(0,5000),tags:p.tags.slice(0,400),handle:p.handle,
    image_url:image,available:true,options:JSON.stringify(options).slice(0,1600)});
  }
 }
 if(!rows.length)throw Error('No published/active products with valid variant prices found in the CSV.');
 const warnings=`${unpublished} unpublished/draft products excluded. ${skippedImageRows} image-only CSV lines skipped. Exported stock quantities were not imported. CSV-generated variant IDs can later be linked to Shopify API IDs.`;
 return {rows,productsFound:products.size,variantsFound:rows.length,unpublished,skippedImageRows,skippedNoPrice,warnings};
}
module.exports={parseCsv,parseShopifyProductsCsv,minorMoney};
