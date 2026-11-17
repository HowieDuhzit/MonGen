import { chromium } from "playwright-core";
import { createServer } from "vite";

const MODES={
  swiftshader:["--enable-unsafe-webgpu","--enable-unsafe-swiftshader","--use-webgpu-adapter=swiftshader","--use-gpu-in-tests"],
  hardware:["--enable-unsafe-webgpu","--use-gpu-in-tests"],
};

export async function runWebGpuMesh({dna,resolutionOverride,vertexCapacity=2_000_000,adapterMode="swiftshader",chromiumPath=process.env.MONGEN_CHROMIUM??"/usr/bin/chromium",timeoutMs=300_000,previewPath,previewWidth=512,previewHeight=512,azimuthDegrees=35}) {
  if (!(adapterMode in MODES)) throw new Error(`adapter mode must be one of: ${Object.keys(MODES).join(", ")}`);
  const server=await createServer({root:"browser",server:{host:"127.0.0.1",port:0},logLevel:"error"});
  await server.listen();
  const address=server.httpServer.address();
  if (!address || typeof address==="string") throw new Error("Vite did not expose a TCP port");
  const browser=await chromium.launch({headless:true,executablePath:chromiumPath,args:MODES[adapterMode]});
  try {
    const page=await browser.newPage();
    page.on("console",message=>console.log(`[browser:${message.type()}] ${message.text()}`));
    await page.addInitScript(input=>{ window.monGenInput=input; },{dna,resolutionOverride,vertexCapacity,preview:Boolean(previewPath),previewWidth,previewHeight,azimuthDegrees});
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.waitForFunction(()=>window.monGenResult!==undefined,{timeout:timeoutMs});
    const result=await page.evaluate(()=>window.monGenResult);
    if (!result?.ok || !result.obj) throw new Error(result?.message??"WebGPU generator returned no result");
    if (previewPath) {
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await page.locator("#preview").screenshot({path:previewPath});
    }
    return result;
  } finally {
    await browser.close();
    await server.close();
  }
}
