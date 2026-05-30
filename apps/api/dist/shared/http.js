"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchJson = fetchJson;
exports.num = num;
async function fetchJson(url, init) {
    const res = await fetch(url, init);
    if (!res.ok)
        throw new Error(`HTTP ${res.status} on ${url}`);
    return res.json();
}
function num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
//# sourceMappingURL=http.js.map