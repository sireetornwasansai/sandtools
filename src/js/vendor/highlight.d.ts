declare const hljs: { highlight(code: string, opts: { language: string; ignoreIllegals?: boolean }): { value: string }; getLanguage(name: string): unknown };
export default hljs;
