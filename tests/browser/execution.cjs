const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox'] });
 const page = await browser.newPage();
 page.setDefaultTimeout(15000);
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let failed = false;
 await page.addInitScript(() => localStorage.setItem('sb-bydbweyercozwdxcbase-auth-token', JSON.stringify({ access_token:'test-token',refresh_token:'test-refresh',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'00000000-0000-0000-0000-000000000001',email:'operator@example.invalid'} })));
 await page.route('**/*', async route => {
  const u=new URL(route.request().url());
  if(u.hostname==='127.0.0.1') return route.continue();
  let body={}; let status=200;
  if(u.pathname.endsWith('/rpc/is_app_operator')) body=true;
  else if(u.pathname.endsWith('/overview')) {
   if(failed) { status=502; body={error:'Exchange timed out'}; }
   else body={ok:true,balances:[{asset:'USDT',free:5,locked:0},{asset:'AXS',free:6.82,locked:0}],canTrade:true,symbols:['AXSUSDT'],omittedSymbols:[],openOrders:[],reconciliationCandidates:[{id:'candidate',symbol:'AXSUSDT',quantity:6.82,closedAt:new Date().toISOString(),buyOrderId:'65846776',exchangeBalance:6.82}],reconciliationChecked:true,warnings:[],fetchedAt:new Date().toISOString()};
  } else if(u.pathname.endsWith('/orders')) body={ok:true,symbols:[{symbol:'AXSUSDT',orders:[{orderId:9,side:'SELL',status:'FILLED',time:Date.now(),executedQty:'2',cummulativeQuoteQty:'20'}],trades:[{id:9,orderId:9,isBuyer:false,qty:'2',quoteQty:'20',price:'10',commission:'0',commissionAsset:'USDT',time:Date.now()}]}],errors:[],fetchedAt:new Date().toISOString()};
  else if(u.pathname.endsWith('/account')) body={ok:true,balances:[{asset:'USDT',free:5,locked:0}],canTrade:true,fetchedAt:new Date().toISOString()};
  else if(u.pathname.endsWith('/config')) body={paperMode:false,killSwitch:false,liveCapital:5};
  else if(u.pathname.includes('/rest/v1/')) body=[];
  return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body),headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
 });
 await page.goto(`${process.env.APP_URL || 'http://127.0.0.1:5174'}/#execution`);
 await page.getByText('Holdings need reconciliation').waitFor({timeout:15000});
 assert.equal(await page.getByText('Unverified',{exact:true}).count(),1);
 assert.ok((await page.locator('body').innerText()).includes('1 sell orders lack complete cost or fee data'));
 failed=true;
 await page.getByRole('button',{name:'Refresh',exact:true}).click();
 await page.getByText('Values below are from the last successful refresh.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Export CSV'}).isDisabled(),true);
 await page.reload();
 await page.getByText('Balances and positions have not been verified.',{exact:false}).waitFor();
 assert.equal(await page.getByText('Order history is unavailable.',{exact:true}).count(),1);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('PASS: authenticated mocked execution flow, holdings reconciliation, incomplete P&L hidden, failed refresh marks stale, initial failure stays unavailable; no page errors.');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
