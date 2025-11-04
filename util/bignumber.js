function formatUnits(rawStr, decimals, { fixed = true } = {}) {
  // rawStr: "정수 문자열"(sun, wei 같은 원단위)
  if (!/^\d+$/.test(rawStr)) rawStr = String(rawStr || '0').replace(/\D/g, '') || '0';

  const raw = BigInt(rawStr);
  const base = BigInt(10) ** BigInt(decimals);

  const intPart = raw / base;
  const fracPart = raw % base;

  if (decimals === 0) return intPart.toString();

  let fracStr = fracPart.toString().padStart(decimals, '0');

  if (!fixed) {
    // 표시용(뒤 0 제거, 전부 0이면 정수만)
    fracStr = fracStr.replace(/0+$/, '');
    return fracStr ? `${intPart.toString()}.${fracStr}` : intPart.toString();
  }

  // DB 저장용(항상 고정 자릿수)
  return `${intPart.toString()}.${fracStr}`;
}

module.exports = { formatUnits };