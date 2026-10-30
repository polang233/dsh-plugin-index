import { parseArgs } from 'node:util';

/** Command-line checks may run before CDNs settle: `--retries 3 --wait 60` tries three times, a minute apart. */
export async function withRetries(task) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { retries: { type: 'string', default: '1' }, wait: { type: 'string', default: '60' } } });
  const retries = Number(values.retries);
  for (let attempt = 1; ; attempt++) {
    try { return await task(positionals); }
    catch (error) {
      if (attempt >= retries) throw error;
      console.error(`Attempt ${attempt} of ${retries}: ${error.message}`);
      await new Promise(done => setTimeout(done, Number(values.wait) * 1000));
    }
  }
}
