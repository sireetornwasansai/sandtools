declare class QRCodeCore { constructor(typeNumber: number, level: number); addData(d: string): void; make(): void; getModuleCount(): number; isDark(r: number, c: number): boolean }
export default QRCodeCore;
