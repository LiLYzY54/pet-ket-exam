import fs from "fs";
import path from "path";

const endpoint = "http://127.0.0.1:9223";
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent("http://127.0.0.1:4173/")}`, {method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);

let seq=0;
const pending=new Map();
ws.addEventListener("message",event=>{
  const msg=JSON.parse(event.data);
  if(msg.id&&pending.has(msg.id)){
    const {resolve,reject}=pending.get(msg.id); pending.delete(msg.id);
    msg.error?reject(new Error(msg.error.message)):resolve(msg.result);
  }
});
function call(method,params={}){
  const id=++seq; ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolve,reject)=>pending.set(id,{resolve,reject}));
}
async function evaluate(expression){
  const out=await call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true,userGesture:true});
  if(out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description||out.exceptionDetails.text);
  return out.result.value;
}
async function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

await call("Runtime.enable");
await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", {width: 1200, height: 900, deviceScaleFactor: 2, mobile: false});

const dir = path.join(process.cwd(), "audit_parts_screenshots");
if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});

async function shoot(filename) {
  const res = await call("Page.captureScreenshot", {format: "png"});
  fs.writeFileSync(path.join(dir, filename), Buffer.from(res.data, "base64"));
  console.log("Saved: " + filename);
}

// Set up PET in practice mode
await evaluate(`
  localStorage.clear();
  App.show("info");
  App.pickExam("PET");
  App.pickPaper("test1");
  App.setMode("practice");
  document.querySelector("#stuName").value = "王小华";
  App.startExam();
`);
await wait(400);

const petParts = [
  { idx: 1, name: "pet_l2" },
  { idx: 2, name: "pet_l3_fill" },
  { idx: 3, name: "pet_l4" },
  { idx: 4, name: "pet_r1" },
  { idx: 5, name: "pet_r2_match" },
  { idx: 6, name: "pet_r3_reading" },
  { idx: 7, name: "pet_r4_gapped" },
  { idx: 8, name: "pet_r5_cloze" },
  { idx: 9, name: "pet_r6_open_cloze" },
  { idx: 10, name: "pet_writing" },
  { idx: 11, name: "pet_speaking" }
];

for (const p of petParts) {
  await evaluate(`App.gotoPart(${p.idx})`);
  await wait(300);
  await shoot(`${p.name}.png`);
}

// Switch to KET test1
await evaluate(`
  localStorage.clear();
  App.show("info");
  App.pickExam("KET");
  App.pickPaper("test1");
  App.setMode("practice");
  document.querySelector("#stuName").value = "李明明";
  App.startExam();
`);
await wait(400);

const ketParts = [
  { idx: 0, name: "ket_l1" },
  { idx: 1, name: "ket_l2_fill" },
  { idx: 4, name: "ket_l5_match" },
  { idx: 5, name: "ket_r1_signs" },
  { idx: 6, name: "ket_r2_match" },
  { idx: 7, name: "ket_r3_reading" },
  { idx: 8, name: "ket_r4_cloze" },
  { idx: 9, name: "ket_r5_open_cloze" },
  { idx: 10, name: "ket_r6_writing_offline" },
  { idx: 11, name: "ket_r7_story_offline" }
];

for (const p of ketParts) {
  await evaluate(`App.gotoPart(${p.idx})`);
  await wait(300);
  await shoot(`${p.name}.png`);
}

await fetch(`${endpoint}/json/close/${target.id}`);
ws.close();
console.log("Done capturing all parts!");
