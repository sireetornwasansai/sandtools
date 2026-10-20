declare const Tesseract: { createWorker(langs: string | string[], oem?: number, options?: Record<string, any>): Promise<any> };
export default Tesseract;
