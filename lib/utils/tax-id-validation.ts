/**
 * Tax identification number validation: the Portuguese NIF (Número de Identificação Fiscal).
 */

/**
 * Validate a Portuguese NIF (9 digits, check digit via mod 11)
 */
export function validatePortugueseNIF(nif: string): boolean {
  const clean = nif.replace(/\D/g, "");

  if (clean.length !== 9) return false;

  // First digit must be 1, 2, 3, 5, 6, 7, 8, or 9
  const firstDigit = parseInt(clean[0]);
  if (![1, 2, 3, 5, 6, 7, 8, 9].includes(firstDigit)) return false;

  // Calculate check digit (mod 11 algorithm)
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(clean[i]) * (9 - i);
  }

  const checkDigit = 11 - (sum % 11);
  const expectedCheckDigit = checkDigit >= 10 ? 0 : checkDigit;

  return parseInt(clean[8]) === expectedCheckDigit;
}
