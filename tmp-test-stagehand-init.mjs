
import { resolveChromiumExecutable } from './packages/docs/dist/runtime/crawler/stagehand-runtime.js';
const { Stagehand } = await import('@browserbasehq/stagehand');
const executablePath = await resolveChromiumExecutable();
const t = Date.now();
const stagehand = new Stagehand({
  env: 'LOCAL',
  model: { modelName: 'google/gemini-2.0-flash', apiKey: 'x' },
  localBrowserLaunchOptions: { headless: true, executablePath, args: ['--disable-gpu','--no-sandbox'] },
});
await stagehand.init();
const page = stagehand.context.pages()[0] || await stagehand.context.newPage();
await page.goto('https://ledgeindex.com/docs', { waitUntil: 'domcontentloaded', timeout: 30000 });
process.send?.({ ok: true, ms: Date.now()-t });
await stagehand.close();
process.exit(0);
