// 시드 결정적 RNG — 리롤 안정 랜덤의 기반
// seedFrom(chatId, msgIndex)로 만든 시드는 같은 턴이면 항상 같은 난수열을 낸다.

function hashStr(s) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** (chatId, 메시지 인덱스, 용도 라벨) → 결정적 rng 함수 */
function seededRng(chatId, msgIndex, label = '') {
  return mulberry32(hashStr(`${chatId}::${msgIndex}::${label}`));
}

/** 비결정 rng (rerollStableRng: false 옵션용) — 호스트가 Math.random 주입 */
function makeUnstableRng(random = Math.random) {
  return () => random();
}

module.exports = { seededRng, makeUnstableRng, hashStr };
