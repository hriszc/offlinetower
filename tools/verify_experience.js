'use strict';
// One Chrome session; fresh contexts, fixed combat time, all API traffic mocked.
const assert=require('assert'),fs=require('fs'),path=require('path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/Users/zhaochen/.codex/skills/develop-web-game/scripts/node_modules/playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(ROOT,'output/playwright/experience-fixes');
const coopOnly=process.argv.includes('--coop-only');
const result=coopOnly ? JSON.parse(fs.readFileSync(path.join(OUT,'partial.json'),'utf8')) : {checks:[],layouts:[],errors:[]};
function check(ok,label){assert(ok,label);result.checks.push(label);}
async function advance(p,n=2){await p.evaluate(n=>{for(let i=0;i<n;i++)__advance(1/60);UI.syncAll();},n);}
async function fresh(browser,locale='zh-CN'){
 const ctx=await browser.newContext({locale,hasTouch:true,viewport:{width:1280,height:720}});
 await ctx.addInitScript(()=>{let now=0,q=[],seed=20261002;requestAnimationFrame=cb=>{q.push(cb);return q.length;};performance.now=()=>now;
  Math.random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  window.__advance=dt=>{now+=dt*1000;const a=q;q=[];a.forEach(cb=>cb(now));};});
 const p=await ctx.newPage();p.on('pageerror',e=>result.errors.push(e.message));
 await p.goto('file://'+path.join(ROOT,'index.html'));await p.waitForFunction(()=>Game.state==='menu'&&Render.battleScene&&Render.animalAtlas&&Render.animalAtlasReadable===true);
 return {ctx,p};
}
async function click(p,selector){await p.locator(selector).first().click({force:true});await advance(p);}
async function cellPoint(p,col,lane){return p.evaluate(({col,lane})=>{
 const cols=Game.coopMode&&Game.coopSide==='g'?CONFIG.G_COLS:CONFIG.P_COLS;
 const r=UI.el.stage.getBoundingClientRect(),point=UI.fieldPoint(cols[col],CONFIG.LANES[lane]),x=point.x,y=point.y;
 return UI.portrait?{x:r.right-y,y:r.top+x}:{x:r.x+x,y:r.y+y};},{col,lane});}
async function cell(p,col,lane){const c=await cellPoint(p,col,lane);await p.mouse.click(c.x,c.y);await advance(p);}
async function drag(p,type,col,lane){const card=await p.locator('.card[data-type="'+type+'"]').boundingBox(),target=await cellPoint(p,col,lane);
 await p.mouse.move(card.x+card.width/2,card.y+card.height/2);await p.mouse.down();await p.mouse.move(target.x,target.y,{steps:8});await p.mouse.up();await advance(p);}
async function shot(p,name){await p.screenshot({path:path.join(OUT,name+'.png')});}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  if(!coopOnly){
  // Check every card, including locked statuses, both languages and rotated stage.
  const {ctx,p}=await fresh(browser);
  await p.evaluate(()=>{Game.save.rank=3500;Game.save.tutorialDone=true;Game.save.muted=true;Game.startRun();});
  for(const lang of ['zh','en'])for(const [width,height]of[[1280,720],[844,390],[667,375],[568,320],[480,216],[390,844],[360,640]]){
   await p.setViewportSize({width,height});
   await p.evaluate(lang=>{I18N.lang=lang;document.documentElement.lang=lang==='zh'?'zh-Hans':'en';
    UNIT_ORDER.forEach(id=>{UNITS[id].name=L('unit.'+id+'.name');UNITS[id].desc=L('unit.'+id+'.desc');});
    UI.fit();UI.showLoadout();},lang);
   const measurement=await p.evaluate(()=>{
    const inBox=(a,b)=>a.x>=b.x-1&&a.y>=b.y-1&&a.right<=b.right+1&&a.bottom<=b.bottom+1;
    const v={x:0,y:0,right:innerWidth,bottom:innerHeight};const box=document.querySelector('.loadout'),body=box.querySelector('.overlayBody'),btn=document.getElementById('loadoutConfirm');
    const cards=[...box.querySelectorAll('.loadoutCard')];
    return {width:innerWidth,height:innerHeight,lang:I18N.lang,boxInside:inBox(box.getBoundingClientRect(),v),buttonInside:inBox(btn.getBoundingClientRect(),v),
     noHorizontalOverflow:body.scrollWidth<=body.clientWidth+1,
     cards:cards.length,contentFits:cards.every(c=>['.loArt','.loName','.loCost','.loRole'].every(sel=>inBox(c.querySelector(sel).getBoundingClientRect(),c.getBoundingClientRect()))),
     detailRows:box.querySelectorAll('.unitDetail').length,
     slots:box.querySelectorAll('.loadoutSlot').length,
     slotsMatchDraft:[...box.querySelectorAll('.loadoutSlot')].every((slot,i)=>slot.textContent===UNITS[UI._loadoutDraft[i]].name&&!!slot.querySelector('img')),
     selectedMatchDraft:cards.every(c=>c.classList.contains('selected')===UI._loadoutDraft.includes(c.dataset.id)),
     selected:cards.filter(c=>c.classList.contains('selected')).length,checks:cards.filter(c=>getComputedStyle(c.querySelector('.loCheck')).visibility==='visible').length};});
   check(measurement.boxInside&&measurement.buttonInside&&measurement.noHorizontalOverflow&&measurement.contentFits,
    `${lang} ${width}x${height}: cards/content/confirmation fit rotated stage`);
   check(measurement.selected===6&&measurement.checks===6,`${lang} ${width}x${height}: only selected animals have checkmarks`);
   check(measurement.cards===22&&measurement.detailRows===22,`${lang} ${width}x${height}: all animals retain detailed stats`);
   check(measurement.slots===6&&measurement.slotsMatchDraft&&measurement.selectedMatchDraft,`${lang} ${width}x${height}: six team slots match selected animals`);
   result.layouts.push(measurement);
   await click(p,'.loadoutDetails summary');
   check(await p.evaluate(()=>{
    const details=document.querySelector('.loadoutDetails');
    return details.open&&[...details.querySelectorAll('.unitDetail')].every(row=>row.querySelector('small').textContent.trim().length>0&&row.querySelector('span').textContent.trim().length>0);
   }),`${lang} ${width}x${height}: detailed stats can be opened without changing selection`);
   check(await p.evaluate(()=>UI._loadoutDraft.length===6),'viewing details keeps all six selected animals');
   await click(p,'.loadoutDetails summary');
   await p.locator('.loadoutCard').last().scrollIntoViewIfNeeded();
   await click(p,'.loadoutCard:last-child');
   check(await p.evaluate(()=>UI._loadoutDraft.length===6),'full loadout prevents seventh selection');
   if(lang==='zh'&&[1280,844,390].includes(width)) {await p.evaluate(()=>{document.querySelector('.overlayBody').scrollTop=0;UI.hideToast();});await shot(p,`loadout-${width}x${height}`);}
  }
  await p.setViewportSize({width:844,height:390});await p.evaluate(()=>{I18N.lang='zh';UI.fit();UI.showLoadout();});
  await click(p,'.loadoutCard.selected');
  check(await p.evaluate(()=>UI._loadoutDraft.length===5&&document.getElementById('loadoutConfirm').disabled),'deselect updates count and disables confirmation');
  check(await p.evaluate(()=>{
   const slots=[...document.querySelectorAll('.loadoutSlot')];
   return slots.length===6&&slots.filter(slot=>slot.classList.contains('empty')).length===1&&
    slots.slice(0,5).every((slot,i)=>slot.textContent===UNITS[UI._loadoutDraft[i]].name);
  }),'deselect replaces sixth team slot with an empty placeholder');
  await click(p,'.loadoutCard:not(.selected)');
  check(await p.evaluate(()=>UI._loadoutDraft.length===6&&!document.getElementById('loadoutConfirm').disabled),'replacement restores valid six-animal loadout');
  check(await p.evaluate(()=>[...document.querySelectorAll('.loadoutSlot')].every((slot,i)=>!slot.classList.contains('empty')&&slot.textContent===UNITS[UI._loadoutDraft[i]].name)),
   'replacement restores all team slot portraits and names');
  // A real touch swipe must scroll the list instead of being blocked by stage touch-action:none.
  const scroller=await p.evaluate(()=>{const e=document.querySelector('.overlayBody');e.scrollTop=0;const r=e.getBoundingClientRect();return {x:UI.portrait?r.x+r.width*.3:r.x+r.width/2,y:UI.portrait?r.y+r.height/2:r.y+r.height*.7,portrait:UI.portrait};});
  const cdp=await ctx.newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:scroller.x,y:scroller.y,radiusX:2,radiusY:2}]});
  for(let i=1;i<=6;i++) {
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:scroller.x+(scroller.portrait?i*20:0),y:scroller.y-(scroller.portrait?0:i*20),radiusX:2,radiusY:2}]});
   await p.waitForTimeout(20);
   await advance(p,1);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.waitForTimeout(100);
  await advance(p);
  check(await p.evaluate(()=>document.querySelector('.overlayBody').scrollTop>0),'touch swipe reaches animals beyond first rows');
  await click(p,'#loadoutConfirm');
  const upgradeBefore=await p.evaluate(()=>{
   Game.coins=999;Game.place('barricade',8,0);Game.beginFormChoice(8,0);
   return {coins:Game.coins,cost:upgradeCost('barricade',1)};
  });
  check(await p.evaluate(()=>document.querySelectorAll('.formCard[data-form]').length===3&&!document.querySelector('.formCard details')),
   'three upgrade choices keep details outside selection buttons');
  await click(p,'.formDetails summary');
  check(await p.evaluate(coins=>document.querySelector('.formDetails').open&&Game.formChoice!==null&&Game.unitAt(8,0).lv===1&&Game.coins===coins,upgradeBefore.coins),
   'opening upgrade details does not choose a form or spend coins');
  await click(p,'.formCard');
  check(await p.evaluate(before=>Game.formChoice===null&&Game.unitAt(8,0).lv===2&&Game.unitAt(8,0).form===FORMS.barricade[0].id&&Game.coins===before.coins-before.cost,upgradeBefore),
   'upgrade choice applies the selected form and charges once');
  await p.evaluate(()=>{Game.roundIndex=2;Game.grid={};Game.coins=999;Game.tutorialActive=false;Game.armedType=null;Game.refreshBuild();UI.syncAll();});
  await drag(p,'turret',8,8);
  check(await p.evaluate(()=>Game.unitAt(8,8)&&Game.unitAt(8,8).type==='turret'&&Game.coins===999-UNITS.turret.cost),
   'dragging from horizontal tray places at mapped final lane and charges once');
  for(const [side,seat]of[['p',0],['g',3]]){
   await p.evaluate(({side,seat})=>{Game.grid={};Game.coopMode=true;Game.coopSide=side;Game.coopSeat=seat;Game.coopLocked=false;
    Game.coins=999;Game.armedType=null;Game.pendingPlacement=null;Game.selectedCell=null;Game.refreshBuild();UI.syncAll();},{side,seat});
   await click(p,'.card[data-type="turret"]');await cell(p,7,1);
   check(await p.evaluate(side=>Game.pendingPlacement&&Game.pendingPlacement.side===side&&Game.pendingPlacement.col===7&&Game.pendingPlacement.lane===1&&Game.coins===999,side),
    `co-op ${side}: mapped field click opens confirmation without spending`);
   await click(p,'#placementConfirm [data-action="confirm"]');
   check(await p.evaluate(()=>Game.unitAt(7,1)&&Game.unitAt(7,1).type==='turret'&&Game.coins===999-UNITS.turret.cost),
    `co-op ${side}: mapped confirmation places and charges once`);
   await drag(p,'turret',8,2);
   check(await p.evaluate(()=>Game.pendingPlacement&&Game.pendingPlacement.fromDrag&&Game.pendingPlacement.col===8&&Game.pendingPlacement.lane===2),
    `co-op ${side}: mapped drag preserves the target cell`);
   await click(p,'#placementConfirm [data-action="confirm"]');
   check(await p.evaluate(()=>Game.unitAt(8,2)&&Game.unitAt(8,2).type==='turret'&&Game.armedType===null),
    `co-op ${side}: dragged placement confirms and releases selection`);
  }
  await ctx.close();console.log('loadout checks complete');

  const {ctx:ctx2,p:p2}=await fresh(browser);
  await click(p2,'#playBtn');await click(p2,'#loadoutConfirm');
  await click(p2,'.card[data-type="barricade"]');await cell(p2,6,1);
  check(await p2.evaluate(()=>Game.coins===95&&Game.playerBuild().length===0&&Game.tutorialStep===2),'wrong tutorial cell costs nothing');
  await cell(p2,7,1);await click(p2,'.card[data-type="spike"]');await cell(p2,8,1);
  await click(p2,'.card[data-type="turret"]');await cell(p2,6,1);
  check(await p2.evaluate(()=>Game.coins===0&&Game.playerBuild().length===3&&Game.tutorialStep===7),'tutorial creates full 95-coin defense');
  await shot(p2,'tutorial-defense');
  await click(p2,'#pauseBtn');check(await p2.evaluate(()=>Game.paused),'pause opens');
  await p2.keyboard.press('Shift+Tab');check(await p2.evaluate(()=>document.activeElement.id==='saveMenuBtn'),'pause traps backward keyboard focus');
  await p2.keyboard.press('Tab');check(await p2.evaluate(()=>document.activeElement.id==='resumeBtn'),'pause traps forward keyboard focus');
  check(await p2.evaluate(()=>{
   Game.undoSale={unit:{type:'turret',col:8,lane:0,lv:1,form:null},back:0,roundIndex:0,expires:Date.now()+5000};
   const before=JSON.stringify({grid:Game.grid,coins:Game.coins});
   Game.startBattle();Game.place('turret',8,0);Game.upgradeAt(7,1);Game.beginFormChoice(7,1);Game.confirmForm('tank');Game.sellAt(7,1);
   const undo=Game.undoSell();Game.undoSale=null;
   return !undo&&!Game.matchmaking&&!Game.formChoice&&before===JSON.stringify({grid:Game.grid,coins:Game.coins});
  }),'paused build rejects all underlying economy and start actions');
  await click(p2,'#saveMenuBtn');check(await p2.locator('#continueRunBtn').isVisible(),'saved run offered in menu');
  await p2.reload();await p2.waitForSelector('#continueRunBtn');await click(p2,'#continueRunBtn');
  check(await p2.evaluate(()=>Game.playerBuild().length===3&&Game.coins===0&&Game.roundIndex===0),'reload preserves defense and economy');
  await click(p2,'#startBtn');await advance(p2,120);
  check(await p2.evaluate(()=>Game.state==='battle'),'tutorial proceeds to combat');
  const abilities=await p2.evaluate(()=>{const n=Game.repair,f=Game.flare;return {repair:Game.useRepair(),flare:Game.useFlare(10,10),same:Game.repair===n&&Game.flare===f};});
  check(!abilities.repair&&!abilities.flare&&abilities.same,'full-health repair and empty flare preserve charges');
  await click(p2,'#pauseBtn');const t=await p2.evaluate(()=>Game.battle.t);await advance(p2,120);
  check(await p2.evaluate(t=>Game.battle.t===t,t),'paused combat does not advance');await shot(p2,'pause');
  await click(p2,'#resumeBtn');await advance(p2,2);check(await p2.evaluate(t=>Game.battle.t>t,t),'resume advances combat');
  await p2.evaluate(()=>{Game.battle.hp.p=75;UI.syncAll();});await click(p2,'#repairBtn');
  check(await p2.evaluate(()=>Game.battle.hp.p===91&&Game.repair===1),'damaged home repair works once');
  const round=await p2.evaluate(()=>{let frames=0;while(Game.state==='battle'&&frames<36000){Game.update(1/60);frames++;}return {state:Game.state,result:Game.result,kills:Game.battle.killedAtEnd,time:Game.battle.timeAtEnd};});
  check(round.state==='result'&&round.result.playerKills===round.kills.p&&round.result.playerTime<=round.time,'result uses visible combat snapshot');
  check(await p2.evaluate(()=>document.querySelector('.tlRow b').textContent===Math.round(Game.result.playerHpFrac*100)+'%'&&
   UI.el.overlay.textContent.includes(L('experience.roundDuration',{time:Math.max(Game.result.playerTime,Game.result.ghostTime).toFixed(1)}))),
   'result compares actual home health and labels battle duration');
  result.tutorialResult=round.result;await shot(p2,'result');
  await p2.reload();await p2.waitForSelector('#continueRunBtn');await click(p2,'#continueRunBtn');
  check(await p2.evaluate(()=>Game.state==='result'&&Game.coins===104),'result checkpoint resumes without duplicate income');
  await click(p2,'#nextBtn');await p2.reload();await p2.waitForSelector('#continueRunBtn');await click(p2,'#continueRunBtn');
  check(await p2.evaluate(()=>Game.state==='reward'&&UI.overlayMode==='reward'),'reward checkpoint resumes selection');
  await click(p2,'.relic');check(await p2.evaluate(()=>Game.roundIndex===1&&Game.relics.length===1),'reward applied once and advances round');
  await cell(p2,6,1);await click(p2,'#sellBtn');check(await p2.locator('#undoSellBtn').isVisible(),'sale offers undo');
  await click(p2,'#undoSellBtn');check(await p2.evaluate(()=>Game.unitAt(6,1).type==='turret'),'undo restores original animal');
  // Keyboard selection -> focused grid -> arrow -> placement.
  await p2.evaluate(()=>{Game.tutorialActive=false;Game.selectedCell=null;Game.armedType=null;UI.syncAll();});
  const beforeKeyboard=await p2.evaluate(()=>Game.playerBuild().length);
  await p2.locator('.card[data-type="turret"]').focus();await p2.keyboard.press('Enter');
  for(let i=0;i<3;i++)await p2.keyboard.press('ArrowDown');await p2.keyboard.press('Enter');await advance(p2);
  check(await p2.evaluate(n=>Game.unitAt(8,3).type==='turret'&&Game.playerBuild().length===n+1,beforeKeyboard),'keyboard can select and place');
  result.keyboard=await p2.evaluate(()=>JSON.parse(render_game_to_text()));
  await ctx2.close();console.log('single-player checks complete');
  const {ctx:replayCtx,p:rp}=await fresh(browser);
  await rp.evaluate(()=>{Game.save.rank=3500;Game.save.matches=10;Game.save.tutorialDone=false;Game.tutorialRequested=true;
   Game.save.loadout=['wolf','owl','boar','chameleon','elephant','frog'];Game.startRun();});
  check(await rp.evaluate(()=>['barricade','spike','turret'].every(id=>UI._loadoutDraft.includes(id))),'replayed tutorial restores mandatory animals from custom loadout');
  await click(rp,'.loadoutCard[data-id="barricade"]');
  check(await rp.evaluate(()=>UI._loadoutDraft.includes('barricade')),'tutorial-required animal cannot be removed');
  await click(rp,'#loadoutConfirm');await rp.locator('.card[data-type="barricade"]').focus();await rp.keyboard.press('Enter');await rp.keyboard.press('ArrowRight');
  check(await rp.evaluate(()=>Game.tutorialTarget.col===7&&UI.focusCell.col===8),'keyboard navigation does not mutate tutorial target');
  await rp.keyboard.press('ArrowLeft');await rp.keyboard.press('Enter');
  check(await rp.evaluate(()=>Game.unitAt(7,1).type==='barricade'&&Game.tutorialStep===3),'replayed tutorial places required animal with keyboard');
  await replayCtx.close();
  }

  const coopCtx=await browser.newContext({locale:'zh-CN',viewport:{width:960,height:540}});
  await coopCtx.addInitScript(()=>localStorage.setItem('yeshou.coop.session.v1',JSON.stringify({code:'HJKLMPQ6',token:'1'.repeat(64),nicknameIndex:0,seenRound:-1,initialRank:0})));
  const requests=[];let offline=false;
  const payload={room:{code:'HJKLMPQ6',phase:'lobby',ownerSeat:0,maxPlayers:6,players:[{seat:0,nicknameIndex:0},{seat:1,nicknameIndex:1}]},self:{seat:0,rank:0}};
  await coopCtx.route('https://coop.pikafun.com/api/**',async route=>{requests.push(route.request().method()+' '+route.request().url());if(offline)return route.abort('internetdisconnected');await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});});
  const cp=await coopCtx.newPage();cp.on('pageerror',e=>result.errors.push(e.message));
  await cp.goto('file://'+path.join(ROOT,'output/h5/index.html'));await cp.waitForSelector('#coopBtn');
  await cp.waitForFunction(()=>Render.battleScene&&Render.animalAtlas&&Render.animalAtlasReadable===true);
  await cp.locator('#coopBtn').click();await cp.waitForSelector('#leaveCoopViewBtn');await cp.locator('#leaveCoopViewBtn').click();
  check(!requests.some(r=>r.startsWith('POST ')&&r.endsWith('/leave'))&&await cp.evaluate(()=>!!localStorage.getItem('yeshou.coop.session.v1')),'co-op return keeps room credential and sends no leave');
  await cp.locator('#coopBtn').click();await cp.waitForSelector('#deleteCoopRoomBtn');await cp.locator('#deleteCoopRoomBtn').click();
  check(!requests.some(r=>r.startsWith('DELETE '))&&await cp.locator('#confirmDeleteCoopBtn').isVisible(),'disband asks for explicit confirmation');
  await cp.locator('#cancelDeleteCoopBtn').click();await cp.locator('#leaveCoopViewBtn').click();offline=true;await cp.locator('#coopBtn').click();
  await cp.waitForSelector('#retryCoopConnectionBtn');check(await cp.locator('#backCoopConnectionBtn').isVisible(),'offline recovery offers retry and return');
  await shot(cp,'coop-offline');await cp.locator('#backCoopConnectionBtn').click();check(await cp.locator('#coopBtn').isVisible(),'offline connection can return to menu');
  await coopCtx.close();check(result.errors.length===0,'no JavaScript page errors');
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(result,null,2));console.log(`PASS: ${result.checks.length} experience checks, ${result.layouts.length} bilingual layouts`);
 }finally{await browser.close();}
}
main().catch(e=>{fs.writeFileSync(path.join(OUT,'partial.json'),JSON.stringify(result,null,2));console.error(e);process.exitCode=1;});
