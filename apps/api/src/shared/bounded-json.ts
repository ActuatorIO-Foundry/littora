export async function boundedJson(response:Response, maxBytes:number) {
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel(); throw new Error('Invalid size');
  }
  const reader = response.body.getReader(), chunks:Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done,value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Invalid size'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
