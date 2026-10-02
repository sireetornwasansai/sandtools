declare const DOMPurify: { sanitize(dirty: string, cfg?: any): string; addHook(name: string, fn: (node: any) => void): void };
export default DOMPurify;
