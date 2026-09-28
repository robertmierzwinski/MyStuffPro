const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base=path.resolve(__dirname,'../custom_components/mystuffpro/frontend');
 await page.route('http://mystuffpro.test/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.endsWith('.css'))return route.fulfill({contentType:'text/css',body:fs.readFileSync(path.join(base,'style.css'))});
   if(url.pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(base,'panel.js'))});
   return route.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><script type="module" src="/panel.js"></script></body></html>'});
 });
 await page.goto('http://mystuffpro.test/');
 await page.evaluate(async()=>{
  await customElements.whenDefined('mystuffpro-panel');
  let data={items:[],revision:0};
  window.panel=document.createElement('mystuffpro-panel');
  panel.hass={themes:{darkMode:false},user:{is_admin:true},callWS:async msg=>{
   if(msg.action==='list')return structuredClone(data);
   if(msg.revision!==data.revision)throw new Error('Dane zmieniły się na innym urządzeniu. Odśwież listę przed zapisem.');
   if(msg.action==='save'){
    const item={...msg.item,id:msg.item_id||String(Date.now()),date_added:'2026-09-28'};
    if(msg.item_id)data.items=data.items.map(i=>i.id===msg.item_id?item:i);else data.items.push(item);
   }
   if(msg.action==='delete')data.items=data.items.filter(i=>i.id!==msg.item_id);
   if(msg.action==='import'){const items=(Array.isArray(msg.data)?msg.data:msg.data.items).map((i,n)=>({...i,id:String(n)}));data.items=msg.replace?items:[...data.items,...items];}
   data.revision++;return structuredClone(data);
  }};
  document.body.append(panel);
 });
 await page.getByRole('button',{name:'+ Dodaj',exact:true}).click();
 await page.getByLabel('Nazwa przedmiotu',{exact:true}).fill('Wiertarka <img src=x onerror=alert(1)>');
 await page.getByLabel('Kategoria',{exact:true}).fill('Narzędzia');
 await page.getByLabel('Lokalizacja',{exact:true}).fill('Garaż');
 await page.getByLabel('Podlokalizacja',{exact:true}).fill('Szafka A');
 await page.getByLabel('Ilość',{exact:true}).fill('2');
 await page.getByRole('button',{name:'Zapisz przedmiot'}).click();
 await page.getByText('Narzędzia',{exact:true}).waitFor();
 assert.equal(await page.locator('mystuffpro-panel img').count(),0);
 await page.getByLabel('Szukaj przedmiotów').fill('szafka');
 assert.equal(await page.locator('.item-row').count(),1);
 await page.getByLabel('Szukaj przedmiotów').fill('nieistniejący');
 await page.getByText('Brak wyników',{exact:true}).waitFor();
 await page.getByLabel('Szukaj przedmiotów').fill('');
 await page.locator('[data-edit]').first().click();
 await page.getByLabel('Nazwa przedmiotu',{exact:true}).fill('Wiertarka akumulatorowa');
 await page.getByRole('button',{name:'Zapisz przedmiot'}).click();
 await page.getByText('Wiertarka akumulatorowa',{exact:true}).waitFor();
 await page.screenshot({path:path.resolve(__dirname,'../preview-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.resolve(__dirname,'../preview-mobile.png'),fullPage:true});
 assert(await page.evaluate(()=>{const r=panel.shadowRoot.querySelector('.main').getBoundingClientRect();return r.right<=innerWidth;}));
 await page.getByRole('button',{name:'Ustawienia',exact:true}).click();
 await page.getByLabel('Motyw',{exact:true}).selectOption('dark');
 assert.equal(await page.locator('mystuffpro-panel').getAttribute('data-theme'),'dark');
 await page.getByRole('button',{name:'Przedmioty',exact:true}).click();
 page.on('dialog',d=>d.accept());
 await page.locator('[data-delete]').click();
 await page.getByText('Tutaj znajdziesz swoje rzeczy').waitFor();
 assert.deepEqual(errors,[]);
 console.log('Frontend: create, edit, search, delete, XSS escaping, mobile layout and theme passed.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
