import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { createServer } from "vite";

await mkdir("artifacts",{recursive:true});
const server=await createServer({root:"browser",server:{host:"127.0.0.1",port:0},logLevel:"error"}); await server.listen();
const address=server.httpServer.address(); if(!address||typeof address==="string")throw new Error("Vite did not expose a TCP port");
const browser=await chromium.launch({headless:true,executablePath:process.env.MONGEN_CHROMIUM??"/usr/bin/chromium",args:["--enable-unsafe-webgpu","--enable-unsafe-swiftshader","--use-webgpu-adapter=swiftshader","--use-gpu-in-tests"]});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on("pageerror",error=>errors.push(error.message)); page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${address.port}/?capture=1`);
  await page.waitForFunction(()=>window.monGenEditor?.ready===true,{timeout:180_000});
  const initial=await page.evaluate(()=>({...window.monGenEditor}));
  await page.click("#mutate"); await page.waitForFunction(count=>window.monGenEditor?.ready===true&&window.monGenEditor.generations>count,initial.generations,{timeout:180_000});
  const afterMutation=await page.evaluate(()=>({...window.monGenEditor}));
  await page.selectOption("#element","Water"); await page.selectOption("#pattern","Spots");
  await page.waitForFunction(count=>window.monGenEditor?.ready===true&&window.monGenEditor.generations>count,afterMutation.generations,{timeout:180_000});
  const beforeOrbit=await page.evaluate(()=>window.monGenEditor.azimuth),beforeOrbitFrames=await page.evaluate(()=>window.monGenEditor.frames),box=await page.locator("#preview").boundingBox(); if(!box)throw new Error("preview has no layout box");
  await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5); await page.mouse.down(); await page.mouse.move(box.x+box.width*.62,box.y+box.height*.44,{steps:4}); await page.mouse.up();
  const afterOrbit=await page.evaluate(()=>window.monGenEditor.azimuth); if(afterOrbit===beforeOrbit)throw new Error("orbit drag did not update camera state");
  await page.waitForFunction(count=>window.monGenEditor.frames>count,beforeOrbitFrames,{timeout:30000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
    const canvas=document.querySelector("#preview"),ctx=canvas.getContext("2d"),pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,bg=[pixels[0],pixels[1],pixels[2]]; let foreground=0;
    for(let i=0;i<pixels.length;i+=4)if(Math.abs(pixels[i]-bg[0])+Math.abs(pixels[i+1]-bg[1])+Math.abs(pixels[i+2]-bg[2])>24)foreground++;
    return {state:{...window.monGenEditor},foreground,element:document.querySelector("#element").value,pattern:document.querySelector("#pattern").value,status:document.querySelector("#status").textContent};
  });
  if(errors.length)throw new Error(`browser errors:\n${errors.join("\n")}`); if(result.foreground<1000)throw new Error(`editor preview is empty: ${result.foreground} foreground pixels`);
  if(result.element!=="Water"||result.pattern!=="Spots"||result.state.generations<3)throw new Error(`editor controls did not regenerate: ${JSON.stringify(result)}`);
  await page.screenshot({path:"artifacts/mongen-editor.png",fullPage:true});
  await writeFile("artifacts/mongen-editor-report.json",JSON.stringify({initial,afterMutation,...result,orbitStateChanged:true},null,2)+"\n");
  console.log(`Editor smoke: ${result.state.generations} generations, ${result.state.triangles} triangles, ${result.foreground} foreground pixels, orbit state changed`);
} finally { await browser.close(); await server.close(); }
