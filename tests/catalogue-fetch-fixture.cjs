// Used only with node -r from automated tests. Never loaded by the production start script.
const original=global.fetch;
global.fetch=async function(input,init){
 const url=String(input);
 if(url.startsWith('https://flexicowatches.com/products.json')){
  const products=new URL(url).searchParams.get('page')==='1'?[
   {id:77,title:'Flexico Zenior Date Just',handle:'zenior',vendor:'Flexico',product_type:'Quartz',tags:'Zenior',body_html:'<p>40mm watch</p>',
    image:{src:'https://cdn.shopify.com/s/files/1/watch.jpg'},options:[{name:'Dial'}],variants:[
     {id:781,title:'Blue',option1:'Blue',sku:'FCZ-BLU',price:'8999.00',compare_at_price:'20000.00',barcode:'FC781'},
     {id:782,title:'Black',option1:'Black',sku:'FCZ-BLK',price:'9999.00',compare_at_price:null,barcode:'FC782'}]}]:[];
  return new Response(JSON.stringify({products}),{status:200,headers:{'content-type':'application/json'}});
 }
 return original(input,init);
};
