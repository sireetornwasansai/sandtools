export interface QRResult { data: string; binaryData: number[]; location: Record<string, { x: number; y: number }> }
declare function jsQR(data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' }): QRResult | null;
export default jsQR;
