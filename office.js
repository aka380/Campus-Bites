const $ = (id) => document.getElementById(id);
const roleInfo = {
  Manager: {name:'Morgan',full:'Morgan · Manager / Orchestrator',model:'Gemini 3.5 Flash-Lite',work:'Reads the evidence after every step, picks the next specialist from the allowed moves, and stops when tests fail twice.',symbol:'♟'},
  Architect: {name:'Alex',full:'Alex · Architect',model:'Gemini 3.5 Flash-Lite',work:'Turns the request into a spec with testable acceptance criteria. Can refuse requests the shop cannot support.',symbol:'◈'},
  Backend: {name:'Sam',full:'Sam · Backend Developer',model:'Groq GPT-OSS 120B',work:'Owns api/feature.mjs. Writes the API, runs the tests, fixes failures.',symbol:'⌘'},
  Frontend: {name:'Riya',full:'Riya · Frontend Developer',model:'Groq GPT-OSS 120B',work:'Owns site/feature.js. Builds the panel in the shop, runs the tests, fixes failures.',symbol:'◫'},
  QA: {name:'Robin',full:'Robin · QA Engineer',model:'Gemini 3.5 Flash-Lite',work:'Writes failing acceptance tests before any code exists, then runs every test at the end.',symbol:'✓'},
};
const PRESETS = [
  ['Student discount','Implement the student discount section in my cart.'],
  ['Veg-only switch','Add a "Veg only" switch above the menu. When it is on, hide every non-veg dish. The API returns the ids of the veg dishes.'],
  ['Rider tip','Let students tip the delivery rider from the bag: buttons for ₹10, ₹20 and ₹30, plus "No tip". The tip appears as a line in the bag total. The API rejects any other amount.'],
  ['Combo deal','Automatic combo: when the bag has at least one burger and one fries, take ₹40 off. If the bag has only one of the two, show a hint saying what to add to unlock the combo.'],
  ['Calorie counter','Show the total calories of the bag. Warn in red when the bag is above 1500 kcal. The API calculates the total from the menu.'],
];
let snapshot = {mode:'idle',events:[],running:false,runId:null,runOutcome:'idle'};
let audit = null;
let selected = 'Manager';
let tab = 'activity';
let previousSignature = '';
let seenEvents = new Set();
let lastActiveRole = null;
let lastOutcome = 'idle';
let toastTimeout, handoffTimeout;

const escapeHTML = (value) => String(value??'').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3500)}
const requestBox=$('feature-request');
function renderPresets(){
  $('presets').innerHTML=PRESETS.map(([label,text],i)=>`<button type="button" data-preset="${i}" aria-pressed="${requestBox.value===text}">${escapeHTML(label)}</button>`).join('');
}
$('presets').addEventListener('click',e=>{const b=e.target.closest('[data-preset]');if(!b||requestBox.disabled)return;requestBox.value=PRESETS[Number(b.dataset.preset)][1];renderPresets()});
requestBox.addEventListener('input',renderPresets);
requestBox.value=PRESETS[0][1];renderPresets();
async function action(name){
  const endpoints={run:'/api/run',preview:'/api/preview',reset:'/api/reset',reference:'/api/apply-reference'};
  try {
    const options={method:'POST'};
    if(name==='run'){options.headers={'Content-Type':'application/json'};options.body=JSON.stringify({request:requestBox.value})}
    const response=await fetch(endpoints[name],options);
    const data=await response.json();
    if(!response.ok || !data.ok && name!=='preview') return toast(data.error||'The action could not be started.');
    if(name==='reset'||name==='preview'||name==='reference'){
      audit=null;seenEvents.clear();lastActiveRole=null;previousSignature='';lastOutcome='idle';
    }
    toast(name==='run'?'Real run started: the team is reading your request':name==='preview'?'SCRIPTED preview: no model calls or file writes':name==='reference'?'Reference applied MANUALLY — not agent execution':'Starter restored');
    if(name==='reset'||name==='reference')reloadApp();
    await poll();
  }catch(err){toast('Server unavailable: '+err.message)}
}
for(const name of ['run','preview','reset','reference']) $(name).addEventListener('click',()=>action(name));
$('reload-app').addEventListener('click',reloadApp);
function reloadApp(){
  const iframe=$('site-preview');
  iframe.src='/?office='+Date.now();
}

function setSelected(role){
  if(!roleInfo[role])return;
  selected=role;
  for(const desk of document.querySelectorAll('.desk')){
    const isSelected=desk.dataset.agent===role;
    desk.classList.toggle('selected',isSelected);
    desk.setAttribute('aria-pressed',isSelected?'true':'false');
  }
  const info=roleInfo[role];
  $('selected-name').textContent=info.full;
  $('selected-model').textContent=info.model;
  $('selected-work').textContent=info.work;
  $('selected-avatar').textContent=info.symbol;
  renderInspector();
}
for(const desk of document.querySelectorAll('.desk'))desk.addEventListener('click',()=>setSelected(desk.dataset.agent));
for(const button of document.querySelectorAll('.evidence-tabs button'))button.addEventListener('click',()=>{
  tab=button.dataset.tab;
  for(const b of document.querySelectorAll('.evidence-tabs button'))b.setAttribute('aria-selected',String(b===button));
  renderInspector();
});

function statusFor(role){
  const events=snapshot.events.filter(e=>e.actor===role), last=events.at(-1);
  if(!last)return 'waiting';
  if(last.type==='error')return 'error';
  if(last.type==='start'||last.type==='tool')return 'working';
  if(last.type==='test' && /FAIL/i.test(last.detail))return 'error';
  if(last.type==='done'||last.type==='test'||last.type==='decision'||last.type==='handoff'||last.type==='status')return 'done';
  return 'working';
}
function statusText(status){return {waiting:'WAITING',working:'WORKING',done:'COMPLETED',error:'FAILED'}[status]||'WAITING'}
function updateStatuses(){
  for(const role of Object.keys(roleInfo)){
    const status=statusFor(role), desk=document.querySelector(`.desk[data-agent="${role}"]`), milestone=$('mile-'+role);
    desk.classList.toggle('working',status==='working');desk.classList.toggle('finished',status==='done');desk.classList.toggle('failed',status==='error');
    const label=$('floor-'+role);label.textContent=statusText(status);
    if(milestone)milestone.className='milestone-marker'+(status==='waiting'?'':status==='working'?' running':status==='done'?' done':' error');
  }
  // QA works twice: writing tests first, then verifying. Split it across two milestones.
  const qa=snapshot.events.filter(e=>e.actor==='QA'), wroteAt=qa.findIndex(e=>/Acceptance tests written|Regression tests preserved/.test(e.title));
  const testsMile=$('mile-Tests'), verifyMile=$('mile-QA');
  testsMile.className='milestone-marker'+(wroteAt>=0?' done':qa.length?(qa.at(-1).type==='error'?' error':' running'):'');
  const starts=qa.map((e,i)=>e.title==='CrewAI specialist started'?i:-1).filter(i=>i>=0);
  const verify=starts.length>1?qa.slice(starts.at(-1)):[];
  const verifyFailed=verify.some(e=>e.type==='error'||(e.type==='test'&&/FAIL/.test(e.detail)));
  verifyMile.className='milestone-marker'+(!verify.length?'':verify.some(e=>e.type==='test'&&/^PASS/.test(e.detail))?' done':verifyFailed?' error':' running');
  $('selected-status').textContent=statusText(statusFor(selected));
}
function handoff(from,to){
  const bubble=$('handoff-bubble');
  bubble.textContent=`✉ Task routed: ${roleInfo[from].name} → ${roleInfo[to].name}`;
  bubble.classList.remove('show');void bubble.offsetWidth;bubble.classList.add('show');
  $('handoff-text').textContent=`${roleInfo[to].name} received the task`;
  $('route-status').textContent=`${from.toUpperCase()} → ${to.toUpperCase()}`;
  clearTimeout(handoffTimeout);handoffTimeout=setTimeout(()=>bubble.classList.remove('show'),2000);
}
function processEvents(){
  const isNewContext=snapshot.events.length===0;
  if(isNewContext){seenEvents.clear();lastActiveRole=null;return;}
  // Multiple events may arrive between polls; process them in stored order.
  for(const e of snapshot.events){
    const key=`${snapshot.mode}:${snapshot.runId||'none'}:${e.id}`;
    if(seenEvents.has(key))continue;
    seenEvents.add(key);
    if(e.actor==='Manager' && e.type==='handoff'){
      const worker=(e.title||'').replace('Handoff to ','').trim();
      if(roleInfo[worker])handoff('Manager',worker);
    }
    if(roleInfo[e.actor] && e.actor!=='Manager' && e.type==='start')lastActiveRole=e.actor;
  }
}
function renderTimeline(){
  const signature=JSON.stringify(snapshot.events);
  if(signature===previousSignature)return;
  previousSignature=signature;
  $('event-count').textContent=`${snapshot.events.length} events`;
  $('event-stream').innerHTML=snapshot.events.length?snapshot.events.map(e=>`<div class="event ${e.type==='error'?'failed':e.type==='complete'?'passed':''}"><span class="time">${escapeHTML(e.at)}</span><span class="who">${escapeHTML(e.actor)}</span><span><span class="verb">${escapeHTML(e.title)}</span>${e.detail?`<small>${escapeHTML(e.detail)}</small>`:''}</span></div>`).join(''):'<div class="empty-log">Launch a real agent run, or select the clearly labeled scripted preview.</div>';
  $('event-stream').scrollTop=$('event-stream').scrollHeight;
}
function parseTestOutput(text){
  if(!text)return null;
  const pass=text.match(/# pass\s+(\d+)/), fail=text.match(/# fail\s+(\d+)/);
  return pass&&fail?{pass:Number(pass[1]),fail:Number(fail[1])}:null;
}
function renderDiff(text){
  return text.split('\n').map(line=>{
    const cl=line.startsWith('+')&&!line.startsWith('+++')?'add':line.startsWith('-')&&!line.startsWith('---')?'del':line.startsWith('@@')||line.startsWith('---')||line.startsWith('+++')?'meta':'';
    return `<div class="evidence-line ${cl}">${escapeHTML(line)||' '}</div>`;
  }).join('');
}
function renderInspector(){
  if(snapshot.mode==='preview'){
    $('evidence-message').textContent='SCRIPTED PREVIEW — simulated office events only. No model calls, code changes or test runs.';
  }else if(snapshot.mode==='reference'){
    $('evidence-message').textContent='MANUAL REFERENCE — source changed by the facilitator button, not by AI agents.';
  }else if(snapshot.mode==='live'){
    $('evidence-message').textContent='LIVE MODEL RUN — examine real tool events and audit artifacts below.';
  }else $('evidence-message').textContent='No active run. Start the real crew to capture tool calls, diffs and test output.';
  let html='';
  if(tab==='activity'){
    const list=snapshot.events.filter(e=>e.actor===selected);
    html=list.length?list.map(e=>`<div class="evidence-event"><b>${escapeHTML(e.title)}</b><p>${escapeHTML(e.detail)}</p></div>`).join(''):'<div class="empty-evidence">No activity recorded for this agent yet.</div>';
  } else if(snapshot.mode==='preview'||snapshot.mode==='reference'){
    html='<div class="empty-evidence">This mode does not generate model-run audit artifacts.</div>';
  } else if(tab==='patch'){
    const content=selected==='Manager'?(audit?.managerDecisions?.length?JSON.stringify(audit.managerDecisions,null,2):null):selected==='Backend'?audit?.backendPatch:selected==='Frontend'?audit?.frontendPatch:selected==='Architect'?(audit?.spec||audit?.architect):(audit?.testsPatch||audit?.qa);
    const isDiff=['Backend','Frontend'].includes(selected)||(selected==='QA'&&audit?.testsPatch);
    html=content?(isDiff?renderDiff(content):`<div class="evidence-line">${escapeHTML(content)}</div>`):'<div class="empty-evidence">Nothing recorded yet. Specs, tests and code appear here once each agent saves its work through its tool.</div>';
  }else if(tab==='tests'){
    const content=audit?.independentGate||audit?.qaTests;
    html=content?`<div class="evidence-line">${escapeHTML(content)}</div>`:'<div class="empty-evidence">No actual QA test artifact yet. Preview events are not test evidence.</div>';
  }
  $('evidence-body').innerHTML=html;
}
function updateLabels(){
  const mode=snapshot.mode;
  const needsReset=snapshot.workspaceReset===false;
  const installed=mode==='idle' && snapshot.featureWritten;
  const decisions=snapshot.manager?.decisions||[];
  const decision=decisions.at(-1);
  const state=snapshot.manager?.state;
  $('manager-current').textContent=decision?`${decision.assign==='COMPLETE'?'Completed':decision.assign==='STOP'?'Stopped':'Assigned '+decision.assign}`:mode==='preview'?'Scripted supervisor example':'Awaiting real manager decision';
  $('manager-reason').textContent=decision?.reason || (mode==='preview'?'Illustration only — no actual manager model call.':'Real model assignments will appear here with audit evidence.');
  const steps=[(state?.completed||[]).includes('Architect'),state?.tests_written,(state?.completed||[]).includes('Backend'),(state?.completed||[]).includes('Frontend'),(state?.completed||[]).includes('QA')].filter(Boolean).length;
  $('manager-progress').textContent=`${steps} / 5 steps`;
  $('manager-retries').textContent=`Corrections ${state?.retry_count||0} / ${state?.max_corrections??1}`;
  const badge=$('display-mode');badge.className='mode-pill'+(mode==='live'?' live':mode==='preview'?' preview':'');
  badge.textContent=mode==='live'?(snapshot.runOutcome==='passed'?'LIVE · VERIFIED':snapshot.runOutcome==='failed'?'LIVE · FAILED':'LIVE · RUNNING'):mode==='preview'?'SCRIPTED · NO MODEL':mode==='reference'?'MANUAL REFERENCE':installed?'LOCAL FEATURE':'READY';
  $('run-indicator').textContent=snapshot.runId?`RUN ${snapshot.runId}`:mode==='preview'?'ILLUSTRATION ONLY':mode==='reference'?'NOT AN AGENT RUN':'READY';
  $('credential-state').textContent=`Groq ${snapshot.credentialsPresent?.groq?'configured':'needs key'} · Gemini ${snapshot.credentialsPresent?.gemini?'configured':'needs key'} · Node website runs without keys`;
  const testResult=parseTestOutput(audit?.independentGate);
  const label=$('feature-result');label.className='feature-result';
  if(mode==='live'){
    if(snapshot.runOutcome==='passed'){label.textContent=testResult?`${testResult.pass} / ${testResult.pass+testResult.fail} TESTS PASS`:'TESTS VERIFIED';label.classList.add('pass')}
    else if(snapshot.runOutcome==='failed')label.textContent='RUN FAILED';
    else label.textContent='RUNNING';
  }else if(mode==='reference'){label.textContent='MANUAL FIX';label.classList.add('pass')}
  else if(mode==='preview')label.textContent='SCRIPTED ONLY';
  else label.textContent=installed?'LOCAL FEATURE':'STARTER';
  document.querySelector('.preview-description').textContent=installed
    ? 'Showing the current local feature. It has not been verified by a live agent run in this session.'
    : 'After a passing live run, this preview reloads with whatever the team built.';
  for(const b of document.querySelectorAll('.mission button'))b.disabled=snapshot.running;
  $('run').disabled=snapshot.running;
  $('run-notice').textContent=snapshot.running?'An agent run is in progress.':needsReset
    ? 'This run will extend the installed feature and preserve its existing acceptance tests. Reset is optional and replaces the feature with the empty starter.'
    : 'Ready for a new agent run.';
  requestBox.disabled=snapshot.running;
  if(snapshot.featureRequest&&requestBox.value!==snapshot.featureRequest&&(snapshot.running||mode==='reference')){requestBox.value=snapshot.featureRequest;renderPresets()}
}
async function poll(){
  try{
    const resp=await fetch('/api/state',{cache:'no-store'});
    if(!resp.ok)throw new Error('Server state unavailable');
    const next=await resp.json();
    if(next.runId!==snapshot.runId){audit=null;seenEvents.clear();lastActiveRole=null;previousSignature='';lastOutcome='idle';if(next.featureRequest){requestBox.value=next.featureRequest;renderPresets()}}
    snapshot=next;
    if(snapshot.mode==='live'&&snapshot.runId){
      try{const r=await fetch('/api/audit',{cache:'no-store'});if(r.ok)audit=await r.json()}catch{}
    }else audit=null;
    processEvents();updateStatuses();updateLabels();renderTimeline();renderInspector();
    if(snapshot.mode==='live' && snapshot.runOutcome==='passed'&&lastOutcome!=='passed'){
      reloadApp();toast('Feature verified! Live code changes are now loaded in the app.');
    }
    lastOutcome=snapshot.runOutcome;
  }catch(error){$('credential-state').textContent='Could not connect to the local CampusBites server.'}
}
setSelected('Manager');
setInterval(poll,1100);poll();
