'use strict';
const $=id=>document.getElementById(id);
const text=(v)=>String(v??'');
const esc=(v)=>text(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=p=>'Rs '+(Number(p||0)/100).toLocaleString('en-PK',{minimumFractionDigits:2,maximumFractionDigits:2});
const time=v=>v?new Date(v).toLocaleString('en-PK',{dateStyle:'medium',timeStyle:'short'}):'Never';
async function call(route,options){const response=await fetch('/owner/api/'+route,{...options,credentials:'same-origin',headers:{'content-type':'application/json',...(options?.headers||{})}});
const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data;}
const empty=msg=>`<p class="empty">${esc(msg)}</p>`;
function row(label,desc,value){return `<div class="list-row"><div><b>${esc(label)}</b><small>${esc(desc)}</small></div><strong>${esc(value)}</strong></div>`;}
function show(data){
 const p=data.snapshot,stats=p?.statistics||{};const last=data.last_uploaded_at;
 const age=last?Math.round((Date.now()-new Date(last).getTime())/60000):Infinity;
 $('alert').innerHTML=!p?'<div class="notice error">No operational snapshot has reached cloud. Start and sync the store PC before trusting this dashboard.</div>':
 age>5?`<div class="notice">Offline or delayed sync — data last received ${esc(time(last))} (${age} minutes ago). Billing can continue locally. These figures are not live.</div>`:
 `<div class="notice success">✓ Store snapshot received ${esc(time(last))}. Cloud owner portal is read-only; stock is controlled by the store PC.</div>`;
 const metrics=[['Total sales',money(stats.sales_total_paisa||0),'All recorded receipts'],
 ['Net sales after returns',money((stats.sales_total_paisa||0)-(stats.refunds_paisa||0)),'Gross less recorded refunds'],
 ['Collected to date',money(stats.collected_paisa||0),'Includes recorded COD remittances'],
 ['Outstanding customer balances',money(stats.outstanding_paisa||0),'Uncollected COD / receivables'],
 ['Store + warehouse units',text(stats.stock_units||0),'Total available inventory units'],
 ['Low-stock products',text(stats.low_stock_count||0),'Store quantity at/below threshold'],
 ['Open warranty claims',text(stats.open_claims||0),'Claims needing attention'],
 ['Supplier dues',money(stats.unpaid_suppliers_paisa||0),'Purchase invoices less recorded payments']];
 $('metrics').innerHTML=metrics.map(([label,value,detail],i)=>`<article class="metric ${i===1?'gold':''}"><div class="kicker">${esc(label)}</div><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`).join('');
 const stock=p?.stock||[];$('stock-label').textContent=`${stock.length} products shown`;
 $('stock-table').innerHTML=stock.length?stock.map(x=>`<tr><td><b>${esc(x.name)}</b><small>${esc(x.sku)}</small></td><td>${esc(x.category||x.brand||'—')}</td><td>${esc(x.store_qty)}</td><td>${esc(x.warehouse_qty)}</td><td><span class="status ${x.store_qty<=x.threshold?'warn':''}">${x.store_qty<=x.threshold?'Low stock':'In stock'}</span></td></tr>`).join(''):'<tr><td colspan="5">No synced inventory yet</td></tr>';
 $('cod-list').innerHTML=(p?.recent_cod||[]).length?p.recent_cod.map(x=>row(x.receipt_no,`${x.delivery_status||'NEW'} · ${time(x.created_at)}`,money(x.due_paisa))).join(''):empty('No outstanding COD orders');
 $('returns-list').innerHTML=(p?.recent_returns||[]).length?p.recent_returns.map(x=>row(x.number,`${x.receipt_no} · ${x.refund_method}`,money(x.refund_paisa))).join(''):empty('No recorded returns');
 $('sales-table').innerHTML=(data.latest_sales||[]).length?data.latest_sales.map(s=>`<tr><td><b>${esc(s.receipt_no)}</b></td><td>${esc(s.customer_name||'Walk-in')}</td><td>${esc(time(s.created_at))}</td><td>${money(s.total_paisa)}</td><td>${money(s.paid_paisa)}</td><td><span class="status ${s.status==='PAID'?'':'warn'}">${esc(s.status)}</span></td></tr>`).join(''):'<tr><td colspan="6">No sales uploaded yet</td></tr>';
}
async function refresh(){try{show(await call('dashboard'));$('login-layer').classList.add('hidden');}catch(e){if(/login/i.test(e.message))$('login-layer').classList.remove('hidden');else $('alert').innerHTML=`<div class="notice error">${esc(e.message)}</div>`;}}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget;const username=form.elements.username.value,password=form.elements.password.value;
try{await call('login',{method:'POST',body:JSON.stringify({username,password})});form.elements.password.value='';$('login-error').textContent='';await refresh();}
catch(err){$('login-error').textContent=err.message;}});
$('logout').addEventListener('click',async()=>{try{await call('logout',{method:'POST',body:'{}'});}catch{}$('login-layer').classList.remove('hidden');});
$('refresh').addEventListener('click',refresh);
setInterval(()=>{if($('login-layer').classList.contains('hidden'))refresh();},30000);
refresh();
