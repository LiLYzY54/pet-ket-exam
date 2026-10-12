
import fs from "fs";
import path from "path";

const endpoint = "http://127.0.0.1:9223";
const target = await fetch(`${endpoint}/json/new?${encodeURIComponent("http://127.0.0.1:4173/")}`, {method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true})});

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
await evaluate("localStorage.clear()");
await call("Page.reload");
await wait(800);

const screenshotDir = path.join(process.cwd(), "audit_screenshots");
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, {recursive: true});

async function shoot(filename) {
  const res = await call("Page.captureScreenshot", {format: "png"});
  fs.writeFileSync(path.join(screenshotDir, filename), Buffer.from(res.data, "base64"));
  console.log("Saved: " + filename);
}

// 1. Home desktop
await shoot("01_home_desktop.png");

// 2. Info desktop (PET selected)
await evaluate("App.show('info')");
await evaluate("App.pickExam('PET')");
await evaluate("App.pickPaper('test1')");
await wait(300);
await shoot("02_info_desktop.png");

// 3. Exam Listening Part 1
await evaluate("document.querySelector('#stuName').value = '张小明'; App.startExam()");
await wait(500);
await shoot("03_exam_listening_p1_desktop.png");

// 4. Exam Reading Part 1
await evaluate("App.gotoPart(4)"); // Reading starts at part index 4
await wait(500);
await shoot("04_exam_reading_p1_desktop.png");

// 5. Exam Reading Part 4 (Gapped text)
await evaluate("App.gotoPart(7)");
await wait(500);
await shoot("05_exam_reading_p4_desktop.png");

// 6. Exam Writing
await evaluate("App.gotoPart(10)");
await wait(500);
await shoot("06_exam_writing_desktop.png");

// 7. Exam Speaking
await evaluate("App.gotoPart(11)");
await wait(500);
await shoot("07_exam_speaking_desktop.png");

// 8. Palette (答题卡)
await evaluate("App.openCheck()");
await wait(500);
await shoot("08_check_palette_desktop.png");

// 9. Submit & Report
// Fill some answers
await evaluate(`
  const keys = Object.keys(state.answers);
  // submit directly
  App.doSubmit();
`);
await wait(600);
await shoot("09_report_desktop.png");

// 10. Mobile 390px Report
await call("Emulation.setDeviceMetricsOverride", {width: 390, height: 844, deviceScaleFactor: 3, mobile: true});
await wait(500);
await shoot("10_report_mobile_390px.png");

// 11. Mobile 390px Exam Listening
await evaluate("App.show('exam')");
await evaluate("App.gotoPart(0)");
await wait(500);
await shoot("11_exam_listening_mobile_390px.png");

// 12. Mobile 390px Palette
await evaluate("App.openCheck()");
await wait(500);
await shoot("12_palette_mobile_390px.png");

// Close page
await fetch(`${endpoint}/json/close/${target.id}`);
ws.close();
console.log("All screenshots captured!");
